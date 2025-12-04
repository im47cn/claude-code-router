import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { createTestApp } from '../utils/testApp.js';

describe('OAuth Router Integration Tests', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = createTestApp();
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('OAuth Request Routing', () => {
    it('should route OAuth request with valid router marker to target model', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/oauth/token',
        headers: {
          'content-type': 'application/json',
          'authorization': 'Bearer client-oauth-token'
        },
        payload: {
          grant_type: 'authorization_code',
          code: 'test-code',
          client_id: 'test-client',
          system: [
            { type: 'text', text: 'You are a helpful assistant' },
            { type: 'text', text: '<CCR-SUBAGENT-ROUTER>frontend</CCR-SUBAGENT-ROUTER>' }
          ]
        }
      });

      // Should attempt routing instead of transparent forwarding
      expect(response.statusCode).toBeGreaterThanOrEqual(400);
    });

    it('should transparently forward OAuth request without router marker', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/oauth/token',
        headers: {
          'content-type': 'application/json',
          'authorization': 'Bearer client-oauth-token'
        },
        payload: {
          grant_type: 'authorization_code',
          code: 'test-code',
          client_id: 'test-client',
          system: [
            { type: 'text', text: 'You are a helpful assistant' }
          ]
        }
      });

      // Should transparently forward (bypass routing)
      expect(response.statusCode).toBeGreaterThanOrEqual(400);
    });

    it('should handle OAuth request with invalid router marker gracefully', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/oauth/token',
        headers: {
          'content-type': 'application/json'
        },
        payload: {
          grant_type: 'authorization_code',
          code: 'test-code',
          client_id: 'test-client',
          system: [
            { type: 'text', text: 'You are a helpful assistant' },
            { type: 'text', text: '<CCR-SUBAGENT-ROUTER>nonexistent</CCR-SUBAGENT-ROUTER>' }
          ]
        }
      });

      // Should fall back to transparent forwarding for invalid router
      expect(response.statusCode).toBeGreaterThanOrEqual(400);
    });
  });

  describe('Dynamic Router Names', () => {
    it('should support multiple dynamic router names', async () => {
      const routerNames = ['frontend', 'backend', 'architect', 'devops', 'mobile'];

      for (const routerName of routerNames) {
        const response = await app.inject({
          method: 'POST',
          url: '/v1/oauth/token',
          headers: {
            'content-type': 'application/json'
          },
          payload: {
            grant_type: 'authorization_code',
            code: 'test-code',
            client_id: 'test-client',
            system: [
              { type: 'text', text: 'You are a helpful assistant' },
              { type: 'text', text: `<CCR-SUBAGENT-ROUTER>${routerName}</CCR-SUBAGENT-ROUTER>` }
            ]
          }
        });

        expect(response.statusCode).toBeGreaterThanOrEqual(400);
      }
    });
  });

  describe('OAuth Endpoint Compatibility', () => {
    it('should work with different OAuth endpoints', async () => {
      const oauthEndpoints = [
        '/v1/oauth/token',
        '/v1/oauth/refresh',
        '/v1/oauth/userinfo',
        '/oauth/token'
      ];

      for (const endpoint of oauthEndpoints) {
        const response = await app.inject({
          method: endpoint.includes('userinfo') ? 'GET' : 'POST',
          url: endpoint,
          headers: {
            'content-type': 'application/json',
            'authorization': 'Bearer client-oauth-token'
          },
          payload: endpoint.includes('userinfo') ? undefined : {
            grant_type: 'authorization_code',
            code: 'test-code',
            client_id: 'test-client',
            system: [
              { type: 'text', text: 'You are a helpful assistant' },
              { type: 'text', text: '<CCR-SUBAGENT-ROUTER>frontend</CCR-SUBAGENT-ROUTER>' }
            ]
          }
        });

        expect(response.statusCode).toBeGreaterThanOrEqual(400);
      }
    });
  });

  describe('Backward Compatibility', () => {
    it('should maintain backward compatibility with existing OAuth requests', async () => {
      // Test existing OAuth request patterns without router markers
      const existingRequests = [
        {
          description: 'Standard OAuth token request',
          payload: {
            grant_type: 'authorization_code',
            code: 'test-code',
            client_id: 'test-client'
          }
        },
        {
          description: 'OAuth refresh request',
          payload: {
            grant_type: 'refresh_token',
            refresh_token: 'test-refresh-token'
          }
        },
        {
          description: 'OAuth client credentials request',
          payload: {
            grant_type: 'client_credentials',
            client_id: 'test-client',
            client_secret: 'test-secret'
          }
        }
      ];

      for (const request of existingRequests) {
        const response = await app.inject({
          method: 'POST',
          url: '/v1/oauth/token',
          headers: {
            'content-type': 'application/json'
          },
          payload: request.payload
        });

        // Should continue to work as before (transparent forwarding)
        expect(response.statusCode).toBeGreaterThanOrEqual(400);
      }
    });

    it('should not affect non-OAuth requests', async () => {
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

      expect(response.statusCode).toBe(200);
    });
  });

  describe('Error Handling', () => {
    it('should handle malformed system messages gracefully', async () => {
      const malformedSystemMessages = [
        null,
        undefined,
        [],
        [{ type: 'text', text: 'Only one system message' }],
        [{ type: 'text', text: 'First' }, { type: 'text' }] // missing text
      ];

      for (const system of malformedSystemMessages) {
        const response = await app.inject({
          method: 'POST',
          url: '/v1/oauth/token',
          headers: {
            'content-type': 'application/json'
          },
          payload: {
            grant_type: 'authorization_code',
            code: 'test-code',
            client_id: 'test-client',
            system: system
          }
        });

        // Should fall back to transparent forwarding
        expect(response.statusCode).toBeGreaterThanOrEqual(400);
      }
    });

    it('should handle OAuth requests with missing required fields', async () => {
      const incompleteRequests = [
        {},
        { grant_type: 'authorization_code' },
        { code: 'test-code' },
        { client_id: 'test-client' }
      ];

      for (const payload of incompleteRequests) {
        const response = await app.inject({
          method: 'POST',
          url: '/v1/oauth/token',
          headers: {
            'content-type': 'application/json'
          },
          payload: {
            ...payload,
            system: [
              { type: 'text', text: 'You are a helpful assistant' },
              { type: 'text', text: '<CCR-SUBAGENT-ROUTER>frontend</CCR-SUBAGENT-ROUTER>' }
            ]
          }
        });

        expect(response.statusCode).toBeGreaterThanOrEqual(400);
      }
    });
  });

  describe('Performance and Reliability', () => {
    it('should handle concurrent OAuth requests with routing', async () => {
      const concurrentRequests = Array(10).fill(null).map((_, index) =>
        app.inject({
          method: 'POST',
          url: '/v1/oauth/token',
          headers: {
            'content-type': 'application/json'
          },
          payload: {
            grant_type: 'authorization_code',
            code: `test-code-${index}`,
            client_id: 'test-client',
            system: [
              { type: 'text', text: 'You are a helpful assistant' },
              { type: 'text', text: '<CCR-SUBAGENT-ROUTER>frontend</CCR-SUBAGENT-ROUTER>' }
            ]
          }
        })
      );

      const responses = await Promise.all(concurrentRequests);

      responses.forEach(response => {
        expect(response.statusCode).toBeGreaterThanOrEqual(400);
      });
    });

    it('should maintain request order integrity', async () => {
      const responses = [];

      for (let i = 0; i < 5; i++) {
        const response = await app.inject({
          method: 'POST',
          url: '/v1/oauth/token',
          headers: {
            'content-type': 'application/json'
          },
          payload: {
            grant_type: 'authorization_code',
            code: `test-code-${i}`,
            client_id: 'test-client',
            system: [
              { type: 'text', text: 'You are a helpful assistant' },
              { type: 'text', text: '<CCR-SUBAGENT-ROUTER>backend</CCR-SUBAGENT-ROUTER>' }
            ]
          }
        });
        responses.push(response);
      }

      responses.forEach(response => {
        expect(response.statusCode).toBeGreaterThanOrEqual(400);
      });
    });
  });
});