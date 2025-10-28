import { describe, it, expect } from 'vitest';
import { selectRandomModel } from '../src/utils/router';

describe('Multi-model switching', () => {
  it('should switch between multiple models', () => {
    const models = 'model1;model2;model3';
    const results = new Set();

    for (let i = 0; i < 100; i++) {
      results.add(selectRandomModel(models));
    }

    expect(results.size).toBe(3);
    expect(Array.from(results)).toEqual(expect.arrayContaining(['model1', 'model2', 'model3']));
  });
});
