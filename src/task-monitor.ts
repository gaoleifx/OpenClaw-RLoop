/**
 * Task Monitor - Background timer for stall detection
 */

import type { OpenClawPluginApi } from './openclaw-sdk.js';
import type { RalphLoopConfig } from './types.js';
import { checkAndMarkStalledTasks } from './state-manager.js';
import { shouldLog } from './config.js';

let monitorInterval: ReturnType<typeof setInterval> | null = null;
let apiInstance: OpenClawPluginApi | null = null;
let configInstance: RalphLoopConfig | null = null;

/** Send stall report to callback URL */
async function sendStallReport(taskId: string, taskName: string): Promise<void> {
  if (!configInstance || !configInstance.stepReport.enabled || configInstance.onFailure.type !== 'callback' || !configInstance.onFailure.callbackUrl) {
    return;
  }
  try {
    await fetch(configInstance.onFailure.callbackUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'stalled',
        taskId,
        taskName,
        timestamp: new Date().toISOString(),
        message: `⚠️ 任务疑似卡住: ${taskName}`,
      }),
    });
  } catch (err) {
    console.warn('[rloop] Stall report callback failed:', err);
  }
}

/**
 * Start the background monitor
 */
export function startMonitor(api: OpenClawPluginApi, config: RalphLoopConfig): void {
  if (monitorInterval) {
    if (shouldLog('warn', config.logLevel)) {
      console.warn('[rloop] Monitor already running, skipping start');
    }
    return;
  }

  apiInstance = api;
  configInstance = config;

  if (shouldLog('info', config.logLevel)) {
    console.info(`[rloop] Starting task monitor with ${config.pollIntervalMs}ms interval`);
  }

  // Run immediately once
  runStallCheck();

  // Then run periodically
  monitorInterval = setInterval(() => {
    runStallCheck();
  }, config.pollIntervalMs);
}

/**
 * Stop the background monitor
 */
export function stopMonitor(): void {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
    if (configInstance && shouldLog('info', configInstance.logLevel)) {
      console.info('[rloop] Task monitor stopped');
    }
  }
  apiInstance = null;
  configInstance = null;
}

/**
 * Run a single stall check
 */
async function runStallCheck(): Promise<void> {
  if (!configInstance) {
    return;
  }

  try {
    const stalledIds = await checkAndMarkStalledTasks(configInstance);

    if (stalledIds.length > 0) {
      if (shouldLog('warn', configInstance.logLevel)) {
        console.warn(`[rloop] Detected ${stalledIds.length} stalled task(s): ${stalledIds.join(', ')}`);
      }
      // Fire stall report callbacks
      for (const id of stalledIds) {
        sendStallReport(id, '').catch(() => {});
      }
    }
  } catch (err) {
    if (configInstance && shouldLog('error', configInstance.logLevel)) {
      console.error('[rloop] Error during stall check:', err);
    }
  }
}

/**
 * Check if monitor is running
 */
export function isMonitorRunning(): boolean {
  return monitorInterval !== null;
}

/**
 * Trigger a manual check (can be called from a hook or tool)
 */
export async function triggerStallCheck(): Promise<string[]> {
  if (!configInstance) {
    return [];
  }

  try {
    return await checkAndMarkStalledTasks(configInstance);
  } catch {
    return [];
  }
}
