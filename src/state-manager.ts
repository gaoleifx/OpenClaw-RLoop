/**
 * State Manager - Handles STATE.json read/write with step-based task tracking
 */

import { readFile, writeFile, mkdir, access, constants } from 'fs/promises';
import { dirname, join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { State, Task, TaskStatus, Step, StepStatus, RalphLoopConfig } from './types.js';
import { shouldLog } from './config.js';

const STATE_VERSION = '1.0.0';
const LOCK_EXTENSION = '.lock';

// File locking state
const fileLocks = new Map<string, { promise: Promise<void> | null; count: number }>();

/**
 * Acquire a simple file lock (in-memory, for single-process safety)
 */
async function acquireLock(filePath: string): Promise<() => Promise<void>> {
  const lockKey = filePath;
  
  if (!fileLocks.has(lockKey)) {
    fileLocks.set(lockKey, { promise: null, count: 0 });
  }
  
  const lock = fileLocks.get(lockKey)!;
  lock.count++;
  
  if (lock.promise) {
    await lock.promise;
  }
  
  let releaseLock: () => void;
  lock.promise = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });
  
  return async () => {
    lock.count--;
    if (lock.count === 0) {
      lock.promise = null;
    }
    releaseLock!();
  };
}

/**
 * Ensure the state directory exists
 */
async function ensureDirectory(config: RalphLoopConfig): Promise<void> {
  const dirPath = config.stateDirectory;
  try {
    await access(dirPath, constants.F_OK);
  } catch {
    await mkdir(dirPath, { recursive: true });
  }
}

/**
 * Get the full path to the state file
 */
export function getStateFilePath(config: RalphLoopConfig): string {
  return join(config.stateDirectory, config.stateFile);
}

/**
 * Create an empty state
 */
export function createEmptyState(): State {
  return {
    tasks: [],
    version: STATE_VERSION,
  };
}

/**
 * Load state from file, or return empty state if file doesn't exist
 */
export async function loadState(config: RalphLoopConfig): Promise<State> {
  const release = await acquireLock(getStateFilePath(config));
  
  try {
    await ensureDirectory(config);
    const filePath = getStateFilePath(config);
    
    try {
      const content = await readFile(filePath, 'utf-8');
      const state = JSON.parse(content) as State;
      
      if (!state.tasks || !Array.isArray(state.tasks)) {
        return createEmptyState();
      }
      
      return state;
    } catch {
      return createEmptyState();
    }
  } finally {
    await release();
  }
}

/**
 * Save state to file
 */
export async function saveState(config: RalphLoopConfig, state: State): Promise<void> {
  const release = await acquireLock(getStateFilePath(config));
  
  try {
    await ensureDirectory(config);
    const filePath = getStateFilePath(config);
    
    state.version = STATE_VERSION;
    
    const content = JSON.stringify(state, null, 2);
    await writeFile(filePath, content, 'utf-8');
  } finally {
    await release();
  }
}

/**
 * Create a new task with steps
 */
export function createTask(
  taskName: string,
  agentId: string,
  steps: Array<{ desc: string }>,
  maxRetries: number,
  stallTimeoutMs: number
): Task {
  const now = new Date().toISOString();
  
  return {
    id: uuidv4(),
    taskName,
    status: 'running',
    createdAt: now,
    lastUpdated: now,
    steps: steps.map((s, idx) => ({
      id: idx + 1,
      desc: s.desc,
      status: 'pending' as StepStatus,
      updatedAt: null,
    })),
    progress: {
      currentStep: 0,
      totalSteps: steps.length,
      completedSteps: 0,
    },
    stallDetection: {
      enabled: true,
      stallTimeoutMs,
      lastHeartbeat: now,
    },
    data: {
      agentId,
      retryCount: 0,
      maxRetries,
      errorDetails: null,
      callbackUrl: null,
      metadata: {},
    },
  };
}

/**
 * Add a new task to the state
 */
export async function addTask(
  config: RalphLoopConfig,
  taskName: string,
  agentId: string,
  steps: Array<{ desc: string }>,
  stallTimeoutMs?: number
): Promise<Task> {
  const state = await loadState(config);
  
  const timeout = stallTimeoutMs ?? config.defaultStallTimeoutMs;
  const newTask = createTask(taskName, agentId, steps, config.maxRetries, timeout);
  
  // Mark first step as running
  if (newTask.steps.length > 0) {
    newTask.steps[0].status = 'running';
    newTask.progress.currentStep = 1;
  }
  
  state.tasks.push(newTask);
  await saveState(config, state);
  
  if (shouldLog('debug', config.logLevel)) {
    console.debug(`[rloop] Added task: ${newTask.id} - ${taskName} with ${steps.length} steps`);
  }
  
  return newTask;
}

/**
 * Find a task by its ID
 */
export function findTaskById(state: State, taskId: string): Task | undefined {
  return state.tasks.find((t) => t.id === taskId);
}

/**
 * Find a task by task name
 */
export function findTaskByName(state: State, taskName: string): Task | undefined {
  return state.tasks.find((t) => t.taskName === taskName);
}

/**
 * Get task statistics
 */
export function getTaskStats(state: State): {
  total: number;
  pending: number;
  running: number;
  completed: number;
  failed: number;
  stalled: number;
} {
  return {
    total: state.tasks.length,
    pending: state.tasks.filter((t) => t.status === 'pending').length,
    running: state.tasks.filter((t) => t.status === 'running').length,
    completed: state.tasks.filter((t) => t.status === 'completed').length,
    failed: state.tasks.filter((t) => t.status === 'failed').length,
    stalled: state.tasks.filter((t) => t.status === 'stalled').length,
  };
}

/**
 * Check if all steps are completed
 */
export function areAllStepsCompleted(task: Task): boolean {
  return task.steps.every((s) => s.status === 'completed');
}

/**
 * Check if any step failed
 */
export function hasStepFailed(task: Task): boolean {
  return task.steps.some((s) => s.status === 'failed');
}

/**
 * Update task status
 */
export async function updateTaskStatus(
  config: RalphLoopConfig,
  taskId: string,
  newStatus: TaskStatus
): Promise<boolean> {
  const state = await loadState(config);
  const task = findTaskById(state, taskId);
  
  if (!task) {
    if (shouldLog('warn', config.logLevel)) {
      console.warn(`[rloop] Task not found: ${taskId}`);
    }
    return false;
  }
  
  const previousStatus = task.status;
  task.status = newStatus;
  task.lastUpdated = new Date().toISOString();
  
  await saveState(config, state);
  
  if (shouldLog('debug', config.logLevel)) {
    console.debug(`[rloop] Task ${taskId} status: ${previousStatus} -> ${newStatus}`);
  }
  
  return true;
}

/**
 * Update a single step status
 */
export async function updateStepStatus(
  config: RalphLoopConfig,
  taskId: string,
  stepId: number,
  newStatus: StepStatus,
  error?: string
): Promise<boolean> {
  const state = await loadState(config);
  const task = findTaskById(state, taskId);
  
  if (!task) {
    if (shouldLog('warn', config.logLevel)) {
      console.warn(`[rloop] Task not found: ${taskId}`);
    }
    return false;
  }
  
  const step = task.steps.find((s) => s.id === stepId);
  if (!step) {
    if (shouldLog('warn', config.logLevel)) {
      console.warn(`[rloop] Step ${stepId} not found in task ${taskId}`);
    }
    return false;
  }
  
  const now = new Date().toISOString();
  step.status = newStatus;
  step.updatedAt = now;
  if (error) {
    step.error = error;
  }
  
  task.lastUpdated = now;
  
  // Update progress counters
  task.progress.completedSteps = task.steps.filter(
    (s) => s.status === 'completed'
  ).length;
  
  // If this step is now running, update currentStep
  if (newStatus === 'running') {
    task.progress.currentStep = stepId;
  }
  
  // Auto-complete task if all steps done
  if (areAllStepsCompleted(task)) {
    task.status = 'completed';
  } else if (hasStepFailed(task)) {
    task.status = 'failed';
  }
  
  // Update heartbeat on any step update
  if (task.stallDetection.enabled) {
    task.stallDetection.lastHeartbeat = now;
  }
  
  await saveState(config, state);
  
  if (shouldLog('debug', config.logLevel)) {
    console.debug(`[rloop] Task ${taskId} step ${stepId}: ${newStatus}`);
  }
  
  return true;
}

/**
 * Send heartbeat to prevent stall detection
 */
export async function heartbeat(
  config: RalphLoopConfig,
  taskId: string
): Promise<boolean> {
  const state = await loadState(config);
  const task = findTaskById(state, taskId);
  
  if (!task) {
    return false;
  }
  
  const now = new Date().toISOString();
  task.stallDetection.lastHeartbeat = now;
  task.lastUpdated = now;
  
  // Clear stalled status if was stalled
  if (task.status === 'stalled') {
    task.status = 'running';
    if (shouldLog('info', config.logLevel)) {
      console.info(`[rloop] Task ${taskId} recovered from stalled state`);
    }
  }
  
  await saveState(config, state);
  return true;
}

/**
 * Mark task as stalled
 */
export async function markStalled(
  config: RalphLoopConfig,
  taskId: string
): Promise<boolean> {
  const state = await loadState(config);
  const task = findTaskById(state, taskId);
  
  if (!task) {
    return false;
  }
  
  if (task.status === 'running') {
    task.status = 'stalled';
    task.lastUpdated = new Date().toISOString();
    await saveState(config, state);
    
    if (shouldLog('warn', config.logLevel)) {
      console.warn(`[rloop] Task ${taskId} marked as stalled`);
    }
  }
  
  return true;
}

/**
 * Check for stalled tasks and mark them
 */
export async function checkAndMarkStalledTasks(
  config: RalphLoopConfig
): Promise<string[]> {
  const state = await loadState(config);
  const now = new Date().getTime();
  const stalledIds: string[] = [];
  
  for (const task of state.tasks) {
    if (task.status !== 'running' || !task.stallDetection.enabled) {
      continue;
    }
    
    const lastHeartbeat = task.stallDetection.lastHeartbeat;
    if (!lastHeartbeat) {
      continue;
    }
    
    const lastTime = new Date(lastHeartbeat).getTime();
    const elapsed = now - lastTime;
    
    if (elapsed > task.stallDetection.stallTimeoutMs) {
      task.status = 'stalled';
      task.lastUpdated = new Date().toISOString();
      stalledIds.push(task.id);
      
      if (shouldLog('warn', config.logLevel)) {
        console.warn(`[rloop] Task ${task.id} stalled (no heartbeat for ${elapsed}ms)`);
      }
    }
  }
  
  if (stalledIds.length > 0) {
    await saveState(config, state);
  }
  
  return stalledIds;
}

/**
 * Remove a task from the state
 */
export async function removeTask(
  config: RalphLoopConfig,
  taskId: string
): Promise<boolean> {
  const state = await loadState(config);
  const index = state.tasks.findIndex((t) => t.id === taskId);
  
  if (index === -1) {
    return false;
  }
  
  state.tasks.splice(index, 1);
  await saveState(config, state);
  
  if (shouldLog('debug', config.logLevel)) {
    console.debug(`[rloop] Removed task: ${taskId}`);
  }
  
  return true;
}

/**
 * Get all tasks with a specific status
 */
export function getTasksByStatus(state: State, status: TaskStatus): Task[] {
  return state.tasks.filter((t) => t.status === status);
}

/**
 * Get stalled tasks
 */
export function getStalledTasks(state: State): Task[] {
  return state.tasks.filter((t) => t.status === 'stalled');
}
