/**
 * Hooks Handler - Integrates with OpenClaw agent lifecycle hooks
 * Key feature: Check for stalled tasks and inject prompts to continue
 */

import type { OpenClawPluginApi } from './openclaw-sdk.js';
import type { RalphLoopConfig, AgentStartEvent, AgentEndEvent, ToolCallEvent } from './types.js';
import {
  loadState,
  getStalledTasks,
} from './state-manager.js';
import { triggerStallCheck } from './task-monitor.js';
import { shouldLog } from './config.js';

/**
 * Format stalled task warning for prompt injection
 */
function formatStalledTaskWarning(stalledTasks: ReturnType<typeof getStalledTasks>): string {
  if (stalledTasks.length === 0) return '';

  let warning = '\n\n⚠️ RLOOP STALLED TASK WARNING:\n';
  warning += 'Detected stalled task(s) that need continuation:\n\n';

  for (const task of stalledTasks) {
    warning += `📋 Task: "${task.taskName}" (ID: ${task.id})\n`;
    warning += `   Last updated: ${task.lastUpdated}\n`;

    // Show incomplete steps
    const incompleteSteps = task.steps.filter(
      (s) => s.status === 'pending' || s.status === 'running'
    );
    if (incompleteSteps.length > 0) {
      warning += '   Remaining steps:\n';
      for (const step of incompleteSteps) {
        warning += `   - Step ${step.id}: ${step.desc} [${step.status}]\n`;
      }
    }
    warning += '\n';
  }

  warning += 'Action required: Please call rloop_get_task with the task ID above to check status,\n';
  warning += 'then continue the task by calling rloop_update_step to progress through remaining steps.\n';
  warning += 'Use rloop_heartbeat if you need more time for the current step.\n\n';

  return warning;
}

/**
 * Handle before_prompt_build hook - inject stalled task warning into prompt
 * Uses event from openclaw-sdk (which has agent, session but no timestamp)
 */
async function handleBeforePromptBuild(
  api: OpenClawPluginApi,
  config: RalphLoopConfig,
  event: { agent?: { id: string; name: string }; session?: { id: string }; timestamp?: string; messages?: unknown[] }
): Promise<{ prependSystemContext?: string } | void> {
  if (shouldLog('debug', config.logLevel)) {
    console.debug(`[rloop] Before prompt build for agent: ${event.agent?.name || 'unknown'}`);
  }

  try {
    // First, trigger a stall check to update stalled status
    await triggerStallCheck();

    // Then check for any stalled tasks
    const state = await loadState(config);
    const stalledTasks = getStalledTasks(state);

    if (stalledTasks.length > 0) {
      if (shouldLog('info', config.logLevel)) {
        console.info(`[rloop] Injecting stalled task warning for ${stalledTasks.length} task(s)`);
        for (const task of stalledTasks) {
          console.info(`[rloop]   - ${task.taskName} (${task.id})`);
        }
      }

      // Return the warning text to prepend to system context
      const warning = formatStalledTaskWarning(stalledTasks);
      return { prependSystemContext: warning };
    }
  } catch (error) {
    if (shouldLog('error', config.logLevel)) {
      console.error('[rloop] Error in before_prompt_build:', error);
    }
  }
}

/**
 * Handle before_agent_start hook (legacy, still useful for logging)
 */
async function handleBeforeAgentStart(
  api: OpenClawPluginApi,
  config: RalphLoopConfig,
  event: AgentStartEvent
): Promise<void> {
  if (shouldLog('debug', config.logLevel)) {
    console.debug(`[rloop] Before agent start: ${event.agentName} (${event.agentId})`);
  }

  try {
    // First, trigger a stall check to update stalled status
    await triggerStallCheck();

    // Then check for any stalled tasks
    const state = await loadState(config);
    const stalledTasks = getStalledTasks(state);

    if (stalledTasks.length > 0 && shouldLog('info', config.logLevel)) {
      console.info(`[rloop] Found ${stalledTasks.length} stalled task(s) before agent start`);
      for (const task of stalledTasks) {
        console.info(`[rloop]   - ${task.taskName} (${task.id}) - last updated: ${task.lastUpdated}`);
      }
    }
  } catch (error) {
    if (shouldLog('error', config.logLevel)) {
      console.error('[rloop] Error in before_agent_start:', error);
    }
  }
}

/**
 * Handle after_tool_call hook
 * This runs AFTER any tool call - good time to refresh stall detection state
 */
async function handleAfterToolCall(
  api: OpenClawPluginApi,
  config: RalphLoopConfig,
  event: ToolCallEvent
): Promise<void> {
  // Refresh stall detection after any rloop tool call
  // This ensures the state is current
  if (event.toolName.startsWith('rloop_')) {
    await triggerStallCheck();
  }
}

/**
 * Register all hooks with OpenClaw
 */
export function registerHooks(api: OpenClawPluginApi, config: RalphLoopConfig): void {
  if (shouldLog('info', config.logLevel)) {
    console.info('[rloop] Registering OpenClaw hooks');
  }

  // Register before_prompt_build hook - this injects prompt when stalled tasks exist
  api.registerHook('before_prompt_build', async (event, ctx) => {
    if (!ctx.agent) return;
    return await handleBeforePromptBuild(api, config, event);
  }, { name: 'rloop-before-prompt-build' });

  // Register before_agent_start hook (legacy - still useful for logging)
  api.registerHook('before_agent_start', async (event, ctx) => {
    if (!ctx.agent) return;

    const startEvent: AgentStartEvent = {
      agentId: ctx.agent.id,
      agentName: ctx.agent.name,
      sessionId: ctx.session?.id || 'unknown',
      timestamp: new Date().toISOString(),
    };

    await handleBeforeAgentStart(api, config, startEvent);
  }, { name: 'rloop-before-agent-start' });

  // Register after_tool_call hook
  // This keeps stall state fresh after tool operations
  api.registerHook('after_tool_call', async (event, ctx) => {
    if (!ctx.agent) return;

    const toolEvent: ToolCallEvent = {
      agentId: ctx.agent.id,
      agentName: ctx.agent.name,
      toolName: event.toolName,
      sessionId: ctx.session?.id || 'unknown',
      timestamp: new Date().toISOString(),
    };

    await handleAfterToolCall(api, config, toolEvent);
  }, { name: 'rloop-after-tool-call' });

  if (shouldLog('info', config.logLevel)) {
    console.info('[rloop] Hooks registered: before_prompt_build, before_agent_start, after_tool_call');
  }
}
