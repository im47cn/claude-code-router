import { describe, it, expect, vi } from 'vitest';
import { router } from '../src/utils/router';

describe('Router', () => {
  it('should handle single model routing', async () => {
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
    const req = { body: { model: 'placeholder' } }; // model will be overwritten

    await router(req, null, { config, event: new EventTarget() });

    expect(req.body.model).toBe('test-provider,test-model');
  });
});
