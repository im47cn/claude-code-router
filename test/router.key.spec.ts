import { describe, it, expect, vi } from 'vitest';
import { attachSelectedKeyToReq } from '../src/utils/router';

describe('Router Key Selection', () => {
  it('should handle single key routing', () => {
    const config = {
      Providers: [
        {
          name: 'test-provider',
          api_key: 'single-key',
        },
      ],
    };
    const req = { body: { model: 'test-provider, some-model' } };

    attachSelectedKeyToReq(req.body.model, config, req);

    expect(req.selectedApiKey).toBe('single-key');
  });
});
