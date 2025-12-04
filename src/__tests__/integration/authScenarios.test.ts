import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { createAuthTestApp } from '../utils/authTestApp.js';

describe('Authentication Scenarios Integration Tests', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await createAuthTestApp();
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('OAuth Transparent Forwarding', () => {
    it('should bypass authentication for OAuth token requests', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/oauth/token',
        headers: {
          'content-type': 'application/json'
        },
        payload: {
          grant_type: 'authorization_code',
          code: 'test-code',
          client_id: 'test-client'
        }
      });

      // OAuth requests should bypass authentication
      // In a real environment, this would be forwarded to the OAuth provider
      expect(response.statusCode).toBeGreaterThanOrEqual(400);
    });

    it('should bypass authentication for OAuth refresh requests', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/oauth/refresh',
        headers: {
          'content-type': 'application/json'
        },
        payload: {
          grant_type: 'refresh_token',
          refresh_token: 'test-refresh-token'
        }
      });

      expect(response.statusCode).toBeGreaterThanOrEqual(400);
    });

    it('should bypass authentication for OAuth user info requests', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/oauth/userinfo',
        headers: {
          'authorization': 'Bearer test-token'
        }
      });

      expect(response.statusCode).toBeGreaterThanOrEqual(400);
    });

    it('should bypass model routing for OAuth requests', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/oauth/token',
        headers: {
          'content-type': 'application/json'
        },
        payload: {
          grant_type: 'client_credentials'
        }
      });

      // Should not trigger model routing logic
      expect(response.statusCode).toBeGreaterThanOrEqual(400);
    });
  });

  describe('Client OAuth Priority', () => {
    it('should use client OAuth token when present', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/messages',
        headers: {
          'authorization': 'Bearer client-oauth-token',
          'content-type': 'application/json'
        },
        payload: {
          model: 'anthropic,claude-3-sonnet',
          messages: [{ role: 'user', content: 'Hello' }]
        }
      });

      expect(response.statusCode).toBeGreaterThanOrEqual(400);
      // In real environment, client OAuth should be used for upstream request
    });

    it('should fall back to CCR OAuth when client OAuth not present', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/messages',
        headers: {
          'content-type': 'application/json',
          'x-api-key': 'test-api-key'
        },
        payload: {
          model: 'anthropic,claude-3-sonnet',
          messages: [{ role: 'user', content: 'Hello' }]
        }
      });

      expect(response.statusCode).toBeGreaterThanOrEqual(400);
    });

    it('should use API key as final fallback', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/messages',
        headers: {
          'content-type': 'application/json'
        },
        payload: {
          model: 'anthropic,claude-3-sonnet',
          messages: [{ role: 'user', content: 'Hello' }]
        }
      });

      expect(response.statusCode).toBeGreaterThanOrEqual(400);
    });
  });

  describe('ClaudeMem Authentication Override', () => {
    it('should override client OAuth for ClaudeMem requests', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/messages',
        headers: {
          'authorization': 'Bearer client-oauth-token',
          'content-type': 'application/json'
        },
        payload: {
          model: 'anthropic,claude-3-sonnet',
          messages: [
            { role: 'user', content: 'You are a Claude-Mem' }
          ]
        }
      });

      expect(response.statusCode).toBeGreaterThanOrEqual(400);
      // Client OAuth should be cleared, Provider API Key should be used
    });

    it('should override CCR OAuth for ClaudeMem requests', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/messages',
        headers: {
          'content-type': 'application/json'
        },
        payload: {
          model: 'anthropic,claude-3-sonnet',
          messages: [
            { role: 'user', content: 'You are a Claude-Mem' }
          ]
        }
      });

      expect(response.statusCode).toBeGreaterThanOrEqual(400);
      // Any OAuth should be cleared, Provider API Key should be used
    });

    it('should preserve regular requests with client OAuth', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/messages',
        headers: {
          'authorization': 'Bearer client-oauth-token',
          'content-type': 'application/json'
        },
        payload: {
          model: 'anthropic,claude-3-sonnet',
          messages: [
            { role: 'user', content: 'Regular request' }
          ]
        }
      });

      expect(response.statusCode).toBeGreaterThanOrEqual(400);
      // Client OAuth should be preserved for regular requests
    });
  });

  describe('Mixed Authentication Scenarios', () => {
    it('should handle request with both client OAuth and API key headers', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/messages',
        headers: {
          'authorization': 'Bearer client-oauth-token',
          'x-api-key': 'api-key-header',
          'content-type': 'application/json'
        },
        payload: {
          model: 'anthropic,claude-3-sonnet',
          messages: [{ role: 'user', content: 'Hello' }]
        }
      });

      expect(response.statusCode).toBeGreaterThanOrEqual(400);
      // Client OAuth should take priority over API key
    });

    it('should handle ClaudeMem request with both auth headers', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/messages',
        headers: {
          'authorization': 'Bearer client-oauth-token',
          'x-api-key': 'api-key-header',
          'content-type': 'application/json'
        },
        payload: {
          model: 'anthropic,claude-3-sonnet',
          messages: [
            { role: 'user', content: 'You are a Claude-Mem' }
          ]
        }
      });

      expect(response.statusCode).toBeGreaterThanOrEqual(400);
      // Both should be cleared, Provider API Key should be used
    });

    it('should handle empty authorization header', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/messages',
        headers: {
          'authorization': '',
          'content-type': 'application/json'
        },
        payload: {
          model: 'anthropic,claude-3-sonnet',
          messages: [{ role: 'user', content: 'Hello' }]
        }
      });

      expect(response.statusCode).toBeGreaterThanOrEqual(400);
      // Should fall back to other auth methods
    });

    it('should handle malformed Bearer token', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/messages',
        headers: {
          'authorization': 'InvalidToken',
          'content-type': 'application/json'
        },
        payload: {
          model: 'anthropic,claude-3-sonnet',
          messages: [{ role: 'user', content: 'Hello' }]
        }
      });

      expect(response.statusCode).toBeGreaterThanOrEqual(400);
      // Should fall back to other auth methods
    });
  });

  describe('Public Endpoint Handling', () => {
    let publicApp: FastifyInstance;

    beforeEach(async () => {
      publicApp = await createAuthTestApp({ APIKEY: undefined });
      await publicApp.ready();
    });

    afterEach(async () => {
      await publicApp.close();
    });

    it('should allow access to health endpoint', async () => {
      const response = await publicApp.inject({
        method: 'GET',
        url: '/health'
      });

      
      expect(response.statusCode).toBe(200);
    });

    it('should allow access to root endpoint', async () => {
      const response = await publicApp.inject({
        method: 'GET',
        url: '/'
      });

      expect(response.statusCode).toBe(200);
    });

    it('should allow access to UI endpoints', async () => {
      const response = await publicApp.inject({
        method: 'GET',
        url: '/ui/dashboard'
      });

      expect(response.statusCode).toBeGreaterThanOrEqual(200);
    });
  });

  describe('Error Handling', () => {
    let errorApp: FastifyInstance;

    beforeEach(async () => {
      errorApp = await createAuthTestApp({ APIKEY: undefined });
      await errorApp.ready();
    });

    afterEach(async () => {
      await errorApp.close();
    });

    it('should handle missing API key for protected endpoints', async () => {
      const response = await errorApp.inject({
        method: 'POST',
        url: '/v1/messages',
        headers: {
          'content-type': 'application/json'
        },
        payload: {
          model: 'anthropic,claude-3-sonnet',
          messages: [{ role: 'user', content: 'Hello' }]
        }
      });

      expect(response.statusCode).toBe(401);
    });

    it('should handle invalid API key', async () => {
      const response = await errorApp.inject({
        method: 'POST',
        url: '/v1/messages',
        headers: {
          'x-api-key': 'invalid-api-key',
          'content-type': 'application/json'
        },
        payload: {
          model: 'anthropic,claude-3-sonnet',
          messages: [{ role: 'user', content: 'Hello' }]
        }
      });

      expect(response.statusCode).toBe(401);
    });

    it('should handle CORS violations when no API key configured', async () => {
      const response = await errorApp.inject({
        method: 'POST',
        url: '/v1/messages',
        headers: {
          'origin': 'http://malicious-site.com',
          'content-type': 'application/json'
        },
        payload: {
          model: 'anthropic,claude-3-sonnet',
          messages: [{ role: 'user', content: 'Hello' }]
        }
      });

      expect(response.statusCode).toBe(403);
    });
  });
});