/**
 * Configuration schema and validation for rloop plugin
 */

import { z } from 'zod';
import type { RalphLoopConfig } from './types.js';
import { DEFAULT_CONFIG } from './types.js';

// Zod schema for configuration validation
export const ConfigSchema = z.object({
  stateDirectory: z.string().min(1, 'State directory is required'),
  stateFile: z.string().min(1, 'State file name is required'),
  pollIntervalMs: z.number().int().min(1000, 'Poll interval must be at least 1000ms'),
  enableAutoRetry: z.boolean(),
  maxRetries: z.number().int().min(0, 'Max retries must be non-negative'),
  retryDelayMs: z.number().int().min(1000, 'Retry delay must be at least 1000ms'),
  defaultStallTimeoutMs: z.number().int().min(1000, 'Stall timeout must be at least 1000ms'),
  onFailure: z.object({
    type: z.enum(['callback', 'log', 'none']),
    callbackUrl: z.string().url().nullable(),
  }),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']),
});

/**
 * Validate and parse configuration
 */
export function validateConfig(config: unknown): RalphLoopConfig {
  // Start with defaults
  const withDefaults: RalphLoopConfig = { ...DEFAULT_CONFIG };
  
  if (!config || typeof config !== 'object') {
    return withDefaults;
  }

  const configObj = config as Record<string, unknown>;

  // Override with provided values
  if (configObj.stateDirectory) {
    withDefaults.stateDirectory = String(configObj.stateDirectory);
  }
  if (configObj.stateFile) {
    withDefaults.stateFile = String(configObj.stateFile);
  }
  if (typeof configObj.pollIntervalMs === 'number') {
    withDefaults.pollIntervalMs = configObj.pollIntervalMs;
  }
  if (typeof configObj.enableAutoRetry === 'boolean') {
    withDefaults.enableAutoRetry = configObj.enableAutoRetry;
  }
  if (typeof configObj.maxRetries === 'number') {
    withDefaults.maxRetries = configObj.maxRetries;
  }
  if (typeof configObj.retryDelayMs === 'number') {
    withDefaults.retryDelayMs = configObj.retryDelayMs;
  }
  if (configObj.onFailure) {
    const onFailure = configObj.onFailure as Record<string, unknown>;
    if (onFailure.type && ['callback', 'log', 'none'].includes(String(onFailure.type))) {
      withDefaults.onFailure.type = String(onFailure.type) as 'callback' | 'log' | 'none';
    }
      if (onFailure.callbackUrl !== undefined && onFailure.callbackUrl !== null) {
        withDefaults.onFailure.callbackUrl = String(onFailure.callbackUrl);
      } else if (onFailure.callbackUrl === null) {
        withDefaults.onFailure.callbackUrl = null;
      }
  }
  if (configObj.logLevel && ['debug', 'info', 'warn', 'error'].includes(String(configObj.logLevel))) {
    withDefaults.logLevel = String(configObj.logLevel) as 'debug' | 'info' | 'warn' | 'error';
  }

  // Validate with Zod - if validation fails, return defaults
  const result = ConfigSchema.safeParse(withDefaults);
  if (!result.success) {
    console.warn('Config validation warnings:', result.error.issues);
    return { ...DEFAULT_CONFIG };
  }

  return result.data;
}

/**
 * Get log level priority for filtering
 */
export function getLogLevelPriority(level: RalphLoopConfig['logLevel']): number {
  const priorities: Record<RalphLoopConfig['logLevel'], number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };
  return priorities[level];
}

/**
 * Check if a log message should be emitted based on current level
 */
export function shouldLog(
  messageLevel: RalphLoopConfig['logLevel'],
  currentLevel: RalphLoopConfig['logLevel']
): boolean {
  return getLogLevelPriority(messageLevel) >= getLogLevelPriority(currentLevel);
}
