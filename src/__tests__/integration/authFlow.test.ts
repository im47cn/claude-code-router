/**
 * Integration tests for OAuth authentication flow
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock oauthTokenShare before other imports
vi.mock('../../utils/oauthTokenShare.js', () => ({
  oauthTokenShare: {
    getToken: vi.fn(),
  },
}));

import { apiKeyAuth } from '../../middleware/auth.js';
import { getAuthHeaders, createSubagentHeaders } from '../../utils/authHeaders.js';
import { getAuthStrategy } from '../../utils/authConfigParser.js';
import { oauthTokenShare } from '../../utils/oauthTokenShare.js';

describe('OAuth authentication end-to-end flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const createMockRequest = (overrides: Record<string, any> = {}) => ({
    url: '/v1/messages',
    method: 'POST',
    headers: {},
    body: {},
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    ...overrides,
  });

  const createMockReply = () => {
    const reply: any = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
      header: vi.fn().mockReturnThis(),
    };
    return reply;
  };

  describe('OAuth forces Anthropic provider', () => {
    it('client-oauth should force Anthropic provider', async () => {
      const config = { APIKEY: 'test-api-key' };
      const middleware = apiKeyAuth(config);
      const req = createMockRequest({
        headers: {
          authorization: 'Bearer client-oauth-token',
        },
      });
      const reply = createMockReply();
      const done = vi.fn();

      await middleware(req as any, reply, done);

      expect((req as any).authType).toBe('client-oauth');
      // Verify auth headers would use Bearer
      const headers = await getAuthHeaders(req, config);
      expect(headers['Authorization']).toBe('Bearer client-oauth-token');
    });

    it('ccr-oauth should force Anthropic provider', async () => {
      const config = { APIKEY: 'test-api-key' };
      const middleware = apiKeyAuth(config);
      const req = createMockRequest();
      const reply = createMockReply();
      const done = vi.fn();

      vi.mocked(oauthTokenShare.getToken).mockResolvedValue({
        access_token: 'ccr-oauth-token',
        token_type: 'Bearer',
      });

      await middleware(req as any, reply, done);

      expect((req as any).authType).toBe('ccr-oauth');
      const headers = await getAuthHeaders(req, config);
      expect(headers['Authorization']).toBe('Bearer ccr-oauth-token');
    });

    it('api-key should not force provider', async () => {
      const config = { APIKEY: 'test-api-key' };
      const middleware = apiKeyAuth(config);
      const req = createMockRequest({
        headers: {
          'x-api-key': 'test-api-key',
        },
      });
      const reply = createMockReply();
      const done = vi.fn();

      vi.mocked(oauthTokenShare.getToken).mockResolvedValue(null);

      await middleware(req as any, reply, done);

      expect((req as any).authType).toBe('api-key');
      const headers = await getAuthHeaders(req, config);
      expect(headers['x-api-key']).toBe('test-api-key');
    });
  });

  describe('authentication combination scenarios', () => {
    it('Scenario 1: Client OAuth only', async () => {
      const config = {};
      const middleware = apiKeyAuth(config);
      const req = createMockRequest({
        headers: {
          authorization: 'Bearer client-token',
        },
      });
      const reply = createMockReply();
      const done = vi.fn();

      await middleware(req as any, reply, done);

      expect((req as any).authType).toBe('client-oauth');
      expect((req as any).authToken).toBe('client-token');
    });

    it('Scenario 2: CCR OAuth only', async () => {
      const config = {};
      const middleware = apiKeyAuth(config);
      const req = createMockRequest();
      const reply = createMockReply();
      const done = vi.fn();

      vi.mocked(oauthTokenShare.getToken).mockResolvedValue({
        access_token: 'ccr-token',
        token_type: 'Bearer',
      });

      await middleware(req as any, reply, done);

      expect((req as any).authType).toBe('ccr-oauth');
      expect((req as any).authToken).toBe('ccr-token');
    });

    it('Scenario 3: API Key only', async () => {
      const config = { APIKEY: 'api-key-only' };
      const middleware = apiKeyAuth(config);
      const req = createMockRequest({
        headers: {
          'x-api-key': 'api-key-only',
        },
      });
      const reply = createMockReply();
      const done = vi.fn();

      vi.mocked(oauthTokenShare.getToken).mockResolvedValue(null);

      await middleware(req as any, reply, done);

      expect((req as any).authType).toBe('api-key');
    });

    it('Scenario 4: Client OAuth + CCR OAuth (client priority)', async () => {
      const config = {};
      const middleware = apiKeyAuth(config);
      const req = createMockRequest({
        headers: {
          authorization: 'Bearer client-token',
        },
      });
      const reply = createMockReply();
      const done = vi.fn();

      // Even if CCR token exists, client token takes priority
      vi.mocked(oauthTokenShare.getToken).mockResolvedValue({
        access_token: 'ccr-token',
        token_type: 'Bearer',
      });

      await middleware(req as any, reply, done);

      expect((req as any).authType).toBe('client-oauth');
      expect((req as any).authToken).toBe('client-token');
    });

    it('Scenario 5: Client OAuth + API Key (OAuth priority)', async () => {
      const config = { APIKEY: 'api-key' };
      const middleware = apiKeyAuth(config);
      const req = createMockRequest({
        headers: {
          authorization: 'Bearer client-token',
          'x-api-key': 'api-key',
        },
      });
      const reply = createMockReply();
      const done = vi.fn();

      await middleware(req as any, reply, done);

      expect((req as any).authType).toBe('client-oauth');
      expect((req as any).authToken).toBe('client-token');
    });

    it('Scenario 6: No authentication configured', async () => {
      const config = {}; // no APIKEY
      const middleware = apiKeyAuth(config);
      const req = createMockRequest();
      const reply = createMockReply();

      vi.mocked(oauthTokenShare.getToken).mockResolvedValue(null);

      await middleware(req as any, reply);

      // Should pass through without auth (local mode)
      expect((req as any).authType).toBeUndefined();
    });
  });

  describe('route type and authentication strategy', () => {
    it('default route prefers OAuth', () => {
      const strategy = getAuthStrategy('default');
      expect(strategy?.primary).toBe('oauth');
      expect(strategy?.fallback).toBe('api-key');
    });

    it('think route prefers OAuth', () => {
      const strategy = getAuthStrategy('think');
      expect(strategy?.primary).toBe('oauth');
      expect(strategy?.fallback).toBe('api-key');
    });

    it('longContext route prefers OAuth', () => {
      const strategy = getAuthStrategy('longContext');
      expect(strategy?.primary).toBe('oauth');
      expect(strategy?.fallback).toBe('api-key');
    });

    it('background route uses API Key', () => {
      const strategy = getAuthStrategy('background');
      expect(strategy?.primary).toBe('api-key');
      expect(strategy?.subagentPassthrough).toBe(false);
    });

    it('webSearch route uses API Key', () => {
      const strategy = getAuthStrategy('webSearch');
      expect(strategy?.primary).toBe('api-key');
    });

    it('subagent route uses API Key', () => {
      const strategy = getAuthStrategy('subagent');
      expect(strategy?.primary).toBe('api-key');
      expect(strategy?.subagentPassthrough).toBe(false);
    });
  });

  describe('subagent header inheritance', () => {
    it('subagent should inherit parent OAuth auth', async () => {
      const parentReq = {
        authToken: 'parent-oauth-token',
        authType: 'client-oauth',
      };
      const config = { APIKEY: 'fallback-api-key' };

      const headers = await createSubagentHeaders(parentReq, config);

      expect(headers['Authorization']).toBe('Bearer parent-oauth-token');
      expect(headers['content-type']).toBe('application/json');
    });

    it('subagent should inherit parent API key auth', async () => {
      const parentReq = {
        authToken: 'parent-api-key',
        authType: 'api-key',
      };
      const config = {};

      const headers = await createSubagentHeaders(parentReq, config);

      expect(headers['x-api-key']).toBe('parent-api-key');
      expect(headers['content-type']).toBe('application/json');
    });
  });

  describe('authentication fallback chain', () => {
    it('should fallback from OAuth to API key when OAuth fails', async () => {
      const config = { APIKEY: 'fallback-api-key' };
      const middleware = apiKeyAuth(config);
      const req = createMockRequest({
        headers: {
          // No Bearer token
          'x-api-key': 'fallback-api-key',
        },
      });
      const reply = createMockReply();
      const done = vi.fn();

      // CCR OAuth also fails
      vi.mocked(oauthTokenShare.getToken).mockResolvedValue(null);

      await middleware(req as any, reply, done);

      expect((req as any).authType).toBe('api-key');
      expect((req as any).authToken).toBe('fallback-api-key');
    });

    it('should handle OAuth token fetch error gracefully', async () => {
      const config = { APIKEY: 'fallback-api-key' };
      const middleware = apiKeyAuth(config);
      const req = createMockRequest({
        headers: {
          'x-api-key': 'fallback-api-key',
        },
      });
      const reply = createMockReply();
      const done = vi.fn();

      vi.mocked(oauthTokenShare.getToken).mockRejectedValue(new Error('Token fetch failed'));

      await middleware(req as any, reply, done);

      expect((req as any).authType).toBe('api-key');
    });
  });

  describe('security considerations', () => {
    it('should not expose auth token in error messages', async () => {
      const config = { APIKEY: 'secret-api-key' };
      const middleware = apiKeyAuth(config);
      const req = createMockRequest({
        headers: {
          'x-api-key': 'wrong-key',
        },
      });
      const reply = createMockReply();
      const done = vi.fn();

      vi.mocked(oauthTokenShare.getToken).mockResolvedValue(null);

      await middleware(req as any, reply, done);

      expect(reply.send).toHaveBeenCalledWith('Invalid API key');
      // Should not contain actual key in error
      expect(reply.send).not.toHaveBeenCalledWith(expect.stringContaining('secret'));
    });

    it('should reject requests without auth on protected endpoints', async () => {
      const config = { APIKEY: 'secret-api-key' };
      const middleware = apiKeyAuth(config);
      const req = createMockRequest({
        url: '/v1/messages',
      });
      const reply = createMockReply();
      const done = vi.fn();

      vi.mocked(oauthTokenShare.getToken).mockResolvedValue(null);

      await middleware(req as any, reply, done);

      expect(reply.status).toHaveBeenCalledWith(401);
    });
  });
});
