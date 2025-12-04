import { describe, it, expect } from 'vitest';
import { FastifyRequest } from 'fastify';
import { detectOAuthRequest, isOAuthTransparentRoute } from '../../utils/oauthDetector.js';

describe('OAuth Request Detection', () => {
  const createMockRequest = (url: string, body?: any, headers?: any): FastifyRequest => {
    return {
      url,
      method: 'POST',
      body: body || {},
      headers: headers || {},
    } as FastifyRequest;
  };

  describe('detectOAuthRequest', () => {
    it('should detect OAuth token exchange request', () => {
      const req = createMockRequest('/v1/oauth/token', {
        grant_type: 'authorization_code',
        code: 'test-code',
        redirect_uri: 'http://localhost:3000/callback'
      });

      const result = detectOAuthRequest(req);

      expect(result.isOAuthRequest).toBe(true);
      expect(result.requestType).toBe('token_exchange');
      expect(result.confidence).toBeGreaterThanOrEqual(0.8);
      expect(result.details.urlMatch).toBe(true);
      expect(result.details.bodyMatch).toBe(true);
    });

    it('should detect OAuth refresh token request', () => {
      const req = createMockRequest('/v1/oauth/refresh', {
        grant_type: 'refresh_token',
        refresh_token: 'test-refresh-token'
      });

      const result = detectOAuthRequest(req);

      expect(result.isOAuthRequest).toBe(true);
      expect(result.requestType).toBe('token_refresh');
      expect(result.confidence).toBeGreaterThanOrEqual(0.8);
      expect(result.details.urlMatch).toBe(true);
      expect(result.details.bodyMatch).toBe(true);
    });

    it('should detect OAuth user info request', () => {
      const req = createMockRequest('/v1/oauth/userinfo', {}, {
        authorization: 'Bearer test-token'
      });

      const result = detectOAuthRequest(req);

      expect(result.isOAuthRequest).toBe(true);
      expect(result.requestType).toBe('user_info');
      expect(result.confidence).toBeGreaterThanOrEqual(0.6);
      expect(result.details.urlMatch).toBe(true);
      expect(result.details.headerMatch).toBe(true);
    });

    it('should detect OAuth request with body parameters only', () => {
      const req = createMockRequest('/api/some-endpoint', {
        grant_type: 'client_credentials',
        client_id: 'test-client',
        client_secret: 'test-secret'
      });

      const result = detectOAuthRequest(req);

      expect(result.isOAuthRequest).toBe(true);
      expect(result.confidence).toBeGreaterThanOrEqual(0.3);
      expect(result.details.urlMatch).toBe(false);
      expect(result.details.bodyMatch).toBe(true);
    });

    it('should not detect non-OAuth request', () => {
      const req = createMockRequest('/v1/messages', {
        model: 'claude-3-sonnet',
        messages: [{ role: 'user', content: 'Hello' }]
      });

      const result = detectOAuthRequest(req);

      expect(result.isOAuthRequest).toBe(false);
      expect(result.requestType).toBe('unknown');
      expect(result.confidence).toBeLessThan(0.5);
    });

    it('should handle edge case with empty request', () => {
      const req = createMockRequest('', {});

      const result = detectOAuthRequest(req);

      expect(result.isOAuthRequest).toBe(false);
      expect(result.requestType).toBe('unknown');
      expect(result.confidence).toBe(0);
    });

    it('should detect OAuth request with different URL patterns', () => {
      const testCases = [
        '/oauth/token',
        '/oauth/refresh',
        '/v2/oauth/token',
        '/api/v1/oauth/token'
      ];

      testCases.forEach(url => {
        const req = createMockRequest(url, {
          grant_type: 'authorization_code'
        });

        const result = detectOAuthRequest(req);
        expect(result.isOAuthRequest).toBe(true);
        expect(result.confidence).toBeGreaterThan(0.5);
      });
    });
  });

  describe('isOAuthTransparentRoute', () => {
    it('should identify transparent OAuth routes', () => {
      const transparentRoutes = [
        '/v1/oauth/token',
        '/v1/oauth/refresh',
        '/oauth/userinfo',
        '/oauth/token',
        '/v1/oauth/introspect'
      ];

      transparentRoutes.forEach(route => {
        const result = isOAuthTransparentRoute(route);
        expect(result).toBe(true);
      });
    });

    it('should handle route subpaths', () => {
      const result = isOAuthTransparentRoute('/v1/oauth/token/some-subpath');
      expect(result).toBe(true);
    });

    it('should not identify non-OAuth routes', () => {
      const nonOAuthRoutes = [
        '/v1/messages',
        '/api/chat',
        '/health',
        '/ui/dashboard',
        '/oauth/invalid'
      ];

      nonOAuthRoutes.forEach(route => {
        const result = isOAuthTransparentRoute(route);
        expect(result).toBe(false);
      });
    });

    it('should use custom transparent routes', () => {
      const customRoutes = ['/custom/oauth', '/api/token'];
      const result = isOAuthTransparentRoute('/custom/oauth', customRoutes);
      expect(result).toBe(true);
    });
  });
});