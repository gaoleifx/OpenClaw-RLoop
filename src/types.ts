/**
 * Type definitions for rloop plugin - Step-based Task Tracking
 */

// Step status enum
export type StepStatus = 'pending' | 'running' | 'completed' | 'failed';

// Task status enum
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'stalled';

// Individual step entry
export interface Step {
  id: number;
  desc: string;
  status: StepStatus;
  updatedAt: string | null;
  error?: string | null;
}

// Progress tracking (by step count)
export interface TaskProgress {
  currentStep: number;  // index of current running step
  totalSteps: number;   // total number of steps
  completedSteps: number;
}

// Stall detection config
export interface StallConfig {
  enabled: boolean;
  stallTimeoutMs: number;
  lastHeartbeat: string | null;
}

// Task metadata stored in data field
export interface TaskData {
  agentId: string;
  retryCount: number;
  maxRetries: number;
  errorDetails: string | null;
  callbackUrl: string | null;
  metadata: Record<string, unknown>;
}

// Individual task entry
export interface Task {
  id: string;
  taskName: string;
  status: TaskStatus;
  createdAt: string;
  lastUpdated: string;
  steps: Step[];
  progress: TaskProgress;
  stallDetection: StallConfig;
  data: TaskData;
}

// Complete state file structure
export interface State {
  tasks: Task[];
  version: string;
}

// Step report configuration
export interface StepReportConfig {
  enabled: boolean;
  onComplete: boolean;  // Report when step completed
  onStart: boolean;      // Report when step starts
  onFailure: boolean;    // Report when step fails
  onStalled: boolean;   // Report when task stalled
  notifyFeishu: boolean;  // Send Feishu DM notification
  feishuUserId: string;   // Feishu open_id to DM
}

// Session monitor config
interface SessionMonitorConfig {
  enabledByDefault: boolean;
  triggerPhrases: string[];       // phrases to enable monitoring
  deactivatePhrases: string[];    // phrases to disable monitoring
  silenceThresholdMs: number;     // default 3 minutes = 180000ms
  reminderText: string;           // reminder message to inject
  maxRemindersPerSession: number; // stop reminding after N times
  pollIntervalMs: number;         // polling interval in ms (default 60000)
  feishuApiAppId: string;         // Feishu API app ID
  feishuApiAppSecret: string;     // Feishu API app secret
}
// Plugin configuration
export interface RalphLoopConfig {
  stateDirectory: string;
  stateFile: string;
  pollIntervalMs: number;
  enableAutoRetry: boolean;
  maxRetries: number;
  retryDelayMs: number;
  defaultStallTimeoutMs: number;
  onFailure: {
    type: 'callback' | 'log' | 'none';
    callbackUrl: string | null;
  };
  stepReport: StepReportConfig;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  sessionMonitor: SessionMonitorConfig;
}

// Default session monitor config
const DEFAULT_SESSION_MONITOR: SessionMonitorConfig = {
  enabledByDefault: false,
  triggerPhrases: ['开启监控', '/monitor', 'monitor on'],
  deactivatePhrases: ['关闭监控', '/unmonitor', 'monitor off'],
  silenceThresholdMs: 180_000,  // 3 minutes
  reminderText: `\n\n⚠️ SESSION MONITOR REMINDER:\nDetected prolonged silence in this session.\nIf you have any task in progress, please do NOT pause — continue execution until completion.\nUse rloop_heartbeat to report progress, or rloop_update_step to advance.\nIf the task is blocked, report the blocker and await further instructions.`,
  maxRemindersPerSession: 5,
  pollIntervalMs: 60_000,  // poll every 60 seconds
  feishuApiAppId: '',
  feishuApiAppSecret: '',
};

// Default configuration
export const DEFAULT_CONFIG: RalphLoopConfig = {
  stateDirectory: 'workspace',
  stateFile: 'STATE.json',
  pollIntervalMs: 30000,      // 30秒检查一次
  enableAutoRetry: true,
  maxRetries: 3,
  retryDelayMs: 30000,
  defaultStallTimeoutMs: 300000,  // 5分钟
  onFailure: {
    type: 'log',
    callbackUrl: null,
  },
  stepReport: {
    enabled: false,
    onComplete: true,
    onStart: false,
    onFailure: true,
    onStalled: true,
    notifyFeishu: false,
    feishuUserId: '',
  },
  logLevel: 'info',
  sessionMonitor: DEFAULT_SESSION_MONITOR,
};

// Agent lifecycle hook events
export interface AgentStartEvent {
  agentId: string;
  agentName: string;
  sessionId: string;
  timestamp: string;
}

export interface AgentEndEvent {
  agentId: string;
  agentName: string;
  sessionId: string;
  timestamp: string;
  success: boolean;
  error?: string;
}

export interface ToolCallEvent {
  agentId: string;
  agentName: string;
  toolName: string;
  sessionId: string;
  timestamp: string;
}

// State change event for monitoring
export interface StateChangeEvent {
  taskId: string;
  previousStatus: TaskStatus;
  newStatus: TaskStatus;
  timestamp: string;
}

// File lock for concurrent access
export interface FileLock {
  acquired: boolean;
  released: boolean;
}

// Session monitor state per session
export interface SessionMonitorEntry {
  enabled: boolean;
  activatedAt: number;       // ms timestamp when monitoring was activated
  lastMessageAt: number;      // ms timestamp of last user message
  silenceThresholdMs: number; // silence threshold to trigger reminder
  feishuUserId?: string;      // open_id for DM delivery
  reminderCount?: number;    // number of reminders sent in this session
}

export interface SessionMonitorState {
  [sessionId: string]: SessionMonitorEntry;
}

// Before prompt build hook event
export interface BeforePromptBuildHookEvent {
  agent?: { id: string; name: string };
  session?: { id: string };
  timestamp: string;
  messages?: unknown[];
}
