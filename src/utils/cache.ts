import { Mutex } from "async-mutex";

// LRU cache for session usage

export interface Usage {
  input_tokens: number;
  output_tokens: number;
}

class LRUCache<K, V> {
  private capacity: number;
  private cache: Map<K, V>;
  private mutex = new Mutex();

  constructor(capacity: number) {
    this.capacity = capacity;
    this.cache = new Map<K, V>();
  }

  async get(key: K): Promise<V | undefined> {
    const release = await this.mutex.acquire();
    try {
      if (!this.cache.has(key)) {
        return undefined;
      }
      const value = this.cache.get(key) as V;
      // Move to end to mark as recently used
      this.cache.delete(key);
      this.cache.set(key, value);
      return value;
    } finally {
      release();
    }
  }

  async put(key: K, value: V): Promise<void> {
    const release = await this.mutex.acquire();
    try {
      if (this.cache.has(key)) {
        // If key exists, delete it to update its position
        this.cache.delete(key);
      } else if (this.cache.size >= this.capacity) {
        // If cache is full, delete the least recently used item
        const leastRecentlyUsedKey = this.cache.keys().next().value;
        if (leastRecentlyUsedKey !== undefined) {
          this.cache.delete(leastRecentlyUsedKey);
        }
      }
      this.cache.set(key, value);
    } finally {
      release();
    }
  }

  async values(): Promise<V[]> {
    const release = await this.mutex.acquire();
    try {
      return Array.from(this.cache.values());
    } finally {
      release();
    }
  }
}

export const sessionUsageCache = new LRUCache<string, Usage>(100);
