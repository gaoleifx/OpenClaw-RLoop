import * as esbuild from 'esbuild';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Read the actual index.ts source to get the register/activate/deactivate logic
import { readFileSync } from 'fs';

const indexSrc = readFileSync(join(__dirname, 'src', 'openclaw-sdk.ts'), 'utf-8');
const hooksSrc = readFileSync(join(__dirname, 'src', 'hooks-handler.ts'), 'utf-8');
const toolsSrc = readFileSync(join(__dirname, 'src', 'tools-handler.ts'), 'utf-8');
const taskSrc = readFileSync(join(__dirname, 'src', 'task-monitor.ts'), 'utf-8');
const sessionSrc = readFileSync(join(__dirname, 'src', 'session-monitor-poller.ts'), 'utf-8');
const stateSrc = readFileSync(join(__dirname, 'src', 'state-manager.ts'), 'utf-8');
const configSrc = readFileSync(join(__dirname, 'src', 'config.ts'), 'utf-8');
const typesSrc = readFileSync(join(__dirname, 'src', 'types.ts'), 'utf-8');

const indexContent = `
${typesSrc}
${configSrc}
${stateSrc}
${taskSrc}
${sessionSrc}
${hooksSrc}
${toolsSrc}
${indexSrc}

let pluginConfig = null;

function resolveStateDirectory(api, configuredPath) {
  if (configuredPath !== 'workspace') return configuredPath;
  const workspace = (api || {}).workspace || '';
  if (workspace) {
    const statePath = join(workspace, 'state');
    if (!existsSync(statePath)) mkdirSync(statePath, { recursive: true });
    return statePath;
  }
  const pluginDir = dirname(fileURLToPath(import.meta.url));
  const statePath = join(pluginDir, 'state');
  if (!existsSync(statePath)) mkdirSync(statePath, { recursive: true });
  return statePath;
}

const rloopPlugin = {
  id: 'rloop',
  name: 'RLoop',
  description: 'Step-based task monitoring with stall detection.',
  configSchema: { type: 'object', properties: {}, additionalProperties: true },

  register(api) {
    const rawConfig = (api.pluginConfig || {});
    let validatedConfig = validateConfig(rawConfig);
    const resolvedStateDir = resolveStateDirectory(api, validatedConfig.stateDirectory);
    validatedConfig = { ...validatedConfig, stateDirectory: resolvedStateDir };
    pluginConfig = validatedConfig;

    console.info('[rloop] Plugin registering...');
    console.info('[rloop] State directory: ' + pluginConfig.stateDirectory);

    loadState(pluginConfig).catch(e => { console.error('[rloop] State init failed:', e); });
    startMonitor(api, pluginConfig);
    startSessionMonitorPoller(api, pluginConfig);
    registerHooks(api, pluginConfig);
    registerTools(api, pluginConfig);

    api.registerHttpRoute({ path: '/rloop/status', handler: async (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ running: isMonitorRunning(), stateDirectory: pluginConfig.stateDirectory }));
    }});
    api.registerHttpRoute({ path: '/rloop/tasks', handler: async (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      const state = await loadState(pluginConfig);
      res.end(JSON.stringify(state.tasks));
    }});
    api.registerHttpRoute({ path: '/rloop/tasks/:status', handler: async (req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      const state = await loadState(pluginConfig);
      const filtered = state.tasks.filter(t => t.status === req.params?.status);
      res.end(JSON.stringify(filtered));
    }});

    console.info('[rloop] Plugin registered successfully');
  },

  deactivate() {
    stopMonitor();
    stopSessionMonitorPoller();
  }
};

export default rloopPlugin;
`;

await esbuild.build({
  stdin: {
    resolveDir: __dirname,
    sourcefile: 'index.ts',
    contents: indexContent,
  },
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile: join(__dirname, 'index.js'),
  sourcemap: true,
  external: ['@larksuite/openclaw-lark', '@larksuiteoapi/node-sdk', 'uuid', 'zod'],
  logLevel: 'info',
});

console.log('Build complete: index.js');
