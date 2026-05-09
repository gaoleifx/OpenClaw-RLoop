/**
 * Hooks Handler - Integrates with OpenClaw agent lifecycle hooks
 * Features:
 * - Check for stalled tasks and inject prompts to continue
 * - Session monitor mode: inject reminder when session is silent for too long
 */

import type { OpenClawPluginApi } from './openclaw-sdk.js';
import type { RalphLoopConfig, AgentStartEvent, ToolCallEvent } from './types.js';
import {
  loadState,
  getStalledTasks,
  loadMonitorState,
  enableSessionMonitor,
  disableSessionMonitor,
  updateSessionLastMessage,
  shouldTriggerReminder,
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
 * Get the latest user message text from messages array
 * messages is an array of { role: string, content: string | unknown[] } objects
 */
function getLatestUserMessage(messages: unknown[] | undefined): string {
  if (!messages || !Array.isArray(messages)) return '';

  // Iterate from the end to find the most recent user message
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as { role?: string; content?: unknown };
    if (msg && msg.role === 'user') {
      if (typeof msg.content === 'string') {
        return msg.content;
      } else if (Array.isArray(msg.content)) {
        // Handle content as array (e.g., [{ type: 'text', text: '...' }])
        const textPart = msg.content.find(
          (part: unknown) => typeof part === 'object' && (part as { type?: string }).type === 'text'
        );
        if (textPart && typeof (textPart as { text?: string }).text === 'string') {
          return (textPart as { text: string }).text;
        }
      }
    }
  }

  return '';
}

/**
 * Try to extract Feishu open_id from message sender metadata in event.messages
 * The OpenClaw Feishu integration embeds sender info in message objects
 */
function extractFeishuUserIdFromMessages(messages: unknown[] | undefined): string | undefined {
  if (!messages || !Array.isArray(messages)) return undefined;

  // Look through recent messages for Feishu sender metadata
  // Feishu messages may have sender info attached to the message object
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as Record<string, unknown>;
    if (!msg) continue;

    // Check sender_id field (set by Feishu channel integration)
    if (msg.sender_id && typeof msg.sender_id === 'string') {
      // sender_id format: 'ou_xxx' for Feishu users
      if (msg.sender_id.startsWith('ou_')) {
        return msg.sender_id;
      }
    }

    // Check for open_id in sender object
    const sender = msg.sender as Record<string, unknown> | undefined;
    if (sender && sender.open_id && typeof sender.open_id === 'string') {
      return sender.open_id;
    }

    // Check channel_context with feishu user info
    const channelContext = msg.channel_context as Record<string, unknown> | undefined;
    if (channelContext && channelContext.open_id && typeof channelContext.open_id === 'string') {
      return channelContext.open_id;
    }
  }

  return undefined;
}

/**
 * Check if message contains any trigger phrase (case-insensitive)
 */
function matchesPhrases(text: string, phrases: string[]): boolean {
  const lower = text.toLowerCase().trim();
  return phrases.some((phrase) => lower === phrase.toLowerCase() || lower.includes(phrase.toLowerCase()));
}

/**
 * Handle trigger phrase detection and session monitoring
 * Returns the prepend text if monitoring is active and silence threshold exceeded
 */
async function handleSessionMonitoring(
  config: RalphLoopConfig,
  sessionId: string,
  messages: unknown[] | undefined,
  feishuUserId?: string
): Promise<string> {
  // Always update last message timestamp if session is being monitored
  const monitorState = await loadMonitorState(config);
  const isMonitored = monitorState[sessionId]?.enabled ?? false;

  // Check for trigger phrases in the latest user message
  const latestUserMsg = getLatestUserMessage(messages);

  if (latestUserMsg) {
    // Check for activation phrases FIRST (before any other logic)
    if (matchesPhrases(latestUserMsg, config.sessionMonitor.triggerPhrases)) {
      await enableSessionMonitor(config, sessionId, config.sessionMonitor.silenceThresholdMs, feishuUserId);
      if (shouldLog('info', config.logLevel)) {
        console.info(`[rloop] Session monitor activated by trigger phrase: "${latestUserMsg.substring(0, 50)}" (user: ${feishuUserId ?? 'unknown'})`);
      }
      // After activating, update lastMessageAt immediately so the silence clock starts from NOW
      await updateSessionLastMessage(config, sessionId);
      return '';
    }

    // Check for deactivation phrases
    if (matchesPhrases(latestUserMsg, config.sessionMonitor.deactivatePhrases)) {
      await disableSessionMonitor(config, sessionId);
      if (shouldLog('info', config.logLevel)) {
        console.info(`[rloop] Session monitor deactivated by trigger phrase: "${latestUserMsg.substring(0, 50)}"`);
      }
      return '';
    }

    // ALWAYS update lastMessageAt for monitored sessions on any user message
    // This must happen for EVERY user message, not just non-trigger ones
    if (isMonitored) {
      await updateSessionLastMessage(config, sessionId);
    }
  }

  // Check if we should inject a reminder (silence exceeded threshold)
  if (isMonitored) {
    const trigger = await shouldTriggerReminder(config, sessionId);
    if (trigger) {
      if (shouldLog('info', config.logLevel)) {
        console.info(`[rloop] Session ${sessionId} silence exceeded threshold, injecting reminder`);
      }
      return config.sessionMonitor.reminderText;
    }
  }

  return '';
}

/**
 * Handle before_prompt_build hook
 * - Inject stalled task warning if any tasks are stalled
 * - Inject session monitor reminder if silence threshold exceeded
 */
async function handleBeforePromptBuild(
  api: OpenClawPluginApi,
  config: RalphLoopConfig,
  event: { agent?: { id: string; name: string }; session?: { id: string }; timestamp?: string; messages?: unknown[] }
): Promise<{ prependSystemContext?: string } | void> {
  if (shouldLog('debug', config.logLevel)) {
    console.debug(`[rloop] Before prompt build for agent: ${event.agent?.name || 'unknown'}`);
  }

  const sessionId = event.session?.id ?? 'unknown';

  // Try to extract Feishu open_id from message context for DM delivery
  const feishuUserId = extractFeishuUserIdFromMessages(event.messages);

  let prependText = '';

  try {
    // 1. Trigger stall check first
    await triggerStallCheck();

    // 2. Check for stalled tasks and format warning
    const state = await loadState(config);
    const stalledTasks = getStalledTasks(state);

    if (stalledTasks.length > 0) {
      if (shouldLog('info', config.logLevel)) {
        console.info(`[rloop] Injecting stalled task warning for ${stalledTasks.length} task(s)`);
        for (const task of stalledTasks) {
          console.info(`[rloop]   - ${task.taskName} (${task.id})`);
        }
      }
      prependText += formatStalledTaskWarning(stalledTasks);
    }

    // 3. Handle session monitoring (trigger phrase detection + silence reminder)
    // Pass feishuUserId so it can be stored in session-monitor.json for the poller
    const monitorReminder = await handleSessionMonitoring(config, sessionId, event.messages, feishuUserId);
    if (monitorReminder) {
      prependText += monitorReminder;
    }

    if (prependText) {
      return { prependSystemContext: prependText };
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
  // and also handles session monitoring
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