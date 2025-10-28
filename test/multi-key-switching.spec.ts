import { describe, it, expect, vi } from 'vitest';
import { attachSelectedKeyToReq } from '../src/utils/router';

describe('Multi-key switching', () => {
  it('should switch between multiple keys for a provider', () => {
    const config = {
      Providers: [
        {
          name: 'test-provider',
          api_keys: 'key1;key2;key3',
        },
      ],
    };
    const req = { body: { model: 'test-provider, some-model' } };
    const results = new Set();

    for (let i = 0; i < 100; i++) {
      attachSelectedKeyToReq(req.body.model, config, req);
      results.add(req.selectedApiKey);
    }

    expect(results.size).toBe(3);
    expect(Array.from(results)).toEqual(expect.arrayContaining(['key1', 'key2', 'key3']));
  });
});
