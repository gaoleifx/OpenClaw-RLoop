/**
 * Retry Handler - Handles retry logic and failure callbacks
 * Note: This is a simplified version that works with the step-based architecture
 */

import type { RalphLoopConfig } from './types.js';
import { shouldLog } from './config.js';

/**
 * RetryHandler manages retry logic and failure callbacks
 * Note: In the step-based architecture, retries are handled differently
 * The agent can retry individual steps rather than entire tasks
 */
export class RetryHandler {
  private config: RalphLoopConfig;

  constructor(config: RalphLoopConfig) {
    this.config = config;
  }

  /**
   * Handle a failed task step - determine if it should retry
   */
  async handleStepFailure(taskId: string, stepId: number, error?: string): Promise<boolean> {
    if (!this.config.enableAutoRetry) {
      if (shouldLog('info', this.config.logLevel)) {
        console.info(`[rloop] Auto-retry disabled for step ${stepId} of task ${taskId}`);
      }
      return false;
    }

    // For step-based retries, the agent decides what to retry
    if (shouldLog('info', this.config.logLevel)) {
      console.info(`[rloop] Step ${stepId} of task ${taskId} failed: ${error || 'unknown'}`);
    }

    return false;
  }

  /**
   * Get number of pending retries
   */
  getPendingRetryCount(): number {
    return 0;
  }

  /**
   * Check if a task has a pending retry
   */
  hasPendingRetry(taskId: string): boolean {
    return false;
  }
}
