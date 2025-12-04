/**
 * Global test setup for Vitest
 */
import { vi, beforeEach, afterEach } from 'vitest';

// Mock console methods to reduce noise in tests
beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

// Global test utilities
export const mockDate = (timestamp: number) => {
  vi.setSystemTime(new Date(timestamp));
};

export const resetDate = () => {
  vi.useRealTimers();
};

// Helper to create mock request object
export const createMockRequest = (overrides: Record<string, any> = {}) => ({
  url: '/v1/messages',
  method: 'POST',
  headers: {},
  body: {},
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  ...overrides,
});

// Helper to create mock reply object
export const createMockReply = () => {
  const reply: any = {
    status: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
    header: vi.fn().mockReturnThis(),
  };
  return reply;
};

// Helper to create mock config object
export const createMockConfig = (overrides: Record<string, any> = {}) => ({
  PORT: 3456,
  APIKEY: 'test-api-key',
  ...overrides,
});
