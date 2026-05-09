/**
 * Session Monitor Poller
 * Background timer that checks for prolonged user silence in monitored sessions.
 * Runs independently of hook timing — uses setInterval to poll session state.
 */

import type { OpenClawPluginApi } from './openclaw-sdk.js';
import type { RalphLoopConfig } from './types.js';
import { shouldLog } from './config.js';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';

// Types for session monitor state
interface SessionMonitorEntry {
  enabled: boolean;
  activatedAt: number;
  lastMessageAt: number;
  silenceThresholdMs: number;
  // New: persist the Feishu open_id for DM delivery
  feishuUserId?: string;
  reminderCount?: number;
}

interface SessionMonitorState {
  [sessionId: string]: SessionMonitorEntry;
}

const MONITOR_STATE_FILE = 'session-monitor.json';

let pollInterval: ReturnType<typeof setInterval> | null = null;
let apiInstance: OpenClawPluginApi | null = null;
let configInstance: RalphLoopConfig | null = null;

// ---------------------------------------------------------------------------
// State file operations
// ---------------------------------------------------------------------------

function getMonitorStateFilePath(config: RalphLoopConfig): string {
  return `${config.stateDirectory}/${MONITOR_STATE_FILE}`;
}

async function ensureDir(path: string): Promise<void> {
  if (!existsSync(path)) {
    await mkdir(path, { recursive: true });
  }
}

async function loadSessionMonitorState(config: RalphLoopConfig): Promise<SessionMonitorState> {
  try {
    const filePath = getMonitorStateFilePath(config);
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

async function saveSessionMonitorState(config: RalphLoopConfig, state: SessionMonitorState): Promise<void> {
  await ensureDir(config.stateDirectory);
  const filePath = getMonitorStateFilePath(config);
  const content = JSON.stringify(state, null, 2);
  await writeFile(filePath, content, 'utf-8');
}

// ---------------------------------------------------------------------------
// Feishu DM delivery using @larksuiteoapi/node-sdk
// ---------------------------------------------------------------------------

async function sendFeishuReminder(toOpenId: string, text: string): Promise<void> {
  if (!configInstance) return;
  
  const { feishuApiAppId, feishuApiAppSecret } = configInstance.sessionMonitor;
  if (!feishuApiAppId || !feishuApiAppSecret) {
    if (shouldLog('debug', configInstance.logLevel)) {
      console.debug('[rloop] Feishu API not configured (feishuApiAppId/feishuApiAppSecret missing), skipping notification');
    }
    return;
  }

  try {
    const { Client } = await import('@larksuiteoapi/node-sdk');
    
    const client = new Client({
      appId: feishuApiAppId,
      appSecret: feishuApiAppSecret,
    });

    await client.im.message.create({
      params: {
        receive_id_type: 'open_id',
      },
      data: {
        receive_id: toOpenId,
        content: JSON.stringify({ text }),
        msg_type: 'text',
      },
    });

    if (shouldLog('debug', configInstance.logLevel)) {
      console.debug(`[rloop] Feishu reminder sent to ${toOpenId}`);
    }
  } catch (err) {
    console.warn('[rloop] Feishu reminder send error:', err);
  }
}

// ---------------------------------------------------------------------------
// Polling logic
// ---------------------------------------------------------------------------

async function checkSessions(): Promise<void> {
  if (!configInstance) return;

  const state = await loadSessionMonitorState(configInstance);
  const now = Date.now();
  let changed = false;

  for (const [sessionId, entry] of Object.entries(state)) {
    if (!entry.enabled) continue;

    // Skip sessions without a Feishu user id (can't DM)
    if (!entry.feishuUserId) {
      if (shouldLog('debug', configInstance.logLevel)) {
        console.debug(`[rloop] Session ${sessionId} monitored but no feishuUserId, skipping`);
      }
      continue;
    }

    const silentForMs = now - entry.lastMessageAt;
    const maxReminders = configInstance.sessionMonitor.maxRemindersPerSession ?? 5;
    const reminderCount = entry.reminderCount ?? 0;

    if (silentForMs >= entry.silenceThresholdMs && reminderCount < maxReminders) {
      // Build reminder text
      const reminderText = buildReminderText(sessionId, silentForMs, reminderCount, maxReminders);

      if (shouldLog('info', configInstance.logLevel)) {
        console.info(`[rloop] Sending session reminder for ${sessionId} (silent ${Math.round(silentForMs / 1000)}s, count ${reminderCount + 1}/${maxReminders})`);
      }

      // Send DM
      await sendFeishuReminder(entry.feishuUserId, reminderText);

      // Update count
      entry.reminderCount = reminderCount + 1;
      changed = true;
    }
  }

  if (changed) {
    await saveSessionMonitorState(configInstance, state);
  }
}

function buildReminderText(sessionId: string, silentForMs: number, count: number, max: number): string {
  const minutes = Math.round(silentForMs / 60000);
  return `⚠️ SESSION MONITOR REMINDER (${count + 1}/${max})

Detected prolonged silence (${minutes}+ minutes) in session ${sessionId.slice(0, 8)}....

If you have any task in progress, please do NOT pause — continue execution until completion.
Use rloop_heartbeat to report progress, or rloop_update_step to advance.
If the task is blocked, report the blocker and await further instructions.

This reminder will stop after ${max} occurrences.`;
}

// ---------------------------------------------------------------------------
// Public API (called from plugin index)
// ---------------------------------------------------------------------------

export async function enableSessionMonitorWithUser(
  config: RalphLoopConfig,
  sessionId: string,
  feishuUserId: string,
  silenceThresholdMs?: number,
): Promise<void> {
  const state = await loadSessionMonitorState(config);
  const now = Date.now();
  state[sessionId] = {
    enabled: true,
    activatedAt: now,
    lastMessageAt: now,
    silenceThresholdMs: silenceThresholdMs ?? config.sessionMonitor.silenceThresholdMs,
    feishuUserId,
    reminderCount: 0,
  };
  await saveSessionMonitorState(config, state);
  if (shouldLog('info', config.logLevel)) {
    console.info(`[rloop] Session monitor enabled for ${sessionId} (user: ${feishuUserId})`);
  }
}

export async function updateSessionLastMessage(config: RalphLoopConfig, sessionId: string): Promise<void> {
  const state = await loadSessionMonitorState(config);
  if (state[sessionId]?.enabled) {
    state[sessionId].lastMessageAt = Date.now();
    // Reset reminder count when user sends a new message
    state[sessionId].reminderCount = 0;
    await saveSessionMonitorState(config, state);
  }
}

export async function disableSessionMonitor(config: RalphLoopConfig, sessionId: string): Promise<void> {
  const state = await loadSessionMonitorState(config);
  if (state[sessionId]) {
    state[sessionId].enabled = false;
    await saveSessionMonitorState(config, state);
    if (shouldLog('info', config.logLevel)) {
      console.info(`[rloop] Session monitor disabled for ${sessionId}`);
    }
  }
}

export function startSessionMonitorPoller(api: OpenClawPluginApi, config: RalphLoopConfig): void {
  if (pollInterval) {
    if (shouldLog('warn', config.logLevel)) {
      console.warn('[rloop] Session monitor poller already running, skipping start');
    }
    return;
  }

  apiInstance = api;
  configInstance = config;

  const pollIntervalMs = config.sessionMonitor?.pollIntervalMs ?? 60_000;

  if (shouldLog('info', config.logLevel)) {
    console.info(`[rloop] Starting session monitor poller (${pollIntervalMs}ms interval)`);
  }

  // Run immediately once on start
  checkSessions().catch(err => {
    if (shouldLog('error', configInstance?.logLevel)) {
      console.error('[rloop] Session monitor poll error:', err);
    }
  });

  // Then run on schedule
  pollInterval = setInterval(() => {
    checkSessions().catch(err => {
      if (configInstance && shouldLog('error', configInstance.logLevel)) {
        console.error('[rloop] Session monitor poll error:', err);
      }
    });
  }, pollIntervalMs);
}

export function stopSessionMonitorPoller(): void {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
    if (configInstance && shouldLog('info', configInstance.logLevel)) {
      console.info('[rloop] Session monitor poller stopped');
    }
  }
  apiInstance = null;
  configInstance = null;
}

export function isSessionMonitorPollerRunning(): boolean {
  return pollInterval !== null;
}