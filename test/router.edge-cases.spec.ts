import { describe, it, expect, vi } from 'vitest';
import { router } from '../src/utils/router';

describe('Router Edge Cases', () => {
  it('should handle null request body gracefully', async () => {
    const config = {
      Router: {
        default: 'test-provider,test-model',
      },
      Providers: [
        {
          name: 'test-provider',
          models: ['test-model'],
        },
      ],
    };
    const req = { body: null };
    const mockLog = { error: vi.fn() };
    req.log = mockLog;

    await router(req, null, { config, event: new EventTarget() });

    expect(mockLog.error).toHaveBeenCalledWith('Request body is null or undefined');
    expect(req.body).toBeDefined();
    expect(req.body.model).toBe('test-provider,test-model');
  });

  it('should handle undefined config gracefully', async () => {
    const req = { body: { model: 'test' } };
    const mockLog = { error: vi.fn() };
    req.log = mockLog;

    await router(req, null, { config: null, event: new EventTarget() });

    expect(mockLog.error).toHaveBeenCalledWith('Config is null or undefined');
  });

  it('should handle empty request body', async () => {
    const config = {
      Router: {
        default: 'test-provider,test-model',
      },
      Providers: [
        {
          name: 'test-provider',
          models: ['test-model'],
        },
      ],
    };
    const req = { body: {}, log: { error: vi.fn() } };

    await router(req, null, { config, event: new EventTarget() });

    expect(req.body.model).toBe('test-provider,test-model');
  });

  it('should handle malformed model string in attachSelectedKeyToReq', async () => {
    const config = {
      Router: {
        default: 'test-provider,test-model',
      },
      Providers: [
        {
          name: 'test-provider',
          models: ['test-model'],
          keys: ['key1', 'key2'],
        },
      ],
    };
    const req = { body: { model: 'invalid-model-string' } };

    await router(req, null, { config, event: new EventTarget() });

    // Should not crash and should still set a model
    expect(req.body.model).toBeDefined();
  });
});