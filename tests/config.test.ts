/**
 * Tests for config.ts - Configuration validation
 */

import { describe, it, expect } from 'vitest';
import { validateConfig, shouldLog, getLogLevelPriority } from '../src/config.js';
import { DEFAULT_CONFIG } from '../src/types.js';

describe('Config Validation', () => {
  describe('validateConfig', () => {
    it('should return defaults for empty config', () => {
      const result = validateConfig({});
      expect(result).toEqual(DEFAULT_CONFIG);
    });

    it('should return defaults for null config', () => {
      const result = validateConfig(null);
      expect(result).toEqual(DEFAULT_CONFIG);
    });

    it('should return defaults for undefined config', () => {
      const result = validateConfig(undefined);
      expect(result).toEqual(DEFAULT_CONFIG);
    });

    it('should override defaults with provided values', () => {
      const config = {
        stateDirectory: '/custom/path',
        logLevel: 'error',
        maxRetries: 5,
      };
      const result = validateConfig(config);
      expect(result.stateDirectory).toBe('/custom/path');
      expect(result.logLevel).toBe('error');
      expect(result.maxRetries).toBe(5);
      // Other values should remain as defaults
      expect(result.pollIntervalMs).toBe(DEFAULT_CONFIG.pollIntervalMs);
    });

    it('should ignore invalid values', () => {
      const config = {
        pollIntervalMs: -100, // Invalid
        logLevel: 'invalid',  // Invalid
        enableAutoRetry: 'yes', // Should be boolean
      };
      const result = validateConfig(config);
      // Invalid values should be ignored, keeping defaults
      expect(result.pollIntervalMs).toBe(DEFAULT_CONFIG.pollIntervalMs);
      expect(result.logLevel).toBe(DEFAULT_CONFIG.logLevel);
      expect(result.enableAutoRetry).toBe(DEFAULT_CONFIG.enableAutoRetry);
    });

    it('should validate pollIntervalMs minimum', () => {
      const config = { pollIntervalMs: 500 }; // Below minimum
      const result = validateConfig(config);
      // Should use default since 500 < 1000
      expect(result.pollIntervalMs).toBe(DEFAULT_CONFIG.pollIntervalMs);
    });

    it('should accept valid pollIntervalMs', () => {
      const config = { pollIntervalMs: 2000 };
      const result = validateConfig(config);
      expect(result.pollIntervalMs).toBe(2000);
    });
  });

  describe('getLogLevelPriority', () => {
    it('should return correct priorities', () => {
      expect(getLogLevelPriority('debug')).toBe(0);
      expect(getLogLevelPriority('info')).toBe(1);
      expect(getLogLevelPriority('warn')).toBe(2);
      expect(getLogLevelPriority('error')).toBe(3);
    });
  });

  describe('shouldLog', () => {
    it('should always log when message level is debug and current is debug', () => {
      expect(shouldLog('debug', 'debug')).toBe(true);
    });

    it('should never log when message level is debug and current is error', () => {
      expect(shouldLog('debug', 'error')).toBe(false);
    });

    it('should log info messages when current level is info', () => {
      expect(shouldLog('info', 'info')).toBe(true);
      expect(shouldLog('warn', 'info')).toBe(true);
      expect(shouldLog('error', 'info')).toBe(true);
      expect(shouldLog('debug', 'info')).toBe(false);
    });

    it('should only log errors when current level is error', () => {
      expect(shouldLog('error', 'error')).toBe(true);
      expect(shouldLog('debug', 'error')).toBe(false);
      expect(shouldLog('info', 'error')).toBe(false);
      expect(shouldLog('warn', 'error')).toBe(false);
    });
  });
});
