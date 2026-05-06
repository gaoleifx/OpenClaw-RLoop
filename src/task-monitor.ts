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

    if (stalledIds.length > 0 && shouldLog('warn', configInstance.logLevel)) {
      console.warn(`[rloop] Detected ${stalledIds.length} stalled task(s): ${stalledIds.join(', ')}`);
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
