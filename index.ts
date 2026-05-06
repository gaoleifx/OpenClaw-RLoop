/**
 * RLoop - OpenClaw Task Monitor Plugin
 * 
 * Step-based task tracking with stall detection. Agents register a task
 * with detailed steps upfront, then update each step as they progress.
 * The plugin monitors for stalls and can notify the agent to continue.
 */

import { definePluginEntry, emptyPluginConfigSchema } from './src/openclaw-sdk.js';
import type { OpenClawPluginApi } from './src/openclaw-sdk.js';
import type { RalphLoopConfig } from './src/types.js';
import { validateConfig, shouldLog } from './src/config.js';
import { loadState, saveState } from './src/state-manager.js';
import { startMonitor, stopMonitor, isMonitorRunning } from './src/task-monitor.js';
import { registerHooks } from './src/hooks-handler.js';
import { registerTools } from './src/tools-handler.js';
import { dirname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';

// Plugin singleton
let pluginConfig: RalphLoopConfig | null = null;

/**
 * Resolve state directory path
 * - "workspace" -> agent's workspace + "/state"
 * - "./state" -> relative to plugin directory
 * - absolute path -> use as-is
 */
function resolveStateDirectory(api: OpenClawPluginApi, configuredPath: string): string {
  if (configuredPath !== 'workspace') {
    return configuredPath;
  }

  // Try to get workspace from API
  const workspace = (api as Record<string, unknown>).workspace as string | undefined;
  
  if (workspace) {
    const statePath = join(workspace, 'state');
    if (!existsSync(statePath)) {
      mkdirSync(statePath, { recursive: true });
    }
    return statePath;
  }

  // Fallback: use plugin directory
  const pluginDir = dirname(require.resolve('./index.js'));
  const statePath = join(pluginDir, 'state');
  if (!existsSync(statePath)) {
    mkdirSync(statePath, { recursive: true });
  }
  return statePath;
}

/**
 * Plugin definition
 */
const plugin = {
  id: 'rloop',
  name: 'RLoop',
  description: 'Step-based task monitoring with stall detection. Register tasks with detailed steps, track progress, detect stalls, and continue long-running tasks.',
  configSchema: emptyPluginConfigSchema(),

  register(api: OpenClawPluginApi): void {
    const rawConfig = api.pluginConfig || {};
    let validatedConfig = validateConfig(rawConfig);

    const resolvedStateDir = resolveStateDirectory(api, validatedConfig.stateDirectory);
    validatedConfig = { ...validatedConfig, stateDirectory: resolvedStateDir };
    
    pluginConfig = validatedConfig;

    if (shouldLog('info', pluginConfig.logLevel)) {
      console.info('[rloop] Plugin registering...');
      console.info(`[rloop] State directory: ${pluginConfig.stateDirectory}`);
      console.info(`[rloop] Poll interval: ${pluginConfig.pollIntervalMs}ms`);
      console.info(`[rloop] Stall timeout: ${pluginConfig.defaultStallTimeoutMs}ms`);
    }

    // Initialize state file (verify it exists)
    loadState(pluginConfig).catch((error) => {
      if (shouldLog('error', pluginConfig!.logLevel)) {
        console.error('[rloop] State initialization failed:', error);
      }
    });

    // Start background monitor
    startMonitor(api, pluginConfig);

    // Register hooks
    registerHooks(api, pluginConfig);

    // Register tools
    registerTools(api, pluginConfig);

    // Register HTTP routes
    api.registerHttpRoute({
      path: '/rloop/status',
      handler: async (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          running: isMonitorRunning(),
          stateDirectory: pluginConfig!.stateDirectory,
          pollIntervalMs: pluginConfig!.pollIntervalMs,
          stallTimeoutMs: pluginConfig!.defaultStallTimeoutMs,
        }));
      },
    });

    api.registerHttpRoute({
      path: '/rloop/tasks',
      handler: async (_req, res) => {
        const state = await loadState(pluginConfig!);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(state.tasks));
      },
    });

    api.registerHttpRoute({
      path: '/rloop/tasks/:status',
      handler: async (req, res) => {
        const state = await loadState(pluginConfig!);
        const status = req.params?.status;
        const filtered = state.tasks.filter((t) => t.status === status);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(filtered));
      },
    });

    if (shouldLog('info', pluginConfig.logLevel)) {
      console.info('[rloop] Plugin registered successfully');
      console.info('[rloop] HTTP routes: /rloop/status, /rloop/tasks, /rloop/tasks/:status');
    }
  },

  activate(api: OpenClawPluginApi): void {
    if (shouldLog('info', pluginConfig?.logLevel || 'info')) {
      console.info('[rloop] Plugin activated');
    }
  },

  deactivate(): void {
    stopMonitor();
    if (shouldLog('info', pluginConfig?.logLevel || 'info')) {
      console.info('[rloop] Plugin deactivated');
    }
  },
};

export default definePluginEntry({
  ...plugin,
});
