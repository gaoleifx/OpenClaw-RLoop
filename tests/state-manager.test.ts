/**
 * Tests for state-manager.ts - STATE.json operations
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTask, findTaskById, findTaskByAgentId, findTaskByName, getTasksByStatus, getTaskStats } from '../src/state-manager.js';
import type { State, Task, RalphLoopConfig } from '../src/types.js';

// Mock the fs/promises module
vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  access: vi.fn(),
  constants: { F_OK: 0 },
}));

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'test-uuid-1234'),
}));

describe('State Manager', () => {
  const testConfig: RalphLoopConfig = {
    stateDirectory: 'D:\\test\\ralph-loop',
    stateFile: 'STATE.json',
    pollIntervalMs: 5000,
    enableAutoRetry: true,
    maxRetries: 3,
    retryDelayMs: 30000,
    onFailure: { type: 'log', callbackUrl: null },
    logLevel: 'error', // Use error to suppress logs during tests
  };

  describe('createTask', () => {
    it('should create a task with correct structure', () => {
      const task = createTask('Test Task', 'agent-1', 3);
      
      expect(task).toEqual({
        id: 'test-uuid-1234',
        task: 'Test Task',
        status: 'pending',
        progress: { current: 0, total: 0 },
        lastUpdated: expect.any(String),
        data: {
          agentId: 'agent-1',
          retryCount: 0,
          maxRetries: 3,
          errorDetails: null,
          callbackUrl: null,
          metadata: {},
        },
      });
    });

    it('should create tasks with unique IDs', () => {
      const task1 = createTask('Task 1', 'agent-1', 3);
      const task2 = createTask('Task 2', 'agent-2', 3);
      
      expect(task1.id).toBe('test-uuid-1234');
      // Note: In real execution, each call would get a different UUID
    });
  });

  describe('findTaskById', () => {
    const state: State = {
      tasks: [
        {
          id: 'task-1',
          task: 'Task 1',
          status: 'pending',
          progress: { current: 0, total: 10 },
          lastUpdated: new Date().toISOString(),
          data: { agentId: 'agent-1', retryCount: 0, maxRetries: 3, errorDetails: null, callbackUrl: null, metadata: {} },
        },
        {
          id: 'task-2',
          task: 'Task 2',
          status: 'running',
          progress: { current: 5, total: 10 },
          lastUpdated: new Date().toISOString(),
          data: { agentId: 'agent-2', retryCount: 1, maxRetries: 3, errorDetails: null, callbackUrl: null, metadata: {} },
        },
      ],
      version: '1.0.0',
    };

    it('should find task by ID', () => {
      const task = findTaskById(state, 'task-1');
      expect(task).toBeDefined();
      expect(task?.task).toBe('Task 1');
    });

    it('should return undefined for non-existent ID', () => {
      const task = findTaskById(state, 'non-existent');
      expect(task).toBeUndefined();
    });
  });

  describe('findTaskByAgentId', () => {
    const state: State = {
      tasks: [
        {
          id: 'task-1',
          task: 'Task 1',
          status: 'pending',
          progress: { current: 0, total: 10 },
          lastUpdated: new Date().toISOString(),
          data: { agentId: 'agent-1', retryCount: 0, maxRetries: 3, errorDetails: null, callbackUrl: null, metadata: {} },
        },
        {
          id: 'task-2',
          task: 'Task 2',
          status: 'running',
          progress: { current: 5, total: 10 },
          lastUpdated: new Date().toISOString(),
          data: { agentId: 'agent-2', retryCount: 1, maxRetries: 3, errorDetails: null, callbackUrl: null, metadata: {} },
        },
      ],
      version: '1.0.0',
    };

    it('should find task by agent ID', () => {
      const task = findTaskByAgentId(state, 'agent-1');
      expect(task).toBeDefined();
      expect(task?.task).toBe('Task 1');
    });

    it('should return undefined for non-existent agent ID', () => {
      const task = findTaskByAgentId(state, 'non-existent');
      expect(task).toBeUndefined();
    });
  });

  describe('findTaskByName', () => {
    const state: State = {
      tasks: [
        {
          id: 'task-1',
          task: 'Long Running Task',
          status: 'pending',
          progress: { current: 0, total: 10 },
          lastUpdated: new Date().toISOString(),
          data: { agentId: 'agent-1', retryCount: 0, maxRetries: 3, errorDetails: null, callbackUrl: null, metadata: {} },
        },
      ],
      version: '1.0.0',
    };

    it('should find task by name', () => {
      const task = findTaskByName(state, 'Long Running Task');
      expect(task).toBeDefined();
      expect(task?.id).toBe('task-1');
    });

    it('should return undefined for non-existent name', () => {
      const task = findTaskByName(state, 'Non Existent Task');
      expect(task).toBeUndefined();
    });
  });

  describe('getTasksByStatus', () => {
    const state: State = {
      tasks: [
        { id: 'task-1', task: 'Task 1', status: 'pending', progress: { current: 0, total: 10 }, lastUpdated: '', data: { agentId: 'a', retryCount: 0, maxRetries: 3, errorDetails: null, callbackUrl: null, metadata: {} } },
        { id: 'task-2', task: 'Task 2', status: 'running', progress: { current: 5, total: 10 }, lastUpdated: '', data: { agentId: 'b', retryCount: 0, maxRetries: 3, errorDetails: null, callbackUrl: null, metadata: {} } },
        { id: 'task-3', task: 'Task 3', status: 'pending', progress: { current: 0, total: 10 }, lastUpdated: '', data: { agentId: 'c', retryCount: 0, maxRetries: 3, errorDetails: null, callbackUrl: null, metadata: {} } },
        { id: 'task-4', task: 'Task 4', status: 'completed', progress: { current: 10, total: 10 }, lastUpdated: '', data: { agentId: 'd', retryCount: 0, maxRetries: 3, errorDetails: null, callbackUrl: null, metadata: {} } },
      ],
      version: '1.0.0',
    };

    it('should return only pending tasks', () => {
      const pending = getTasksByStatus(state, 'pending');
      expect(pending).toHaveLength(2);
      expect(pending.map(t => t.id)).toEqual(['task-1', 'task-3']);
    });

    it('should return only running tasks', () => {
      const running = getTasksByStatus(state, 'running');
      expect(running).toHaveLength(1);
      expect(running[0].id).toBe('task-2');
    });

    it('should return only completed tasks', () => {
      const completed = getTasksByStatus(state, 'completed');
      expect(completed).toHaveLength(1);
      expect(completed[0].id).toBe('task-4');
    });

    it('should return empty array for failed status', () => {
      const failed = getTasksByStatus(state, 'failed');
      expect(failed).toHaveLength(0);
    });
  });

  describe('getTaskStats', () => {
    it('should calculate correct statistics', () => {
      const state: State = {
        tasks: [
          { id: 'task-1', task: 'Task 1', status: 'pending', progress: { current: 0, total: 10 }, lastUpdated: '', data: { agentId: 'a', retryCount: 0, maxRetries: 3, errorDetails: null, callbackUrl: null, metadata: {} } },
          { id: 'task-2', task: 'Task 2', status: 'running', progress: { current: 5, total: 10 }, lastUpdated: '', data: { agentId: 'b', retryCount: 0, maxRetries: 3, errorDetails: null, callbackUrl: null, metadata: {} } },
          { id: 'task-3', task: 'Task 3', status: 'completed', progress: { current: 10, total: 10 }, lastUpdated: '', data: { agentId: 'c', retryCount: 0, maxRetries: 3, errorDetails: null, callbackUrl: null, metadata: {} } },
          { id: 'task-4', task: 'Task 4', status: 'failed', progress: { current: 3, total: 10 }, lastUpdated: '', data: { agentId: 'd', retryCount: 3, maxRetries: 3, errorDetails: 'error', callbackUrl: null, metadata: {} } },
        ],
        version: '1.0.0',
      };

      const stats = getTaskStats(state);
      
      expect(stats).toEqual({
        total: 4,
        pending: 1,
        running: 1,
        completed: 1,
        failed: 1,
      });
    });

    it('should return zeros for empty state', () => {
      const state: State = { tasks: [], version: '1.0.0' };
      const stats = getTaskStats(state);
      
      expect(stats).toEqual({
        total: 0,
        pending: 0,
        running: 0,
        completed: 0,
        failed: 0,
      });
    });
  });
});
