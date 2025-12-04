/**
 * OAuth Token Sharing Manager
 *
 * Allows sharing OAuth tokens between Claude Code and the router
 * through a secure file-based storage mechanism
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { lock } from 'proper-lockfile';
import { OAuthToken } from './oauth.js';

export interface SharedOAuthToken {
  token: OAuthToken;
  timestamp: number;
  source: 'claude-code' | 'router';
}

export interface Logger {
  warn: (message: string, ...args: any[]) => void;
  error: (message: string, ...args: any[]) => void;
  info?: (message: string, ...args: any[]) => void;
  debug?: (message: string, ...args: any[]) => void;
}

export interface OAuthTokenShareOptions {
  maxAge?: number;
  logger?: Logger;
}

// Default console-based logger
const defaultLogger: Logger = {
  warn: (message: string, ...args: any[]) => console.warn(message, ...args),
  error: (message: string, ...args: any[]) => console.error(message, ...args),
  info: (message: string, ...args: any[]) => console.info(message, ...args),
  debug: (message: string, ...args: any[]) => console.debug(message, ...args),
};

export class OAuthTokenShare {
  private readonly tokenDir: string;
  private readonly tokenFile: string;
  private readonly maxAge: number;
  private readonly logger: Logger;

  constructor(tokenFile?: string, options?: OAuthTokenShareOptions) {
    if (tokenFile) {
      // Use custom token file path (for testing)
      this.tokenFile = tokenFile;
      this.tokenDir = path.dirname(tokenFile);
    } else {
      // Use default token file path
      this.tokenDir = path.join(os.homedir(), '.claude-code-router');
      this.tokenFile = path.join(this.tokenDir, 'shared-oauth-token.json');
    }

    // Use custom maxAge or default (5 minutes)
    this.maxAge = options?.maxAge ?? 5 * 60 * 1000;
    this.logger = options?.logger ?? defaultLogger;
  }

  /**
   * Share OAuth token from Claude Code
   */
  async shareToken(token: OAuthToken): Promise<void> {
    await this.ensureDir();
    await this.ensureFile();

    const sharedToken: SharedOAuthToken = {
      token,
      timestamp: Date.now(),
      source: 'claude-code',
    };

    // Use file locking to prevent race conditions
    const release = await lock(this.tokenFile);
    try {
      await fs.writeFile(this.tokenFile, JSON.stringify(sharedToken, null, 2), { mode: 0o600 });
    } finally {
      await release();
    }
  }

  /**
   * Get shared OAuth token in router
   * Uses file locking to prevent reading incomplete data during writes
   */
  async getToken(): Promise<OAuthToken | null> {
    try {
      // Check if file exists first
      try {
        await fs.access(this.tokenFile);
      } catch {
        return null;
      }

      // Check and enforce file permissions (security measure)
      try {
        const stats = await fs.stat(this.tokenFile);
        const mode = stats.mode & 0o777;
        // Ensure file has appropriate permissions (owner read/write only)
        if (mode !== 0o600) {
          this.logger.warn(`Token file has insecure permissions: ${mode.toString(8)}. Attempting to fix...`);
          try {
            // Attempt to fix permissions
            await fs.chmod(this.tokenFile, 0o600);
            this.logger.info?.(`Token file permissions fixed to 0600`);
          } catch (chmodError) {
            // If we can't fix permissions, reject the token for security
            this.logger.error(`Failed to fix token file permissions: ${chmodError}. Rejecting token for security.`);
            return null;
          }
        }
      } catch (error) {
        this.logger.warn('Unable to check token file permissions');
        // Continue anyway - the file might be newly created
      }

      // Use file locking to prevent race conditions with shareToken
      let release: (() => Promise<void>) | null = null;
      try {
        release = await lock(this.tokenFile, { retries: { retries: 3, minTimeout: 50, maxTimeout: 200 } });
      } catch (lockError) {
        // If lock fails, wait and retry once, then fail gracefully
        this.logger.warn('Failed to acquire token lock, attempting read-only access');
        await new Promise(resolve => setTimeout(resolve, 100));
        try {
          release = await lock(this.tokenFile, { retries: 1 });
        } catch {
          this.logger.warn('Unable to acquire token lock, skipping token read to prevent corruption');
          return null;
        }
      }

      try {
        const data = await fs.readFile(this.tokenFile, 'utf-8');

        // Handle empty file
        if (!data || data.trim() === '' || data.trim() === '{}') {
          return null;
        }

        const sharedToken: SharedOAuthToken = JSON.parse(data);

        // Validate token structure
        if (!sharedToken.token || !sharedToken.timestamp) {
          return null;
        }

        // Check if token is still valid (within maxAge)
        if (Date.now() - sharedToken.timestamp > this.maxAge) {
          await this.clearToken();
          return null;
        }

        // Check if token is expired
        if (typeof sharedToken.token.expires_at === 'number' &&
            sharedToken.token.expires_at > 0 &&
            Date.now() >= sharedToken.token.expires_at) {
          await this.clearToken();
          return null;
        }

        // Validate access_token exists
        if (!sharedToken.token.access_token ||
            typeof sharedToken.token.access_token !== 'string' ||
            sharedToken.token.access_token.trim() === '') {
          return null;
        }

        return sharedToken.token;
      } finally {
        if (release) {
          await release();
        }
      }
    } catch (error) {
      // File doesn't exist, is invalid JSON, or other error
      return null;
    }
  }

  /**
   * Clear shared token
   */
  async clearToken(): Promise<void> {
    try {
      await fs.unlink(this.tokenFile);
    } catch {
      // Ignore errors (file might not exist)
    }
  }

  /**
   * Check if shared token exists
   */
  async hasToken(): Promise<boolean> {
    const token = await this.getToken();
    return token !== null;
  }

  private async ensureDir(): Promise<void> {
    try {
      await fs.mkdir(this.tokenDir, { recursive: true, mode: 0o700 });
    } catch {
      // Directory might already exist
    }
  }

  /**
   * Ensure token file exists for locking
   */
  private async ensureFile(): Promise<void> {
    try {
      await fs.access(this.tokenFile);
    } catch {
      // File doesn't exist, create it with secure permissions
      await fs.writeFile(this.tokenFile, '{}', { mode: 0o600 });
    }
  }
}

// Singleton instance
export const oauthTokenShare = new OAuthTokenShare();
