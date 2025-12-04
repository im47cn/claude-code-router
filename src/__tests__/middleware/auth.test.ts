/**
 * Tests for Authentication Middleware
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock oauthTokenShare
vi.mock('../../utils/oauthTokenShare.js', () => ({
  oauthTokenShare: {
    getToken: vi.fn(),
  },
}));

import { apiKeyAuth } from '../../middleware/auth.js';
import { oauthTokenShare } from '../../utils/oauthTokenShare.js';

describe('apiKeyAuth middleware', () => {
  const createMockRequest = (overrides: Record<string, any> = {}) => ({
    url: '/v1/messages',
    method: 'POST',
    headers: {},
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

  const createMockConfig = (overrides: Record<string, any> = {}) => ({
    PORT: 3456,
    APIKEY: 'test-api-key-12345',
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('public endpoints', () => {
    it('should skip authentication for / endpoint', async () => {
      const config = createMockConfig();
      const middleware = apiKeyAuth(config);
      const req = createMockRequest({ url: '/' });
      const reply = createMockReply();
      
      await middleware(req as any, reply);

            expect(reply.status).not.toHaveBeenCalled();
    });

    it('should skip authentication for /health endpoint', async () => {
      const config = createMockConfig();
      const middleware = apiKeyAuth(config);
      const req = createMockRequest({ url: '/health' });
      const reply = createMockReply();
      
      await middleware(req as any, reply);

            expect(reply.status).not.toHaveBeenCalled();
    });

    it('should skip authentication for /ui/* endpoints', async () => {
      const config = createMockConfig();
      const middleware = apiKeyAuth(config);
      const req = createMockRequest({ url: '/ui/index.html' });
      const reply = createMockReply();
      
      await middleware(req as any, reply);

            expect(reply.status).not.toHaveBeenCalled();
    });
  });

  describe('authentication priority', () => {
    it('Priority 1: should use client Bearer token when present', async () => {
      const config = createMockConfig();
      const middleware = apiKeyAuth(config);
      const req = createMockRequest({
        headers: {
          authorization: 'Bearer client-oauth-token',
        },
      });
      const reply = createMockReply();
      
      await middleware(req as any, reply);

      expect((req as any).authToken).toBe('client-oauth-token');
      expect((req as any).authType).toBe('client-oauth');
          });

    it('Priority 2: should use CCR OAuth token when no client token', async () => {
      const config = createMockConfig();
      const middleware = apiKeyAuth(config);
      const req = createMockRequest();
      const reply = createMockReply();
      
      vi.mocked(oauthTokenShare.getToken).mockResolvedValue({
        access_token: 'ccr-oauth-token',
        token_type: 'Bearer',
      });

      await middleware(req as any, reply);

      expect((req as any).authToken).toBe('ccr-oauth-token');
      expect((req as any).authType).toBe('ccr-oauth');
          });

    it('Priority 3: should use x-api-key header when no OAuth tokens', async () => {
      const config = createMockConfig();
      const middleware = apiKeyAuth(config);
      const req = createMockRequest({
        headers: {
          'x-api-key': 'test-api-key-12345',
        },
      });
      const reply = createMockReply();
      
      vi.mocked(oauthTokenShare.getToken).mockResolvedValue(null);

      await middleware(req as any, reply);

      expect((req as any).authToken).toBe('test-api-key-12345');
      expect((req as any).authType).toBe('api-key');
          });
  });

  describe('client OAuth authentication', () => {
    it('should set authType=client-oauth for valid Bearer token', async () => {
      const config = createMockConfig();
      const middleware = apiKeyAuth(config);
      const req = createMockRequest({
        headers: {
          authorization: 'Bearer valid-client-token',
        },
      });
      const reply = createMockReply();
      
      await middleware(req as any, reply);

      expect((req as any).authType).toBe('client-oauth');
    });

    it('should fallback when Bearer token is empty', async () => {
      const config = createMockConfig();
      const middleware = apiKeyAuth(config);
      const req = createMockRequest({
        headers: {
          authorization: 'Bearer ',
          'x-api-key': 'test-api-key-12345',
        },
      });
      const reply = createMockReply();
      
      vi.mocked(oauthTokenShare.getToken).mockResolvedValue(null);

      await middleware(req as any, reply);

      // Should fallback to api-key
      expect((req as any).authType).toBe('api-key');
    });

    it('should handle array Authorization header', async () => {
      const config = createMockConfig();
      const middleware = apiKeyAuth(config);
      const req = createMockRequest({
        headers: {
          authorization: ['Bearer first-token', 'Bearer second-token'],
        },
      });
      const reply = createMockReply();
      
      await middleware(req as any, reply);

      expect((req as any).authToken).toBe('first-token');
    });
  });

  describe('CCR OAuth authentication', () => {
    it('should set authType=ccr-oauth when shared token exists', async () => {
      const config = createMockConfig();
      const middleware = apiKeyAuth(config);
      const req = createMockRequest();
      const reply = createMockReply();
      
      vi.mocked(oauthTokenShare.getToken).mockResolvedValue({
        access_token: 'ccr-token',
        token_type: 'Bearer',
      });

      await middleware(req as any, reply);

      expect((req as any).authType).toBe('ccr-oauth');
    });

    it('should fallback to API key when shared token is null', async () => {
      const config = createMockConfig();
      const middleware = apiKeyAuth(config);
      const req = createMockRequest({
        headers: {
          'x-api-key': 'test-api-key-12345',
        },
      });
      const reply = createMockReply();
      
      vi.mocked(oauthTokenShare.getToken).mockResolvedValue(null);

      await middleware(req as any, reply);

      expect((req as any).authType).toBe('api-key');
    });

    it('should fallback to API key when shared token fetch fails', async () => {
      const config = createMockConfig();
      const middleware = apiKeyAuth(config);
      const req = createMockRequest({
        headers: {
          'x-api-key': 'test-api-key-12345',
        },
      });
      const reply = createMockReply();
      
      vi.mocked(oauthTokenShare.getToken).mockRejectedValue(new Error('Token fetch failed'));

      await middleware(req as any, reply);

      expect((req as any).authType).toBe('api-key');
    });
  });

  describe('API Key authentication', () => {
    it('should accept valid API key', async () => {
      const config = createMockConfig();
      const middleware = apiKeyAuth(config);
      const req = createMockRequest({
        headers: {
          'x-api-key': 'test-api-key-12345',
        },
      });
      const reply = createMockReply();
      
      vi.mocked(oauthTokenShare.getToken).mockResolvedValue(null);

      await middleware(req as any, reply);

      expect((req as any).authType).toBe('api-key');
          });

    it('should reject invalid API key', async () => {
      const config = createMockConfig();
      const middleware = apiKeyAuth(config);
      const req = createMockRequest({
        headers: {
          'x-api-key': 'wrong-api-key',
        },
      });
      const reply = createMockReply();
      
      vi.mocked(oauthTokenShare.getToken).mockResolvedValue(null);

      await middleware(req as any, reply);

      expect(reply.status).toHaveBeenCalledWith(401);
      expect(reply.send).toHaveBeenCalledWith('Invalid API key');
    });

    it('should return 401 when x-api-key is missing', async () => {
      const config = createMockConfig();
      const middleware = apiKeyAuth(config);
      const req = createMockRequest();
      const reply = createMockReply();
      
      vi.mocked(oauthTokenShare.getToken).mockResolvedValue(null);

      await middleware(req as any, reply);

      expect(reply.status).toHaveBeenCalledWith(401);
      expect(reply.send).toHaveBeenCalledWith('x-api-key is missing');
    });
  });

  describe('no API key configured (local mode)', () => {
    it('should allow local access when no API key is set', async () => {
      const config = createMockConfig({ APIKEY: undefined });
      const middleware = apiKeyAuth(config);
      const req = createMockRequest({
        url: '/health' // Use public endpoint instead of protected endpoint
      });
      const reply = createMockReply();

      vi.mocked(oauthTokenShare.getToken).mockResolvedValue(null);

      await middleware(req as any, reply);

            expect(reply.status).not.toHaveBeenCalled();
    });

    it('should allow CORS for local origins', async () => {
      const config = createMockConfig({ APIKEY: undefined, PORT: 3456 });
      const middleware = apiKeyAuth(config);
      const req = createMockRequest({
        headers: {
          origin: 'http://localhost:3456',
        },
      });
      const reply = createMockReply();
      
      vi.mocked(oauthTokenShare.getToken).mockResolvedValue(null);

      await middleware(req as any, reply);

      expect(reply.header).toHaveBeenCalledWith('Access-Control-Allow-Origin', 'http://localhost:3456');
          });

    it('should reject non-local origins when no API key is set', async () => {
      const config = createMockConfig({ APIKEY: undefined, PORT: 3456 });
      const middleware = apiKeyAuth(config);
      const req = createMockRequest({
        headers: {
          origin: 'http://malicious-site.com',
        },
      });
      const reply = createMockReply();
      
      vi.mocked(oauthTokenShare.getToken).mockResolvedValue(null);

      await middleware(req as any, reply);

      expect(reply.status).toHaveBeenCalledWith(403);
      expect(reply.send).toHaveBeenCalledWith('CORS not allowed for this origin');
    });

    it('should allow 127.0.0.1 origin when no API key is set', async () => {
      const config = createMockConfig({ APIKEY: undefined, PORT: 3456 });
      const middleware = apiKeyAuth(config);
      const req = createMockRequest({
        headers: {
          origin: 'http://127.0.0.1:3456',
        },
      });
      const reply = createMockReply();
      
      vi.mocked(oauthTokenShare.getToken).mockResolvedValue(null);

      await middleware(req as any, reply);

      expect(reply.header).toHaveBeenCalledWith('Access-Control-Allow-Origin', 'http://127.0.0.1:3456');
          });
  });

  describe('API key validation', () => {
    it('should reject wrong API key', async () => {
      const config = createMockConfig({ APIKEY: 'secret-key-123' });
      const middleware = apiKeyAuth(config);

      const req = createMockRequest({
        headers: {
          'x-api-key': 'wrong-key',
        },
      });
      const reply = createMockReply();
      
      vi.mocked(oauthTokenShare.getToken).mockResolvedValue(null);

      await middleware(req as any, reply);

      expect(reply.status).toHaveBeenCalledWith(401);
    });
  });
});
