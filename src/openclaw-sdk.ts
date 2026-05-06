/**
 * Type shims for OpenClaw Plugin SDK
 * 
 * These types are normally provided by the OpenClaw SDK which is bundled
 * with OpenClaw itself, not available as a separate npm package.
 * 
 * When this plugin is loaded by OpenClaw, the actual SDK types will be used.
 */

/**
 * OpenClaw Plugin API - passed to register() and activate()
 */
export interface OpenClawPluginApi {
  /** Plugin identifier */
  readonly id: string;
  
  /** Plugin name */
  readonly name: string;
  
  /** Plugin-specific configuration */
  readonly pluginConfig: Record<string, unknown>;
  
  /** Runtime services */
  readonly runtime: OpenClawRuntime;
  
  /** Registration mode */
  readonly registrationMode: 'full' | 'discovery' | 'setup-only' | 'setup-runtime' | 'cli-metadata';
  
  /** Register an agent tool */
  registerTool(tool: AgentTool, opts?: { optional?: boolean; names?: string[] }): void;
  
  /** Register a lifecycle hook */
  registerHook<K extends keyof HookEvents>(
    name: K,
    handler: HookHandler<K>,
    opts?: { priority?: number; timeoutMs?: number; name?: string }
  ): void;
  
  /** Register a channel plugin */
  registerChannel(channel: ChannelPlugin): void;
  
  /** Register a background service */
  registerService(service: Service): void;
  
  /** Register an HTTP route */
  registerHttpRoute(route: HttpRoute): void;
  
  /** Register a global HTTP handler */
  registerGlobalHttpHandler(handler: GlobalHttpHandler): void;
  
  /** Register CLI commands */
  registerCli(registrar: CliRegistrar, opts?: { name?: string }): void;
  
  /** Register a plugin command */
  registerCommand(command: PluginCommand): void;
  
  /** Register session extension */
  registerSessionExtension(extension: SessionExtension): void;
  
  /** Enqueue next turn injection */
  enqueueNextTurnInjection(injection: TurnInjection): void;
  
  /** Resolve path relative to plugin source */
  resolvePath(...segments: string[]): string;
  
  /** Logger */
  logger: Logger;
}

/** Agent Tool definition */
export interface AgentTool {
  name: string;
  description: string;
  inputSchema?: unknown; // JSON Schema for tool input
  parameters?: unknown; // Alternative JSON Schema
  handler?: (args: Record<string, unknown>) => Promise<unknown>; // Tool handler
  execute?(id: string, params: Record<string, unknown>): Promise<ToolResult>;
}

/** Tool result */
export interface ToolResult {
  content: Array<{ type: 'text' | 'image'; text?: string; data?: string; mimeType?: string }>;
  isError?: boolean;
}

/** Hook event types */
export interface HookEvents {
  agent_start: AgentStartHookEvent;
  agent_end: AgentEndHookEvent;
  before_agent_start: BeforeAgentStartHookEvent;
  before_tool_call: BeforeToolCallHookEvent;
  after_tool_call: AfterToolCallHookEvent;
  llm_input: LlmInputHookEvent;
  llm_output: LlmOutputHookEvent;
  before_prompt_build: BeforePromptBuildHookEvent;
  agent_finalize: AgentFinalizeHookEvent;
  gateway_start: GatewayStartHookEvent;
  gateway_stop: GatewayStopHookEvent;
  session_start: SessionStartHookEvent;
  session_end: SessionEndHookEvent;
}

/** Hook event base */
export interface HookEventBase {
  context: HookContext;
}

/** Hook context */
export interface HookContext {
  agent?: { id: string; name: string };
  session?: { id: string };
  pluginConfig?: Record<string, unknown>;
}

/** Agent start hook event */
export interface AgentStartHookEvent extends HookEventBase {
  agent: { id: string; name: string };
  session: { id: string };
  timestamp: string;
}

/** Agent end hook event */
export interface AgentEndHookEvent extends HookEventBase {
  agent: { id: string; name: string };
  session: { id: string };
  timestamp: string;
  success?: boolean;
  error?: string;
}

/** Before agent start hook event */
export interface BeforeAgentStartHookEvent extends HookEventBase {
  agent: { id: string; name: string };
  session: { id: string };
  timestamp: string;
}

/** Before tool call hook event */
export interface BeforeToolCallHookEvent extends HookEventBase {
  toolName: string;
  session: { id: string };
}

/** After tool call hook event */
export interface AfterToolCallHookEvent extends HookEventBase {
  toolName: string;
  session: { id: string };
  result?: unknown;
}

/** LLM input hook event */
export interface LlmInputHookEvent extends HookEventBase {
  provider: string;
  model: string;
  messages: unknown[];
}

/** LLM output hook event */
export interface LlmOutputHookEvent extends HookEventBase {
  provider: string;
  model: string;
  response: unknown;
}

/** Before prompt build hook event */
export interface BeforePromptBuildHookEvent extends HookEventBase {
  agent: { id: string; name: string };
  session: { id: string };
}

/** Agent finalize hook event */
export interface AgentFinalizeHookEvent extends HookEventBase {
  agent: { id: string; name: string };
  session: { id: string };
  finalResponse: unknown;
}

/** Gateway start hook event */
export interface GatewayStartHookEvent extends HookEventBase {
  config: unknown;
  configDir: string;
}

/** Gateway stop hook event */
export interface GatewayStopHookEvent extends HookEventBase {
  // No additional fields
}

/** Session start hook event */
export interface SessionStartHookEvent extends HookEventBase {
  session: { id: string };
  agent: { id: string; name: string };
}

/** Session end hook event */
export interface SessionEndHookEvent extends HookEventBase {
  session: { id: string };
  agent: { id: string; name: string };
}

/** Hook handler type */
export type HookHandler<K extends keyof HookEvents> = (
  event: HookEvents[K],
  context: HookContext
) => Promise<HookResult | void>;

/** Hook result */
export interface HookResult {
  requireApproval?: {
    title: string;
    description: string;
    severity: 'info' | 'warn' | 'error';
    timeoutMs?: number;
    timeoutBehavior?: 'allow' | 'deny';
  };
  prependSystemContext?: string;
  appendSystemContext?: string;
  prependContext?: unknown[];
  appendContext?: unknown[];
}

/** Channel plugin */
export interface ChannelPlugin {
  id: string;
  name: string;
  description: string;
  capabilities?: string[];
}

/** Service definition */
export interface Service {
  name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
}

/** HTTP route */
export interface HttpRoute {
  path: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  handler: (req: HttpRequest, res: HttpResponse) => Promise<void>;
}

/** HTTP request */
export interface HttpRequest {
  params?: Record<string, string>;
  query?: Record<string, string>;
  body?: unknown;
  headers?: Record<string, string>;
}

/** HTTP response */
export interface HttpResponse {
  writeHead(status: number, headers?: Record<string, string>): void;
  end(data?: string): void;
}

/** Global HTTP handler */
export type GlobalHttpHandler = (req: HttpRequest, res: HttpResponse) => Promise<boolean | void>;

/** CLI registrar */
export interface CliRegistrar {
  command(name: string, description: string, handler: CliHandler): void;
}

/** CLI handler */
export type CliHandler = (args: string[], opts: Record<string, unknown>) => Promise<void>;

/** Plugin command */
export interface PluginCommand {
  name: string;
  description: string;
  handler: (args: string[]) => Promise<void>;
}

/** Session extension */
export interface SessionExtension {
  key: string;
  initialValue?: unknown;
}

/** Turn injection */
export interface TurnInjection {
  idempotencyKey: string;
  content: unknown;
  expiresAt?: number;
}

/** OpenClaw runtime services */
export interface OpenClawRuntime {
  media: unknown;
  messaging: unknown;
  logging: unknown;
}

/** Logger interface */
export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

/** Define plugin entry function */
export interface DefinePluginEntryOptions {
  id: string;
  name: string;
  description: string;
  kind?: string;
  configSchema?: unknown;
  register(api: OpenClawPluginApi): void;
  activate?(api: OpenClawPluginApi): void;
}

export function definePluginEntry(options: DefinePluginEntryOptions): unknown {
  return options;
}

/** Create an empty plugin config schema */
export function emptyPluginConfigSchema(): unknown {
  return {
    type: 'object',
    properties: {},
    additionalProperties: true,
  };
}
