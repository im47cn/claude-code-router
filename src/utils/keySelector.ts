/**
 * Utility functions for selecting API keys from provider configurations
 */

/**
 * Extract API keys from various configuration formats
 * @param config - Provider configuration object
 * @returns Array of API keys
 */
export function extractKeys(config: any): string[] {
  if (!config || typeof config !== 'object') {
    return [];
  }

  // 仅支持 api_keys 分号分隔格式
  if (config.api_keys && typeof config.api_keys === 'string') {
    return config.api_keys
      .split(';')
      .map(key => key.trim())
      .filter(Boolean);
  }

  // 向后兼容单 key 配置
  if (typeof config.api_key === 'string') {
    return [config.api_key.trim()].filter(Boolean);
  }

  return [];

  return [];
}

/**
 * Weighted random selection from an array of items
 * @param items - Array of items to select from
 * @param weights - Optional weights array (same length as items)
 * @returns Randomly selected item or undefined
 */
export function weightedRandomSelect<T>(items: T[], weights?: number[]): T | undefined {
  if (!items || items.length === 0) {
    return undefined;
  }

  if (items.length === 1) {
    return items[0];
  }

  // If no weights provided, use uniform distribution
  if (!weights || weights.length !== items.length) {
    const randomIndex = Math.floor(Math.random() * items.length);
    return items[randomIndex];
  }

  // Use weights for selection
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  if (totalWeight === 0) {
    // Fallback to uniform if all weights are zero
    const randomIndex = Math.floor(Math.random() * items.length);
    return items[randomIndex];
  }

  let random = Math.random() * totalWeight;
  for (let i = 0; i < items.length; i++) {
    random -= weights[i];
    if (random <= 0) {
      return items[i];
    }
  }

  // Fallback (shouldn't reach here in normal cases)
  return items[items.length - 1];
}

/**
 * Select a random API key from provider configuration
 * @param config - Provider configuration object
 * @returns Randomly selected API key or undefined
 */
export function selectRandomKey(config: any): string | undefined {
  if (!config || typeof config !== 'object') {
    return undefined;
  }

  const keys = extractKeys(config);
  if (keys.length === 0) {
    return undefined;
  }

  // Use weighted random selection if weights are provided
  if (config.key_weights && Array.isArray(config.key_weights) && config.key_weights.length === keys.length) {
    return weightedRandomSelect(keys, config.key_weights);
  }

  // Use uniform random selection
  return weightedRandomSelect(keys);
}