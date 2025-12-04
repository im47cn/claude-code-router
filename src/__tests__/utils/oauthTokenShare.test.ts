/**
 * Tests for OAuth Token Sharing utility
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import { lock } from 'proper-lockfile';

// Mock fs/promises
vi.mock('fs/promises', () => ({
  default: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    unlink: vi.fn(),
    access: vi.fn(),
    mkdir: vi.fn(),
  },
  readFile: vi.fn(),
  writeFile: vi.fn(),
  unlink: vi.fn(),
  access: vi.fn(),
  mkdir: vi.fn(),
}));

// Mock proper-lockfile
vi.mock('proper-lockfile', () => ({
  lock: vi.fn().mockResolvedValue(vi.fn().mockResolvedValue(undefined)),
}));

// Import after mocks
import { OAuthTokenShare, oauthTokenShare, SharedOAuthToken } from '../../utils/oauthTokenShare.js';
import { OAuthToken } from '../../utils/oauth.js';

describe('OAuthTokenShare', () => {
  let tokenShare: OAuthTokenShare;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-15T12:00:00.000Z'));
    tokenShare = new OAuthTokenShare();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('shareToken', () => {
    const validToken: OAuthToken = {
      access_token: 'test-access-token',
      token_type: 'Bearer',
      expires_at: Date.now() + 3600 * 1000,
    };

    it('should write shared token file correctly', async () => {
      await tokenShare.shareToken(validToken);

      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('shared-oauth-token.json'),
        expect.any(String),
        { mode: 0o600 }
      );
    });

    it('should include timestamp and source in shared token', async () => {
      await tokenShare.shareToken(validToken);

      const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
      // First call is ensureFile creating empty file, second is the actual write
      const calls = vi.mocked(fs.writeFile).mock.calls;
      const lastCall = calls[calls.length - 1];
      const writtenData = JSON.parse(lastCall[1] as string);

      expect(writtenData.token).toEqual(validToken);
      expect(writtenData.timestamp).toBe(Date.now());
      expect(writtenData.source).toBe('claude-code');
    });

    it('should use file locking for concurrent writes', async () => {
      await tokenShare.shareToken(validToken);

      expect(lock).toHaveBeenCalled();
    });
  });

  describe('getToken', () => {
    const validSharedToken: SharedOAuthToken = {
      token: {
        access_token: 'test-access-token',
        token_type: 'Bearer',
        expires_at: Date.now() + 3600 * 1000,
      },
      timestamp: Date.now(),
      source: 'claude-code',
    };

    it('should return token when valid', async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(validSharedToken));

      const result = await tokenShare.getToken();

      expect(result).toEqual(validSharedToken.token);
    });

    it('should return null and clear when token is expired (>5 minutes)', async () => {
      const expiredToken: SharedOAuthToken = {
        ...validSharedToken,
        timestamp: Date.now() - 6 * 60 * 1000, // 6 minutes ago
      };
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(expiredToken));

      const result = await tokenShare.getToken();

      expect(result).toBeNull();
      expect(fs.unlink).toHaveBeenCalled();
    });

    it('should return null when file does not exist', async () => {
      vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));

      const result = await tokenShare.getToken();

      expect(result).toBeNull();
    });

    it('should return null for corrupted JSON', async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockResolvedValue('not valid json');

      const result = await tokenShare.getToken();

      expect(result).toBeNull();
    });

    it('should return null for empty file', async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockResolvedValue('');

      const result = await tokenShare.getToken();

      expect(result).toBeNull();
    });

    it('should return null for empty object', async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockResolvedValue('{}');

      const result = await tokenShare.getToken();

      expect(result).toBeNull();
    });

    it('should return null when access_token is expired', async () => {
      const expiredAccessToken: SharedOAuthToken = {
        token: {
          access_token: 'test-access-token',
          token_type: 'Bearer',
          expires_at: Date.now() - 1000, // already expired
        },
        timestamp: Date.now(),
        source: 'claude-code',
      };
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(expiredAccessToken));

      const result = await tokenShare.getToken();

      expect(result).toBeNull();
      expect(fs.unlink).toHaveBeenCalled();
    });

    it('should return null when access_token is empty', async () => {
      const emptyAccessToken: SharedOAuthToken = {
        token: {
          access_token: '',
          token_type: 'Bearer',
        },
        timestamp: Date.now(),
        source: 'claude-code',
      };
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(emptyAccessToken));

      const result = await tokenShare.getToken();

      expect(result).toBeNull();
    });
  });

  describe('clearToken', () => {
    it('should delete the shared token file', async () => {
      await tokenShare.clearToken();

      expect(fs.unlink).toHaveBeenCalledWith(
        expect.stringContaining('shared-oauth-token.json')
      );
    });

    it('should not throw when file does not exist', async () => {
      vi.mocked(fs.unlink).mockRejectedValue(new Error('ENOENT'));

      await expect(tokenShare.clearToken()).resolves.not.toThrow();
    });
  });

  describe('hasToken', () => {
    it('should return true when valid token exists', async () => {
      const validSharedToken: SharedOAuthToken = {
        token: {
          access_token: 'test-access-token',
          token_type: 'Bearer',
        },
        timestamp: Date.now(),
        source: 'claude-code',
      };
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(validSharedToken));

      const result = await tokenShare.hasToken();

      expect(result).toBe(true);
    });

    it('should return false when no token exists', async () => {
      vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));

      const result = await tokenShare.hasToken();

      expect(result).toBe(false);
    });
  });

  describe('singleton instance', () => {
    it('should export a singleton instance', () => {
      expect(oauthTokenShare).toBeInstanceOf(OAuthTokenShare);
    });
  });
});
