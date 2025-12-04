import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import fastify from 'fastify';

// Create a test app that includes both auth and router middleware
async function createOAuthRouterTestApp(testConfig: any = {}) {
  const config = {
    PORT: 0,
    HOST: "127.0.0.1",
    APIKEY: "test-api-key",
    Router: {
      default: "openrouter,anthropic/claude-3.5-sonnet",
      frontend: "openrouter,google/gemini-3-pro-preview",
      backend: "deepseek,deepseek-chat"
    },
    Providers: [
      {
        name: "openrouter",
        models: ["google/gemini-3-pro-preview", "anthropic/claude-3.5-sonnet"]
      }
    ],
    ...testConfig
  };

  const app = fastify({
    logger: false
  });

  // Import the actual auth and router middleware
  const { apiKeyAuth } = await import('../../middleware/auth.js');
  const { router } = await import('../../utils/router.js');

  // Apply authentication middleware
  app.addHook('preHandler', apiKeyAuth(config));

  // Apply router middleware after auth
  app.addHook('preHandler', async (request: any, reply: any) => {
    await router(request, reply, { config, event: {} });
  });

  // Mock LLM provider endpoint to capture routing decisions
  app.post('/v1/messages', async (request: any, reply: any) => {
    // Return the model that was selected by the router for verification
    return reply.code(400).send({
      error: 'Test endpoint - routing captured',
      model: request.body.model,
      isOAuthRequest: request.isOAuthRequest,
      oauthRequestType: request.oauthRequestType,
      system: request.body.system
    });
  });

  // OAuth token endpoint for testing OAuth detection
  app.post('/v1/oauth/token', async (request: any, reply: any) => {
    return reply.code(400).send({
      error: 'OAuth endpoint - routing captured',
      model: request.body.model,
      isOAuthRequest: request.isOAuthRequest,
      oauthRequestType: request.oauthRequestType,
      system: request.body.system
    });
  });

  app.get('/health', async (request: any, reply: any) => {
    return { status: 'ok' };
  });

  return app;
}

describe('OAuth Router Middleware Integration Tests', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await createOAuthRouterTestApp();
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('OAuth Request Flow Through Middleware Chain', () => {
    it('should process OAuth requests with router markers through complete middleware chain', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/oauth/token',
        headers: {
          'content-type': 'application/json'
        },
        payload: {
          grant_type: 'authorization_code',
          code: 'test-code',
          system: [
            { type: 'text', text: 'You are a helpful assistant' },
            { type: 'text', text: '<CCR-SUBAGENT-ROUTER>frontend</CCR-SUBAGENT-ROUTER>' }
          ]
        }
      });

      expect(response.statusCode).toBe(400);

      const responseBody = response.json();

      // Verify OAuth request was properly detected and marked
      expect(responseBody.isOAuthRequest).toBe(true);
      expect(responseBody.oauthRequestType).toBeDefined();

      // Verify router middleware processed the request and applied frontend routing
      expect(responseBody.model).toBe('openrouter,google/gemini-3-pro-preview');

      // Verify router marker was cleaned from system message
      if (Array.isArray(responseBody.system)) {
        const systemText = responseBody.system.map((item: any) => item.text).join('');
        expect(systemText).not.toContain('<CCR-SUBAGENT-ROUTER>frontend</CCR-SUBAGENT-ROUTER>');
      }
    });

    it('should handle OAuth requests without router markers with transparent forwarding', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/oauth/token',
        headers: {
          'content-type': 'application/json'
        },
        payload: {
          grant_type: 'authorization_code',
          code: 'test-code',
          system: [
            { type: 'text', text: 'You are a helpful assistant' }
          ]
        }
      });

      expect(response.statusCode).toBe(400);

      const responseBody = response.json();

      // Verify OAuth request was detected
      expect(responseBody.isOAuthRequest).toBe(true);

      // Verify no model routing was applied (transparent forwarding)
      expect(responseBody.model).toBeUndefined();
    });

    it('should handle OAuth requests with invalid router markers gracefully', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/oauth/token',
        headers: {
          'content-type': 'application/json'
        },
        payload: {
          grant_type: 'authorization_code',
          code: 'test-code',
          system: [
            { type: 'text', text: 'You are a helpful assistant' },
            { type: 'text', text: '<CCR-SUBAGENT-ROUTER>invalid-router</CCR-SUBAGENT-ROUTER>' }
          ]
        }
      });

      expect(response.statusCode).toBe(400);

      const responseBody = response.json();

      // Verify OAuth request was detected
      expect(responseBody.isOAuthRequest).toBe(true);

      // For OAuth requests with invalid router, should continue to normal routing and get default model
      // The invalid router marker should be cleaned and default routing applied
      expect(responseBody.model).toBeDefined();
      expect(responseBody.model).toBe('openrouter,anthropic/claude-3.5-sonnet');
    });
  });

  describe('OAuth Routing Priority Handling', () => {
    it('should give CCR-SUBAGENT-ROUTER priority over CCR-SUBAGENT-MODEL for OAuth requests', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/oauth/token',
        headers: {
          'content-type': 'application/json'
        },
        payload: {
          grant_type: 'authorization_code',
          code: 'test-code',
          system: [
            { type: 'text', text: 'You are a helpful assistant' },
            {
              type: 'text',
              text: '<CCR-SUBAGENT-ROUTER>frontend</CCR-SUBAGENT-ROUTER><CCR-SUBAGENT-MODEL>openrouter,invalid-model</CCR-SUBAGENT-MODEL>'
            }
          ]
        }
      });

      expect(response.statusCode).toBe(400);

      const responseBody = response.json();

      // Should use router configuration, not the SUBAGENT-MODEL specification
      expect(responseBody.model).toBe('openrouter,google/gemini-3-pro-preview');

      // Verify both markers were cleaned
      if (Array.isArray(responseBody.system)) {
        const systemText = responseBody.system.map((item: any) => item.text).join('');
        expect(systemText).not.toContain('<CCR-SUBAGENT-ROUTER>');
        expect(systemText).not.toContain('<CCR-SUBAGENT-MODEL>');
      }
    });

    it('should handle OAuth requests to messages endpoint with router markers', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/messages',
        headers: {
          'content-type': 'application/json',
          'x-api-key': 'test-api-key'
        },
        payload: {
          messages: [{ role: 'user', content: 'Hello' }],
          system: [
            { type: 'text', text: 'You are a helpful assistant' },
            { type: 'text', text: '<CCR-SUBAGENT-ROUTER>backend</CCR-SUBAGENT-ROUTER>' }
          ]
        }
      });

      expect(response.statusCode).toBe(400);

      const responseBody = response.json();

      // Non-OAuth requests should not be marked as OAuth
      expect(responseBody.isOAuthRequest).toBeUndefined();

      // But router markers should still be processed for non-OAuth requests
      expect(responseBody.model).toBe('deepseek,deepseek-chat');
    });
  });

  describe('OAuth Router Configuration Validation', () => {
    it('should validate router configuration exists before applying routing', async () => {
      const appWithoutRouterConfig = await createOAuthRouterTestApp({
        Router: undefined
      });
      await appWithoutRouterConfig.ready();

      const response = await appWithoutRouterConfig.inject({
        method: 'POST',
        url: '/v1/oauth/token',
        headers: {
          'content-type': 'application/json'
        },
        payload: {
          grant_type: 'authorization_code',
          code: 'test-code',
          system: [
            { type: 'text', text: 'You are a helpful assistant' },
            { type: 'text', text: '<CCR-SUBAGENT-ROUTER>frontend</CCR-SUBAGENT-ROUTER>' }
          ]
        }
      });

      expect(response.statusCode).toBe(400);

      const responseBody = response.json();
      expect(responseBody.isOAuthRequest).toBe(true);
      // When Router config is missing, should apply default fallback routing
      expect(responseBody.model).toBe('openrouter,anthropic/claude-3.5-sonnet');

      await appWithoutRouterConfig.close();
    });
  });

  describe('Router Marker Position Boundary Tests', () => {
    it('should ignore router marker in system[0] - only system[1] is checked', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/messages',
        headers: {
          'content-type': 'application/json',
          'x-api-key': 'test-api-key'
        },
        payload: {
          messages: [{ role: 'user', content: 'Hello' }],
          system: [
            { type: 'text', text: '<CCR-SUBAGENT-ROUTER>frontend</CCR-SUBAGENT-ROUTER>' },
            { type: 'text', text: 'You are a helpful assistant' }
          ]
        }
      });

      expect(response.statusCode).toBe(400);
      const responseBody = response.json();

      // Marker in system[0] should NOT be detected - router should use default
      // The marker should remain in system[0] (not cleaned)
      expect(responseBody.model).toBe('openrouter,anthropic/claude-3.5-sonnet');
      expect(responseBody.system[0].text).toContain('<CCR-SUBAGENT-ROUTER>frontend</CCR-SUBAGENT-ROUTER>');
    });

    it('should detect router marker only when in system[1]', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/messages',
        headers: {
          'content-type': 'application/json',
          'x-api-key': 'test-api-key'
        },
        payload: {
          messages: [{ role: 'user', content: 'Hello' }],
          system: [
            { type: 'text', text: 'You are a helpful assistant' },
            { type: 'text', text: '<CCR-SUBAGENT-ROUTER>frontend</CCR-SUBAGENT-ROUTER>' }
          ]
        }
      });

      expect(response.statusCode).toBe(400);
      const responseBody = response.json();

      // Marker in system[1] SHOULD be detected and applied
      expect(responseBody.model).toBe('openrouter,google/gemini-3-pro-preview');
      // Marker should be cleaned from system[1]
      expect(responseBody.system[1].text).not.toContain('<CCR-SUBAGENT-ROUTER>');
    });

    it('should not detect marker when system has only one element', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/messages',
        headers: {
          'content-type': 'application/json',
          'x-api-key': 'test-api-key'
        },
        payload: {
          messages: [{ role: 'user', content: 'Hello' }],
          system: [
            { type: 'text', text: '<CCR-SUBAGENT-ROUTER>frontend</CCR-SUBAGENT-ROUTER>' }
          ]
        }
      });

      expect(response.statusCode).toBe(400);
      const responseBody = response.json();

      // Single element system should NOT have marker detected
      expect(responseBody.model).toBe('openrouter,anthropic/claude-3.5-sonnet');
    });
  });

  describe('Special Character Router Names', () => {
    it('should handle router names with hyphens', async () => {
      const appWithHyphenRouter = await createOAuthRouterTestApp({
        Router: {
          default: 'openrouter,anthropic/claude-3.5-sonnet',
          'frontend-v2': 'openrouter,google/gemini-3-pro-preview'
        }
      });
      await appWithHyphenRouter.ready();

      const response = await appWithHyphenRouter.inject({
        method: 'POST',
        url: '/v1/messages',
        headers: {
          'content-type': 'application/json',
          'x-api-key': 'test-api-key'
        },
        payload: {
          messages: [{ role: 'user', content: 'Hello' }],
          system: [
            { type: 'text', text: 'You are a helpful assistant' },
            { type: 'text', text: '<CCR-SUBAGENT-ROUTER>frontend-v2</CCR-SUBAGENT-ROUTER>' }
          ]
        }
      });

      expect(response.statusCode).toBe(400);
      const responseBody = response.json();
      expect(responseBody.model).toBe('openrouter,google/gemini-3-pro-preview');

      await appWithHyphenRouter.close();
    });

    it('should handle router names with underscores', async () => {
      const appWithUnderscoreRouter = await createOAuthRouterTestApp({
        Router: {
          default: 'openrouter,anthropic/claude-3.5-sonnet',
          'my_router': 'deepseek,deepseek-chat'
        }
      });
      await appWithUnderscoreRouter.ready();

      const response = await appWithUnderscoreRouter.inject({
        method: 'POST',
        url: '/v1/messages',
        headers: {
          'content-type': 'application/json',
          'x-api-key': 'test-api-key'
        },
        payload: {
          messages: [{ role: 'user', content: 'Hello' }],
          system: [
            { type: 'text', text: 'You are a helpful assistant' },
            { type: 'text', text: '<CCR-SUBAGENT-ROUTER>my_router</CCR-SUBAGENT-ROUTER>' }
          ]
        }
      });

      expect(response.statusCode).toBe(400);
      const responseBody = response.json();
      expect(responseBody.model).toBe('deepseek,deepseek-chat');

      await appWithUnderscoreRouter.close();
    });

    it('should handle router names with dots', async () => {
      const appWithDotRouter = await createOAuthRouterTestApp({
        Router: {
          default: 'openrouter,anthropic/claude-3.5-sonnet',
          'router.test': 'openrouter,google/gemini-3-pro-preview'
        }
      });
      await appWithDotRouter.ready();

      const response = await appWithDotRouter.inject({
        method: 'POST',
        url: '/v1/messages',
        headers: {
          'content-type': 'application/json',
          'x-api-key': 'test-api-key'
        },
        payload: {
          messages: [{ role: 'user', content: 'Hello' }],
          system: [
            { type: 'text', text: 'You are a helpful assistant' },
            { type: 'text', text: '<CCR-SUBAGENT-ROUTER>router.test</CCR-SUBAGENT-ROUTER>' }
          ]
        }
      });

      expect(response.statusCode).toBe(400);
      const responseBody = response.json();
      expect(responseBody.model).toBe('openrouter,google/gemini-3-pro-preview');

      await appWithDotRouter.close();
    });

    it('should handle router names with numbers', async () => {
      const appWithNumberRouter = await createOAuthRouterTestApp({
        Router: {
          default: 'openrouter,anthropic/claude-3.5-sonnet',
          'router123': 'deepseek,deepseek-chat'
        }
      });
      await appWithNumberRouter.ready();

      const response = await appWithNumberRouter.inject({
        method: 'POST',
        url: '/v1/messages',
        headers: {
          'content-type': 'application/json',
          'x-api-key': 'test-api-key'
        },
        payload: {
          messages: [{ role: 'user', content: 'Hello' }],
          system: [
            { type: 'text', text: 'You are a helpful assistant' },
            { type: 'text', text: '<CCR-SUBAGENT-ROUTER>router123</CCR-SUBAGENT-ROUTER>' }
          ]
        }
      });

      expect(response.statusCode).toBe(400);
      const responseBody = response.json();
      expect(responseBody.model).toBe('deepseek,deepseek-chat');

      await appWithNumberRouter.close();
    });
  });

  describe('Multiline Router Marker Content Tests', () => {
    it('should handle router name with leading/trailing whitespace', async () => {
      // The /s modifier allows . to match newlines, testing whitespace handling
      const response = await app.inject({
        method: 'POST',
        url: '/v1/messages',
        headers: {
          'content-type': 'application/json',
          'x-api-key': 'test-api-key'
        },
        payload: {
          messages: [{ role: 'user', content: 'Hello' }],
          system: [
            { type: 'text', text: 'You are a helpful assistant' },
            { type: 'text', text: '<CCR-SUBAGENT-ROUTER>  frontend  </CCR-SUBAGENT-ROUTER>' }
          ]
        }
      });

      expect(response.statusCode).toBe(400);
      const responseBody = response.json();
      // With whitespace, the extracted name is "  frontend  " which won't match "frontend"
      // Should fall back to default routing
      expect(responseBody.model).toBe('openrouter,anthropic/claude-3.5-sonnet');
    });

    it('should handle router name with newline characters (multiline /s modifier)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/messages',
        headers: {
          'content-type': 'application/json',
          'x-api-key': 'test-api-key'
        },
        payload: {
          messages: [{ role: 'user', content: 'Hello' }],
          system: [
            { type: 'text', text: 'You are a helpful assistant' },
            { type: 'text', text: '<CCR-SUBAGENT-ROUTER>\nfrontend\n</CCR-SUBAGENT-ROUTER>' }
          ]
        }
      });

      expect(response.statusCode).toBe(400);
      const responseBody = response.json();
      // With newlines, the extracted name includes newlines and won't match
      // Should fall back to default routing since "\nfrontend\n" != "frontend"
      expect(responseBody.model).toBe('openrouter,anthropic/claude-3.5-sonnet');
    });

    it('should correctly match router name without extra whitespace or newlines', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/messages',
        headers: {
          'content-type': 'application/json',
          'x-api-key': 'test-api-key'
        },
        payload: {
          messages: [{ role: 'user', content: 'Hello' }],
          system: [
            { type: 'text', text: 'You are a helpful assistant' },
            { type: 'text', text: '<CCR-SUBAGENT-ROUTER>frontend</CCR-SUBAGENT-ROUTER>' }
          ]
        }
      });

      expect(response.statusCode).toBe(400);
      const responseBody = response.json();
      // Clean router name should match
      expect(responseBody.model).toBe('openrouter,google/gemini-3-pro-preview');
    });

    it('should handle multiline text around the router marker', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/messages',
        headers: {
          'content-type': 'application/json',
          'x-api-key': 'test-api-key'
        },
        payload: {
          messages: [{ role: 'user', content: 'Hello' }],
          system: [
            { type: 'text', text: 'You are a helpful assistant' },
            { type: 'text', text: 'Some context\n<CCR-SUBAGENT-ROUTER>backend</CCR-SUBAGENT-ROUTER>\nMore context' }
          ]
        }
      });

      expect(response.statusCode).toBe(400);
      const responseBody = response.json();
      // Should correctly extract "backend" even with surrounding multiline text
      expect(responseBody.model).toBe('deepseek,deepseek-chat');
      // Marker should be cleaned but surrounding text preserved
      expect(responseBody.system[1].text).toBe('Some context\n\nMore context');
    });
  });
});
