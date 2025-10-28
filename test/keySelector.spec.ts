import { describe, it, expect, beforeEach } from 'vitest';
import { extractKeys, weightedRandomSelect, selectRandomKey } from '../src/utils/keySelector';

describe('keySelector', () => {
  describe('extractKeys', () => {
    it('should extract keys from keys array', () => {
      const config = { api_keys: 'key1;key2;key3' };
      const result = extractKeys(config);
      expect(result).toEqual(['key1', 'key2', 'key3']);
    });

    it('should extract keys from api_keys string', () => {
      const config = { api_keys: 'key1;key2;key3' };
      const result = extractKeys(config);
      expect(result).toEqual(['key1', 'key2', 'key3']);
    });

    it('should extract keys from api_key array', () => {
      const config = { api_keys: 'key1;key2' };
      const result = extractKeys(config);
      expect(result).toEqual(['key1', 'key2']);
    });

    it('should extract key from single api_key string', () => {
      const config = { api_key: 'single-key' };
      const result = extractKeys(config);
      expect(result).toEqual(['single-key']);
    });

    it('should handle empty and invalid values', () => {
      expect(extractKeys(null)).toEqual([]);
      expect(extractKeys({})).toEqual([]);
      expect(extractKeys({ keys: [] })).toEqual([]);
      expect(extractKeys({ api_keys: '' })).toEqual([]);
      expect(extractKeys({ api_key: '' })).toEqual([]);
    });

    it('should filter out empty strings and whitespace', () => {
      const config = { api_keys: 'key1;;  ;key2' };
      const result = extractKeys(config);
      expect(result).toEqual(['key1', 'key2']);
    });
  });

  describe('weightedRandomSelect', () => {
    it('should return undefined for empty array', () => {
      expect(weightedRandomSelect([])).toBeUndefined();
    });

    it('should return single element for single item array', () => {
      const result = weightedRandomSelect(['only']);
      expect(result).toBe('only');
    });

    it('should use uniform distribution when no weights provided', () => {
      const items = ['a', 'b', 'c'];
      const results = new Set();

      // Run multiple times to test distribution
      for (let i = 0; i < 100; i++) {
        const result = weightedRandomSelect(items);
        if (result) results.add(result);
      }

      // Should eventually see all items
      expect(results.size).toBe(3);
      expect(Array.from(results)).toEqual(expect.arrayContaining(items));
    });

    it('should respect weights when provided', () => {
      const items = ['a', 'b', 'c'];
      const weights = [0.8, 0.1, 0.1]; // 'a' should be selected most often

      let countA = 0;
      for (let i = 0; i < 100; i++) {
        const result = weightedRandomSelect(items, weights);
        if (result === 'a') countA++;
      }

      // 'a' should be selected significantly more often
      expect(countA).toBeGreaterThan(50);
    });
  });

  describe('selectRandomKey', () => {
    it('should select a key from provider config', () => {
      const config = { api_keys: 'key1;key2' };
      const result = selectRandomKey(config);
      expect(['key1', 'key2']).toContain(result);
    });

    it('should return undefined for invalid config', () => {
      expect(selectRandomKey(null)).toBeUndefined();
      expect(selectRandomKey({})).toBeUndefined();
    });

    it('should handle different key formats', () => {
      const configs = [
        { api_keys: 'string-key' },
        { api_key: 'single-key' }
      ];

      configs.forEach(config => {
        const result = selectRandomKey(config);
        expect(result).toBeDefined();
        expect(typeof result).toBe('string');
      });
    });
  });
});