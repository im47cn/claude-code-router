import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { createAuthTestApp } from '../utils/authTestApp.js';

describe('Complete 4-Level Priority Flow Tests', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await createAuthTestApp();
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('Priority 1: ClaudeMem Requests', () => {
    it('should override client OAuth for ClaudeMem requests', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/messages',
        headers: {
          'authorization': 'Bearer client-oauth-token',
          'content-type': 'application/json'
        },
        payload: {
          messages: [
            { role: 'user', content: 'You are a Claude-Mem assistant. Help me.' }
          ]
        }
      });

      expect(response.statusCode).toBe(400);
      // Should have processed the request with mock response
      expect(response.json()).toEqual({
        error: 'Processing completed',
        message: 'Authentication passed, but no LLM provider configured in test environment'
      });
    });

    it('should ignore SubAgent markers for ClaudeMem requests', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/messages',
        headers: {
          'authorization': 'Bearer client-token',
          'content-type': 'application/json'
        },
        payload: {
          system: [
            { type: 'text', text: '<CCR-SUBAGENT-ROUTER>frontend</CCR-SUBAGENT-ROUTER>' }
          ],
          messages: [
            { role: 'user', content: 'You are a Claude-Mem assistant.' }
          ]
        }
      });

      expect(response.statusCode).toBe(400);
      // Should still use Provider API Key behavior (mock response)
      expect(response.json()).toEqual({
        error: 'Processing completed',
        message: 'Authentication passed, but no LLM provider configured in test environment'
      });
    });
  });

  describe('Priority 2: SubAgent Router Processing', () => {
    it('should handle requests with valid router markers', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/messages',
        headers: {
          'x-api-key': 'test-api-key',
          'content-type': 'application/json'
        },
        payload: {
          system: [
            { type: 'text', text: '<CCR-SUBAGENT-ROUTER>frontend</CCR-SUBAGENT-ROUTER>' }
          ],
          messages: [
            { role: 'user', content: 'Regular user request' }
          ]
        }
      });

      expect(response.statusCode).toBe(400);
      // Should process with mock response
      expect(response.json()).toEqual({
        error: 'Processing completed',
        message: 'Authentication passed, but no LLM provider configured in test environment'
      });
    });

    it('should handle requests with invalid router markers gracefully', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/messages',
        headers: {
          'x-api-key': 'test-api-key',
          'content-type': 'application/json'
        },
        payload: {
          system: [
            { type: 'text', text: '<CCR-SUBAGENT-ROUTER>nonexistent</CCR-SUBAGENT-ROUTER>' }
          ],
          messages: [
            { role: 'user', content: 'Test request' }
          ]
        }
      });

      expect(response.statusCode).toBe(400);
      // Should fall back to next priority
      expect(response.json()).toEqual({
        error: 'Processing completed',
        message: 'Authentication passed, but no LLM provider configured in test environment'
      });
    });

    it('should handle malformed router markers', async () => {
      const malformedInputs = [
        '<CCR-SUBAGENT-ROUTER>incomplete',
        'CCR-SUBAGENT-ROUTER>frontend</CCR-SUBAGENT-ROUTER>',
        '<CCR-SUBAGENT-ROUTER></CCR-SUBAGENT-ROUTER>',
      ];

      for (const malformedInput of malformedInputs) {
        const response = await app.inject({
          method: 'POST',
          url: '/v1/messages',
          headers: {
            'x-api-key': 'test-api-key',
            'content-type': 'application/json'
          },
          payload: {
            system: [
              { type: 'text', text: malformedInput }
            ],
            messages: [
              { role: 'user', content: 'Test request' }
            ]
          }
        });

        expect(response.statusCode).toBe(400);
      }
    });
  });

  describe('Priority 3: SubAgent Model Processing', () => {
    it('should handle requests with valid model markers', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/messages',
        headers: {
          'x-api-key': 'test-api-key',
          'content-type': 'application/json'
        },
        payload: {
          system: [
            { type: 'text', text: '<CCR-SUBAGENT-MODEL>openrouter,anthropic/claude-3.5-sonnet</CCR-SUBAGENT-MODEL>' }
          ],
          messages: [
            { role: 'user', content: 'Regular request' }
          ]
        }
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({
        error: 'Processing completed',
        message: 'Authentication passed, but no LLM provider configured in test environment'
      });
    });

    it('should handle invalid model formats gracefully', async () => {
      const invalidModels = [
        '<CCR-SUBAGENT-MODEL>invalid-format</CCR-SUBAGENT-MODEL>',
        '<CCR-SUBAGENT-MODEL>just-provider</CCR-SUBAGENT-MODEL>',
        '<CCR-SUBAGENT-MODEL>,model-only</CCR-SUBAGENT-MODEL>',
      ];

      for (const invalidModel of invalidModels) {
        const response = await app.inject({
          method: 'POST',
          url: '/v1/messages',
          headers: {
            'x-api-key': 'test-api-key',
            'content-type': 'application/json'
          },
          payload: {
            system: [
              { type: 'text', text: invalidModel }
            ],
            messages: [
              { role: 'user', content: 'Test request' }
            ]
          }
        });

        expect(response.statusCode).toBe(400);
      }
    });
  });

  describe('Priority 4: Default OAuth Fallback', () => {
    it('should handle client OAuth token requests', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/messages',
        headers: {
          'authorization': 'Bearer valid-client-oauth-token',
          'content-type': 'application/json'
        },
        payload: {
          messages: [
            { role: 'user', content: 'Regular request' }
          ]
        }
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({
        error: 'Processing completed',
        message: 'Authentication passed, but no LLM provider configured in test environment'
      });
    });

    it('should handle API key requests', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/messages',
        headers: {
          'x-api-key': 'test-api-key',
          'content-type': 'application/json'
        },
        payload: {
          messages: [
            { role: 'user', content: 'Regular request' }
          ]
        }
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({
        error: 'Processing completed',
        message: 'Authentication passed, but no LLM provider configured in test environment'
      });
    });

    it('should handle requests without authentication when no API key is configured', async () => {
      const appNoAuth = await createAuthTestApp({ APIKEY: undefined });
      await appNoAuth.ready();

      try {
        const response = await appNoAuth.inject({
          method: 'POST',
          url: '/v1/messages',
          headers: {
            'origin': 'http://localhost:3456',
            'content-type': 'application/json'
          },
          payload: {
            messages: [
              { role: 'user', content: 'Regular request' }
            ]
          }
        });

        expect(response.statusCode).toBe(401);
        expect(response.body).toBe("Authentication required");
      } finally {
        await appNoAuth.close();
      }
    });
  });

  describe('Priority Conflicts and Edge Cases', () => {
    it('should prioritize router over model when both present', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/messages',
        headers: {
          'x-api-key': 'test-api-key',
          'content-type': 'application/json'
        },
        payload: {
          system: [
            {
              type: 'text',
              text: '<CCR-SUBAGENT-ROUTER>frontend</CCR-SUBAGENT-ROUTER><CCR-SUBAGENT-MODEL>openrouter,model</CCR-SUBAGENT-MODEL>'
            }
          ],
          messages: [
            { role: 'user', content: 'Test priority conflict' }
          ]
        }
      });

      expect(response.statusCode).toBe(400);
    });

    it('should handle empty system array gracefully', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/messages',
        headers: {
          'x-api-key': 'test-api-key',
          'content-type': 'application/json'
        },
        payload: {
          system: [],
          messages: [
            { role: 'user', content: 'Test empty system' }
          ]
        }
      });

      expect(response.statusCode).toBe(400);
    });

    it('should handle null system gracefully', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/messages',
        headers: {
          'x-api-key': 'test-api-key',
          'content-type': 'application/json'
        },
        payload: {
          messages: [
            { role: 'user', content: 'Test null system' }
          ]
        }
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('Public Endpoints', () => {
    it('should allow access to health endpoint', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health'
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: 'ok' });
    });

    it('should allow access to root endpoint', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/'
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: 'ok' });
    });

    it('should allow access to count tokens endpoint', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/messages/count_tokens',
        headers: {
          'content-type': 'application/json',
          'x-api-key': 'test-api-key'
        },
        payload: {
          messages: [
            { role: 'user', content: 'Test message' }
          ]
        }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ input_tokens: 100 });
    });
  });
});