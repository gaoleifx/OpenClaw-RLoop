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
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

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
  logLevel: 'info',
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

// Before prompt build hook event
export interface BeforePromptBuildHookEvent {
  agent?: { id: string; name: string };
  session?: { id: string };
  timestamp: string;
  messages?: unknown[];
}
