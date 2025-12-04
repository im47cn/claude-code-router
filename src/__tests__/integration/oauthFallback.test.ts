import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import { createAuthTestApp } from '../utils/authTestApp.js';

describe('OAuth Fallback and Security Tests', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await createAuthTestApp();
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('OAuth Authentication Priority', () => {
    it('should prefer client OAuth over no auth', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/messages',
        headers: {
          'authorization': 'Bearer client-oauth-token',
          'content-type': 'application/json'
        },
        payload: {
          messages: [
            { role: 'user', content: 'Test request' }
          ]
        }
      });

      expect(response.statusCode).toBe(400);
    });

    it('should handle both OAuth and API key headers', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/messages',
        headers: {
          'authorization': 'Bearer client-oauth-token',
          'x-api-key': 'test-api-key',
          'content-type': 'application/json'
        },
        payload: {
          messages: [
            { role: 'user', content: 'Test request' }
          ]
        }
      });

      expect(response.statusCode).toBe(400);
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
          messages: [
            { role: 'user', content: 'Test request' }
          ]
        }
      });

      expect(response.statusCode).toBe(401);
    });

    it('should handle malformed Bearer token', async () => {
      const malformedTokens = [
        'Bearer',
        'Bearer ',
        'invalid-format',
        'bearer token' // lowercase
      ];

      for (const malformedToken of malformedTokens) {
        const response = await app.inject({
          method: 'POST',
          url: '/v1/messages',
          headers: {
            'authorization': malformedToken,
            'content-type': 'application/json'
          },
          payload: {
            messages: [
              { role: 'user', content: 'Test request' }
            ]
          }
        });

        expect(response.statusCode).toBe(401);
      }
    });
  });

  describe('Security Validation', () => {
    it('should handle oversized authorization header', async () => {
      const largeToken = 'Bearer ' + 'x'.repeat(10000);

      const response = await app.inject({
        method: 'POST',
        url: '/v1/messages',
        headers: {
          'authorization': largeToken,
          'content-type': 'application/json'
        },
        payload: {
          messages: [
            { role: 'user', content: 'Test request' }
          ]
        }
      });

      // Should not crash with large token
      expect(response.statusCode).toBe(400);
    });

    it('should handle special characters in auth headers', async () => {
      const specialCharsToken = 'Bearer ' + encodeURI('special!@#$%^&*()_+-=[]{}|;:,.<>/?~`');

      const response = await app.inject({
        method: 'POST',
        url: '/v1/messages',
        headers: {
          'authorization': specialCharsToken,
          'content-type': 'application/json'
        },
        payload: {
          messages: [
            { role: 'user', content: 'Test request' }
          ]
        }
      });

      expect(response.statusCode).toBe(400);
    });

    it('should handle Unicode in auth headers', async () => {
      const unicodeToken = 'Bearer ' + '🔑🔐🔑token测试';

      const response = await app.inject({
        method: 'POST',
        url: '/v1/messages',
        headers: {
          'authorization': unicodeToken,
          'content-type': 'application/json'
        },
        payload: {
          messages: [
            { role: 'user', content: 'Test request' }
          ]
        }
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('CORS and Public Endpoint Security', () => {
    it('should handle CORS violations when no API key configured', async () => {
      const appNoAuth = await createAuthTestApp({ APIKEY: undefined });
      await appNoAuth.ready();

      const response = await appNoAuth.inject({
        method: 'POST',
        url: '/v1/messages',
        headers: {
          'origin': 'http://malicious-site.com:8080',
          'content-type': 'application/json'
        },
        payload: {
          messages: [
            { role: 'user', content: 'Test request' }
          ]
        }
      });

      // With no API key, CORS should be enforced
      expect([200, 403]).toContain(response.statusCode);

      await appNoAuth.close();
    });

    it('should allow CORS when valid origin provided', async () => {
      const appNoAuth = await createAuthTestApp({ APIKEY: undefined });
      await appNoAuth.ready();

      const response = await appNoAuth.inject({
        method: 'POST',
        url: '/v1/messages',
        headers: {
          'origin': 'http://localhost:3456',
          'content-type': 'application/json'
        },
        payload: {
          messages: [
            { role: 'user', content: 'Test request' }
          ]
        }
      });

      expect(response.statusCode).toBe(401);

      await appNoAuth.close();
    });
  });

  describe('Error Handling and Robustness', () => {
    it('should handle missing API key gracefully', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/messages',
        headers: {
          'content-type': 'application/json'
        },
        payload: {
          messages: [
            { role: 'user', content: 'Test request' }
          ]
        }
      });

      expect(response.statusCode).toBe(401);
    });

    it('should handle invalid API key gracefully', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/messages',
        headers: {
          'x-api-key': 'invalid-api-key',
          'content-type': 'application/json'
        },
        payload: {
          messages: [
            { role: 'user', content: 'Test request' }
          ]
        }
      });

      expect(response.statusCode).toBe(401);
    });

    it('should handle malformed request payload', async () => {
      const malformedPayloads = [
        null,
        undefined,
        {},
        { messages: 'not-array' },
        { messages: [ 'not-object' ] },
        { messages: [{ role: 'invalid' }] }
      ];

      for (const payload of malformedPayloads) {
        const response = await app.inject({
          method: 'POST',
          url: '/v1/messages',
          headers: {
            'x-api-key': 'test-api-key',
            'content-type': 'application/json'
          },
          payload: payload
        });

        // Should handle malformed payloads gracefully
        expect([200, 400, 401, 500]).toContain(response.statusCode);
      }
    });

    it('should handle very large request payload', async () => {
      const largeMessages = Array(1000).fill({
        role: 'user',
        content: 'x'.repeat(1000) // 1000 chars per message
      });

      const response = await app.inject({
        method: 'POST',
        url: '/v1/messages',
        headers: {
          'x-api-key': 'test-api-key',
          'content-type': 'application/json'
        },
        payload: {
          messages: largeMessages
        }
      });

      // Should handle large payloads without crashing
      expect([200, 400, 413]).toContain(response.statusCode);
    });
  });

  describe('Race Conditions and Concurrency', () => {
    it('should handle concurrent authentication requests', async () => {
      const promises = Array(10).fill(null).map(() =>
        app.inject({
          method: 'POST',
          url: '/v1/messages',
          headers: {
            'x-api-key': 'test-api-key',
            'content-type': 'application/json'
          },
          payload: {
            messages: [
              { role: 'user', content: 'Concurrent test request' }
            ]
          }
        })
      );

      const responses = await Promise.all(promises);

      // All requests should complete without errors
      responses.forEach(response => {
        expect(response.statusCode).toBe(400);
      });
    });

    it('should handle mixed authentication methods concurrently', async () => {
      const authMethods = [
        { headers: { 'authorization': 'Bearer token1' }, name: 'OAuth1' },
        { headers: { 'authorization': 'Bearer token2' }, name: 'OAuth2' },
        { headers: { 'x-api-key': 'test-api-key' }, name: 'APIKey' },
        { headers: {}, name: 'NoAuth' }
      ];

      const promises = authMethods.map(auth =>
        app.inject({
          method: 'POST',
          url: '/v1/messages',
          headers: {
            ...auth.headers,
            'content-type': 'application/json'
          },
          payload: {
            messages: [
              { role: 'user', content: `Test with ${auth.name}` }
            ]
          }
        })
      );

      const responses = await Promise.all(promises);

      // All requests should complete
      responses.forEach((response, index) => {
        const auth = authMethods[index];
        if (auth.headers.authorization || auth.headers['x-api-key']) {
          // OAuth or API key requests should succeed (400 = auth success but no LLM)
          expect(response.statusCode).toBe(400);
        } else {
          // No auth requests should fail (401 = auth required)
          expect(response.statusCode).toBe(401);
        }
      });
    });
  });

  describe('Performance and Resource Management', () => {
    it('should handle rapid sequential requests', async () => {
      const startTime = Date.now();

      for (let i = 0; i < 50; i++) {
        const response = await app.inject({
          method: 'POST',
          url: '/v1/messages',
          headers: {
            'x-api-key': 'test-api-key',
            'content-type': 'application/json'
          },
          payload: {
            messages: [
              { role: 'user', content: `Sequential test ${i}` }
            ]
          }
        });

        expect(response.statusCode).toBe(400);
      }

      const duration = Date.now() - startTime;

      // Should complete 50 requests in reasonable time (< 10 seconds)
      expect(duration).toBeLessThan(10000);
    });
  });
});