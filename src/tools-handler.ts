/**
 * Tools Handler - Dynamic tool registration for rloop plugin
 */

import type { OpenClawPluginApi } from './openclaw-sdk.js';
import type { RalphLoopConfig, Task } from './types.js';
import { shouldLog } from './config.js';
import {
  loadState,
  saveState,
  addTask,
  findTaskById,
  findTaskByName,
  updateStepStatus,
  heartbeat,
  getTaskStats,
  getStalledTasks,
} from './state-manager.js';
import { getStateFilePath } from './config.js';

// Lazily resolved Feishu client to avoid circular dependency during registration
function getFeishuClient() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { LarkClient } = require('openclaw-lark');
    return LarkClient.get('default') ?? null;
  } catch {
    return null;
  }
}

function sendFeishuMarkdown(to: string, text: string): Promise<void> {
  const client = getFeishuClient();
  if (!client) {
    console.warn('[rloop] Feishu client not available, skipping notification');
    return Promise.resolve();
  }
  return import('openclaw-lark').then(({ sendMarkdownCardFeishu, buildMarkdownCard }) => {
    return sendMarkdownCardFeishu({
      cfg: client.account,
      to,
      text,
    });
  }).catch((err) => {
    console.warn('[rloop] Failed to send Feishu notification:', err);
  }) as Promise<void>;
}

interface ToolArgs {
  taskName?: string;
  taskId?: string;
  stepId?: number;
  status?: string;
  steps?: Array<{ desc: string }>;
  stallTimeoutMs?: number;
  error?: string;
  agentId?: string;
  includeStalled?: boolean;
}

/** Format progress bar string */
function formatProgress(task: { progress: { completedSteps: number; totalSteps: number }; steps: Array<{ desc: string }> }): string {
  const done = task.progress.completedSteps;
  const total = task.progress.totalSteps;
  const pct = Math.round((done / total) * 100);
  const barLen = 10;
  const filled = Math.round((done / total) * barLen);
  const bar = '█'.repeat(filled) + '░'.repeat(barLen - filled);
  return `[${bar}] ${pct}%`;
}

/** Send a step report - supports both Feishu direct notification and HTTP callback */
async function sendStepReport(
  config: RalphLoopConfig,
  api: OpenClawPluginApi,
  event: { type: string; taskId: string; taskName: string; stepId: number; stepDesc: string; progress: { completedSteps: number; totalSteps: number } }
): Promise<void> {
  if (!config.stepReport.enabled) return;

  const shouldSend =
    (event.type === 'completed' && config.stepReport.onComplete) ||
    (event.type === 'started' && config.stepReport.onStart) ||
    (event.type === 'failed' && config.stepReport.onFailure);
  if (!shouldSend) return;

  const emoji: Record<string, string> = {
    started: '🟡',
    completed: '✅',
    failed: '❌',
  };
  const label = emoji[event.type] ?? '📋';
  const nextStep = event.type === 'completed' ? event.stepId + 1 : event.stepId;
  const nextDesc = event.type === 'completed'
    ? ''
    : ` · 下一步：${event.stepDesc}`;
  const text = `${label} **${event.taskName}**\n` +
    `第 ${event.stepId}/${event.progress.totalSteps} 步 [${formatProgress({ progress: event.progress, steps: [] })}]\n` +
    `进行中：${event.stepDesc}${nextDesc}`;

  // 1) Direct Feishu DM to owner (via openclaw-lark)
  if (config.stepReport.notifyFeishu && config.stepReport.feishuUserId) {
    sendFeishuMarkdown(config.stepReport.feishuUserId, text).catch(() => {});
  }

  // 2) HTTP callback (for external integrations)
  if (config.onFailure.type === 'callback' && config.onFailure.callbackUrl) {
    const body = {
      event: event.type,
      taskId: event.taskId,
      taskName: event.taskName,
      stepId: event.stepId,
      stepDesc: event.stepDesc,
      progress: `${event.progress.completedSteps}/${event.progress.totalSteps}`,
      progressBar: formatProgress({ progress: event.progress, steps: [] }),
      timestamp: new Date().toISOString(),
    };
    const url = config.onFailure.callbackUrl.replace('/failure', '/step');
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch((err) => console.warn('[rloop] Step report callback failed:', err));
  }
}

interface ToolArgs {
  taskName?: string;
  taskId?: string;
  stepId?: number;
  status?: string;
  steps?: Array<{ desc: string }>;
  stallTimeoutMs?: number;
  error?: string;
  agentId?: string;
  includeStalled?: boolean;
}

/** Build a success result */
function successResult(data: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data) }],
    isError: false,
  };
}

/** Build an error result */
function errorResult(error: string) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error }) }],
    isError: true,
  };
}

/**
 * Register all rloop tools
 */
export function registerTools(api: OpenClawPluginApi, config: RalphLoopConfig): void {
  // Tool: Register a new task with steps
  api.registerTool({
    name: 'rloop_register_task',
    description: 'Register a new task for RLoop monitoring. Agent should provide the full step-by-step plan upfront. Call this when starting a long-running task.',
    parameters: {
      type: 'object',
      properties: {
        taskName: {
          type: 'string',
          description: 'Name of the task',
        },
        steps: {
          type: 'array',
          description: 'Array of step objects with description for each step',
          items: {
            type: 'object',
            properties: {
              desc: { type: 'string', description: 'Description of this step' },
            },
          },
        },
        stallTimeoutMs: {
          type: 'number',
          description: 'Stall detection timeout in milliseconds (default: 300000 = 5 minutes)',
        },
        agentId: {
          type: 'string',
          description: 'Agent ID for tracking (optional, will use session if not provided)',
        },
      },
      required: ['taskName', 'steps'],
    },
    execute: async (_toolCallId: string, params: Record<string, unknown>) => {
      const taskName = params.taskName as string;
      const steps = params.steps as Array<{ desc: string }>;
      const stallTimeoutMs = params.stallTimeoutMs as number | undefined;
      const agentId = params.agentId as string | undefined;

      if (!taskName || !steps || steps.length === 0) {
        return errorResult('taskName and steps are required');
      }

      try {
        const task = await addTask(
          config,
          taskName,
          agentId ?? 'unknown',
          steps,
          stallTimeoutMs
        );

        return successResult({
          success: true,
          taskId: task.id,
          taskName: task.taskName,
          status: task.status,
          steps: task.steps.map((s) => ({
            id: s.id,
            desc: s.desc,
            status: s.status,
          })),
          message: `Task registered with ${task.steps.length} steps. Step 1 is now running.`,
        });
      } catch (err) {
        return errorResult(String(err));
      }
    },
  });

  // Tool: Update a step status
  api.registerTool({
    name: 'rloop_update_step',
    description: 'Update the status of a specific step in a task being monitored by RLoop. Use this after completing each step.',
    parameters: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: 'Task ID (from register_task response)',
        },
        stepId: {
          type: 'number',
          description: 'Step ID to update (1-based)',
        },
        status: {
          type: 'string',
          enum: ['running', 'completed', 'failed'],
          description: 'New status for the step',
        },
        error: {
          type: 'string',
          description: 'Error message if status is failed',
        },
      },
      required: ['taskId', 'stepId', 'status'],
    },
    execute: async (_toolCallId: string, params: Record<string, unknown>) => {
      const taskId = params.taskId as string;
      const stepId = params.stepId as number;
      const status = params.status as string;
      const error = params.error as string | undefined;

      if (!taskId || stepId === undefined || !status) {
        return errorResult('taskId, stepId, and status are required');
      }

      try {
        const success = await updateStepStatus(
          config,
          taskId,
          stepId,
          status as 'running' | 'completed' | 'failed',
          error
        );

        if (!success) {
          return errorResult('Failed to update step - task or step not found');
        }

        // Reload to get updated task state
        const state = await loadState(config);
        const task = findTaskById(state, taskId);

        // Fire step report notification if configured
        if (task && config.stepReport.enabled) {
          const step = task.steps.find((s) => s.id === stepId);
          if (step) {
            sendStepReport(config, api, {
              type: status === 'completed' ? 'completed' : status === 'running' ? 'started' : 'failed',
              taskId,
              taskName: task.taskName,
              stepId,
              stepDesc: step.desc,
              progress: task.progress,
            }).catch(() => {});
          }
        }

        return successResult({
          success: true,
          message: `Step ${stepId} updated to ${status}`,
          task: task ? {
            id: task.id,
            taskName: task.taskName,
            status: task.status,
            progress: task.progress,
          } : null,
        });
      } catch (err) {
        return errorResult(String(err));
      }
    },
  });

  // Tool: Send heartbeat to prevent stall detection
  api.registerTool({
    name: 'rloop_heartbeat',
    description: 'Send a heartbeat to RLoop to indicate the task is still active. Call this periodically during long-running steps to prevent false stall detection.',
    parameters: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: 'Task ID',
        },
      },
      required: ['taskId'],
    },
    execute: async (_toolCallId: string, params: Record<string, unknown>) => {
      const taskId = params.taskId as string;

      if (!taskId) {
        return errorResult('taskId is required');
      }

      try {
        const success = await heartbeat(config, taskId);
        return successResult({
          success,
          message: success ? 'Heartbeat recorded' : 'Task not found',
        });
      } catch (err) {
        return errorResult(String(err));
      }
    },
  });

  // Tool: Get task status
  api.registerTool({
    name: 'rloop_get_task',
    description: 'Get the current status of a task being monitored by RLoop, including step details.',
    parameters: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: 'Task ID (from register_task response)',
        },
        taskName: {
          type: 'string',
          description: 'Task name (alternative to taskId)',
        },
      },
    },
    execute: async (_toolCallId: string, params: Record<string, unknown>) => {
      const taskId = params.taskId as string | undefined;
      const taskName = params.taskName as string | undefined;

      if (!taskId && !taskName) {
        return errorResult('taskId or taskName is required');
      }

      try {
        const state = await loadState(config);
        let task: Task | undefined;

        if (taskId) {
          task = findTaskById(state, taskId);
        } else if (taskName) {
          task = findTaskByName(state, taskName);
        }

        if (!task) {
          return errorResult('Task not found');
        }

        return successResult({
          success: true,
          task: {
            id: task.id,
            taskName: task.taskName,
            status: task.status,
            createdAt: task.createdAt,
            lastUpdated: task.lastUpdated,
            steps: task.steps,
            progress: task.progress,
            stallDetection: task.stallDetection,
          },
        });
      } catch (err) {
        return errorResult(String(err));
      }
    },
  });

  // Tool: Complete task
  api.registerTool({
    name: 'rloop_complete_task',
    description: 'Mark a task as completed in RLoop monitoring.',
    parameters: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: 'Task ID',
        },
      },
      required: ['taskId'],
    },
    execute: async (_toolCallId: string, params: Record<string, unknown>) => {
      const taskId = params.taskId as string;

      if (!taskId) {
        return errorResult('taskId is required');
      }

      try {
        const state = await loadState(config);
        const task = findTaskById(state, taskId);

        if (!task) {
          return errorResult('Task not found');
        }

        // Mark all remaining steps as completed
        for (const step of task.steps) {
          if (step.status === 'pending' || step.status === 'running') {
            step.status = 'completed';
            step.updatedAt = new Date().toISOString();
          }
        }

        task.status = 'completed';
        task.lastUpdated = new Date().toISOString();
        task.progress.completedSteps = task.steps.length;
        task.progress.currentStep = task.steps.length;

        await saveState(config, state);

        return successResult({
          success: true,
          message: `Task ${taskId} marked as completed`,
        });
      } catch (err) {
        return errorResult(String(err));
      }
    },
  });

  // Tool: Fail task
  api.registerTool({
    name: 'rloop_fail_task',
    description: 'Mark a task as failed in RLoop monitoring.',
    parameters: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: 'Task ID',
        },
        error: {
          type: 'string',
          description: 'Error message',
        },
      },
      required: ['taskId'],
    },
    execute: async (_toolCallId: string, params: Record<string, unknown>) => {
      const taskId = params.taskId as string;
      const error = params.error as string | undefined;

      if (!taskId) {
        return errorResult('taskId is required');
      }

      try {
        const state = await loadState(config);
        const task = findTaskById(state, taskId);

        if (!task) {
          return errorResult('Task not found');
        }

        task.status = 'failed';
        task.lastUpdated = new Date().toISOString();
        if (error) {
          task.data.errorDetails = error;
        }

        await saveState(config, state);

        return successResult({
          success: true,
          message: `Task ${taskId} marked as failed`,
        });
      } catch (err) {
        return errorResult(String(err));
      }
    },
  });

  // Tool: List all tasks
  api.registerTool({
    name: 'rloop_list_tasks',
    description: 'List all tasks being monitored by RLoop, optionally filtered by status.',
    parameters: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['pending', 'running', 'completed', 'failed', 'stalled'],
          description: 'Filter by status (optional)',
        },
        includeStalled: {
          type: 'boolean',
          description: 'Include stalled tasks in results (default: true)',
        },
      },
    },
    execute: async (_toolCallId: string, params: Record<string, unknown>) => {
      const status = params.status as string | undefined;
      const includeStalled = (params.includeStalled as boolean | undefined) ?? true;

      try {
        const state = await loadState(config);
        let tasks = state.tasks;

        if (status) {
          tasks = tasks.filter((t) => t.status === status);
        }

        if (!includeStalled) {
          tasks = tasks.filter((t) => t.status !== 'stalled');
        }

        const stats = getTaskStats(state);

        return successResult({
          success: true,
          stats,
          tasks: tasks.map((t) => ({
            id: t.id,
            taskName: t.taskName,
            status: t.status,
            progress: t.progress,
            lastUpdated: t.lastUpdated,
          })),
        });
      } catch (err) {
        return errorResult(String(err));
      }
    },
  });

  // Tool: Check for stalled tasks
  api.registerTool({
    name: 'rloop_check_stalled',
    description: 'Manually check for stalled tasks and get their status. Usually used internally or for debugging.',
    parameters: {
      type: 'object',
      properties: {},
    },
    execute: async () => {
      try {
        const state = await loadState(config);
        const stalledTasks = getStalledTasks(state);

        return successResult({
          success: true,
          count: stalledTasks.length,
          stalledTasks: stalledTasks.map((t) => ({
            id: t.id,
            taskName: t.taskName,
            lastUpdated: t.lastUpdated,
            stallDetection: t.stallDetection,
          })),
        });
      } catch (err) {
        return errorResult(String(err));
      }
    },
  });

  if (shouldLog('info', config.logLevel)) {
    console.info('[rloop] Tools registered:');
    console.info('  - rloop_register_task: Register a new task with steps');
    console.info('  - rloop_update_step: Update step status');
    console.info('  - rloop_heartbeat: Send task heartbeat');
    console.info('  - rloop_get_task: Get task status');
    console.info('  - rloop_complete_task: Mark task completed');
    console.info('  - rloop_fail_task: Mark task failed');
    console.info('  - rloop_list_tasks: List all tasks');
    console.info('  - rloop_check_stalled: Check for stalled tasks');
  }
}
