/**
 * Tests for OAuth utility
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import path from 'path';

// Mock fs module
vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
  existsSync: vi.fn().mockReturnValue(true),
}));

// Mock fs/promises module
vi.mock('fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

// Mock proper-lockfile
vi.mock('proper-lockfile', () => ({
  lock: vi.fn().mockResolvedValue(vi.fn().mockResolvedValue(undefined)),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock HOME_DIR
vi.mock('../../constants', () => ({
  HOME_DIR: '/mock/.claude-code-router',
}));

// Import after mocks
import {
  generateLoginUrl,
  exchangeCode,
  refreshToken,
  saveCredentials,
  loadCredentials,
  deleteCredentials,
  isExpired,
  getValidAccessToken,
  getOAuthStatus,
  OAUTH_CREDENTIALS_FILE,
  OAUTH_STATE_FILE,
  OAuthCredentials,
} from '../../utils/oauth.js';

describe('OAuth utility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-15T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('generateLoginUrl', () => {
    it('should generate a valid authorization URL with correct parameters', () => {
      const result = generateLoginUrl();

      expect(result.url).toContain('https://claude.ai/oauth/authorize');
      expect(result.url).toContain('client_id=');
      expect(result.url).toContain('response_type=code');
      expect(result.url).toContain('redirect_uri=');
      expect(result.url).toContain('scope=');
      expect(result.url).toContain('state=');
      expect(result.url).toContain('code_challenge=');
      expect(result.url).toContain('code_challenge_method=S256');
    });

    it('should generate and return state and codeVerifier', () => {
      const result = generateLoginUrl();

      expect(result.state).toBeDefined();
      expect(result.state.length).toBeGreaterThan(0);
      expect(result.codeVerifier).toBeDefined();
      expect(result.codeVerifier.length).toBeGreaterThan(0);
    });

    it('should save state file with 0o600 permissions', () => {
      generateLoginUrl();

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        OAUTH_STATE_FILE,
        expect.any(String),
        { mode: 0o600 }
      );
    });

    it('should include correct scopes in URL', () => {
      const result = generateLoginUrl();

      expect(result.url).toContain('org%3Acreate_api_key');
      expect(result.url).toContain('user%3Aprofile');
      expect(result.url).toContain('user%3Ainference');
    });
  });

  describe('exchangeCode', () => {
    const validStateData = {
      state: 'test-state-123',
      codeVerifier: 'test-verifier-abc',
      createdAt: Date.now(),
    };

    const validTokenResponse = {
      access_token: 'access-token-xyz',
      refresh_token: 'refresh-token-xyz',
      expires_in: 3600,
      scope: 'org:create_api_key user:profile user:inference',
    };

    beforeEach(() => {
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(validStateData));
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(validTokenResponse),
      });
    });

    it('should return credentials for valid authorization code', async () => {
      // Must include state parameter due to CSRF protection (using query string format)
      const result = await exchangeCode('?code=valid-auth-code&state=test-state-123');

      expect(result).not.toBeNull();
      expect(result?.accessToken).toBe('access-token-xyz');
      expect(result?.refreshToken).toBe('refresh-token-xyz');
      expect(result?.scopes).toEqual(['org:create_api_key', 'user:profile', 'user:inference']);
    });

    it('should return null when state file not found', async () => {
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        const error: any = new Error('ENOENT');
        error.code = 'ENOENT';
        throw error;
      });

      const result = await exchangeCode('valid-auth-code');

      expect(result).toBeNull();
    });

    it('should reject CSRF attack (state mismatch)', async () => {
      const result = await exchangeCode('code?code=valid&state=wrong-state');

      expect(result).toBeNull();
      expect(fs.unlinkSync).toHaveBeenCalled();
    });

    it('should reject expired state (>10 minutes)', async () => {
      const expiredStateData = {
        ...validStateData,
        createdAt: Date.now() - 11 * 60 * 1000, // 11 minutes ago
      };
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(expiredStateData));

      // Must include state parameter due to CSRF protection (using query string format)
      const result = await exchangeCode('?code=valid-auth-code&state=test-state-123');

      expect(result).toBeNull();
      expect(fs.unlinkSync).toHaveBeenCalled();
    });

    it('should calculate expiresAt correctly', async () => {
      // Must include state parameter due to CSRF protection (using query string format)
      const result = await exchangeCode('?code=valid-auth-code&state=test-state-123');

      const expectedExpiresAt = Date.now() + 3600 * 1000;
      expect(result?.expiresAt).toBe(expectedExpiresAt);
    });

    it('should return null for failed token exchange', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        text: () => Promise.resolve('Invalid code'),
      });

      // Must include state parameter due to CSRF protection (using query string format)
      const result = await exchangeCode('?code=invalid-code&state=test-state-123');

      expect(result).toBeNull();
    });

    it('should parse full callback URL correctly', async () => {
      const callbackUrl = 'https://console.anthropic.com/oauth/code/callback?code=auth-code&state=test-state-123';

      const result = await exchangeCode(callbackUrl);

      expect(result).not.toBeNull();
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('"code":"auth-code"'),
        })
      );
    });
  });

  describe('refreshToken', () => {
    const validCredentials: OAuthCredentials = {
      accessToken: 'old-access-token',
      refreshToken: 'valid-refresh-token',
      expiresAt: Date.now() + 3600 * 1000,
      scopes: ['user:inference'],
    };

    const validRefreshResponse = {
      access_token: 'new-access-token',
      expires_in: 7200,
    };

    beforeEach(() => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(validRefreshResponse),
      });
    });

    it('should return new credentials for valid refresh token', async () => {
      const result = await refreshToken(validCredentials);

      expect(result).not.toBeNull();
      expect(result?.accessToken).toBe('new-access-token');
      expect(result?.refreshToken).toBe('valid-refresh-token'); // reused
    });

    it('should return null for invalid refresh token', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Invalid refresh token'),
      });

      const result = await refreshToken(validCredentials);

      expect(result).toBeNull();
    });

    it('should use new refresh token if provided in response', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          ...validRefreshResponse,
          refresh_token: 'new-refresh-token',
        }),
      });

      const result = await refreshToken(validCredentials);

      expect(result?.refreshToken).toBe('new-refresh-token');
    });
  });

  describe('getValidAccessToken', () => {
    const validCredentials: OAuthCredentials = {
      accessToken: 'valid-access-token',
      refreshToken: 'valid-refresh-token',
      expiresAt: Date.now() + 30 * 60 * 1000, // 30 minutes from now
      scopes: ['user:inference'],
    };

    beforeEach(() => {
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(validCredentials));
    });

    it('should return access token when not expired', async () => {
      const result = await getValidAccessToken();

      expect(result).toBe('valid-access-token');
    });

    it('should auto-refresh when token expires within 5 minutes', async () => {
      const soonExpiringCredentials = {
        ...validCredentials,
        expiresAt: Date.now() + 3 * 60 * 1000, // 3 minutes from now
      };
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(soonExpiringCredentials));

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          access_token: 'refreshed-access-token',
          expires_in: 3600,
        }),
      });

      const result = await getValidAccessToken();

      expect(result).toBe('refreshed-access-token');
    });

    it('should return null when no credentials exist', async () => {
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error('ENOENT');
      });

      const result = await getValidAccessToken();

      expect(result).toBeNull();
    });
  });

  describe('credentials persistence', () => {
    describe('saveCredentials', () => {
      it('should save credentials with 0o600 permissions', async () => {
        const credentials: OAuthCredentials = {
          accessToken: 'access',
          refreshToken: 'refresh',
          expiresAt: Date.now() + 3600 * 1000,
          scopes: ['user:inference'],
        };

        // saveCredentials is now async and uses file lock + fs/promises.writeFile
        await saveCredentials(credentials);

        // Verify lock was acquired
        const { lock } = await import('proper-lockfile');
        expect(lock).toHaveBeenCalled();

        // Verify file was written via fs/promises.writeFile
        const { writeFile } = await import('fs/promises');
        expect(writeFile).toHaveBeenCalledWith(
          OAUTH_CREDENTIALS_FILE,
          expect.any(String),
          { mode: 0o600 }
        );
      });
    });

    describe('loadCredentials', () => {
      it('should load valid credentials from file', () => {
        const credentials: OAuthCredentials = {
          accessToken: 'access',
          refreshToken: 'refresh',
          expiresAt: Date.now() + 3600 * 1000,
          scopes: ['user:inference'],
        };
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(credentials));

        const result = loadCredentials();

        expect(result).toEqual(credentials);
      });

      it('should return null for missing file', () => {
        vi.mocked(fs.readFileSync).mockImplementation(() => {
          throw new Error('ENOENT');
        });

        const result = loadCredentials();

        expect(result).toBeNull();
      });

      it('should return null for invalid JSON', () => {
        vi.mocked(fs.readFileSync).mockReturnValue('invalid json');

        const result = loadCredentials();

        expect(result).toBeNull();
      });

      it('should return null for missing required fields', () => {
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
          accessToken: 'access',
          // missing refreshToken and expiresAt
        }));

        const result = loadCredentials();

        expect(result).toBeNull();
      });
    });

    describe('deleteCredentials', () => {
      it('should delete credentials file', () => {
        deleteCredentials();

        expect(fs.unlinkSync).toHaveBeenCalledWith(OAUTH_CREDENTIALS_FILE);
      });

      it('should not throw when file does not exist', () => {
        vi.mocked(fs.unlinkSync).mockImplementation(() => {
          const error: any = new Error('ENOENT');
          error.code = 'ENOENT';
          throw error;
        });

        expect(() => deleteCredentials()).not.toThrow();
      });
    });
  });

  describe('isExpired', () => {
    it('should return false for non-expired token', () => {
      const credentials: OAuthCredentials = {
        accessToken: 'access',
        refreshToken: 'refresh',
        expiresAt: Date.now() + 30 * 60 * 1000, // 30 minutes from now
        scopes: [],
      };

      expect(isExpired(credentials)).toBe(false);
    });

    it('should return true for expired token', () => {
      const credentials: OAuthCredentials = {
        accessToken: 'access',
        refreshToken: 'refresh',
        expiresAt: Date.now() - 1000, // already expired
        scopes: [],
      };

      expect(isExpired(credentials)).toBe(true);
    });

    it('should return true when within 5 minute buffer', () => {
      const credentials: OAuthCredentials = {
        accessToken: 'access',
        refreshToken: 'refresh',
        expiresAt: Date.now() + 3 * 60 * 1000, // 3 minutes from now
        scopes: [],
      };

      expect(isExpired(credentials)).toBe(true);
    });
  });

  describe('getOAuthStatus', () => {
    it('should return hasCredentials: false when no credentials', () => {
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error('ENOENT');
      });

      const result = getOAuthStatus();

      expect(result).toEqual({ hasCredentials: false });
    });

    it('should return full status when credentials exist', () => {
      const credentials: OAuthCredentials = {
        accessToken: 'access',
        refreshToken: 'refresh',
        expiresAt: Date.now() + 30 * 60 * 1000,
        scopes: [],
      };
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(credentials));

      const result = getOAuthStatus();

      expect(result.hasCredentials).toBe(true);
      expect(result.expiresAt).toBe(credentials.expiresAt);
      expect(result.isExpired).toBe(false);
    });
  });
});
