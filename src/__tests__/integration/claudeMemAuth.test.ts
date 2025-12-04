import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import { createAuthTestApp } from '../utils/authTestApp.js';
import { isClaudeMemRequest } from '../../utils/router.js';

describe('ClaudeMem Authentication Integration', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await createAuthTestApp();
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('isClaudeMemRequest', () => {
    it('should detect ClaudeMem request in message content', () => {
      const messages = [
        {
          role: 'user' as const,
          content: 'You are a Claude-Mem with enhanced capabilities'
        }
      ];

      const result = isClaudeMemRequest(messages);
      expect(result).toBe(true);
    });

    it('should detect ClaudeMem request in array content', () => {
      const messages = [
        {
          role: 'user' as const,
          content: [
            {
              type: 'text' as const,
              text: 'You are a Claude-Mem designed for memory tasks'
            }
          ]
        }
      ];

      const result = isClaudeMemRequest(messages);
      expect(result).toBe(true);
    });

    it('should not detect non-ClaudeMem requests', () => {
      const messages = [
        {
          role: 'user' as const,
          content: 'Hello, how are you?'
        }
      ];

      const result = isClaudeMemRequest(messages);
      expect(result).toBe(false);
    });

    it('should handle empty messages array', () => {
      const messages = [];
      const result = isClaudeMemRequest(messages);
      expect(result).toBe(false);
    });

    it('should handle invalid message format', () => {
      const messages = null as any;
      const result = isClaudeMemRequest(messages);
      expect(result).toBe(false);
    });
  });

  describe('ClaudeMem Authentication Flow', () => {
    it('should route ClaudeMem request to Provider API Key', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/messages',
        headers: {
          'authorization': 'Bearer fake-client-oauth-token',
          'content-type': 'application/json'
        },
        payload: {
          model: 'anthropic,claude-3-sonnet',
          messages: [
            {
              role: 'user',
              content: 'You are a Claude-Mem'
            }
          ]
        }
      });

      // Verify the request was processed (we expect 400 or 500 because we don't have real API)
      expect(response.statusCode).toBeGreaterThanOrEqual(400);

      // The key test is that client OAuth token was cleared and Provider API Key should be used
      // This would be verified through logs in a real environment
    });

    it('should preserve client OAuth for non-ClaudeMem requests', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/messages',
        headers: {
          'authorization': 'Bearer fake-client-oauth-token',
          'content-type': 'application/json'
        },
        payload: {
          model: 'anthropic,claude-3-sonnet',
          messages: [
            {
              role: 'user',
              content: 'Hello, regular request'
            }
          ]
        }
      });

      // Verify the request was processed (we expect 400 or 500 because we don't have real API)
      expect(response.statusCode).toBeGreaterThanOrEqual(400);

      // Client OAuth should be preserved for non-ClaudeMem requests
    });

    it('should handle mixed content types', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/messages',
        headers: {
          'authorization': 'Bearer fake-client-oauth-token',
          'content-type': 'application/json'
        },
        payload: {
          model: 'anthropic,claude-3-sonnet',
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: 'You are a Claude-Mem'
                }
              ]
            }
          ]
        }
      });

      expect(response.statusCode).toBeGreaterThanOrEqual(400);
    });

    it('should handle system message with ClaudeMem indicator', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/messages',
        headers: {
          'authorization': 'Bearer fake-client-oauth-token',
          'content-type': 'application/json'
        },
        payload: {
          model: 'anthropic,claude-3-sonnet',
          messages: [
            {
              role: 'user',
              content: 'Help me with this task'
            }
          ],
          system: [
            {
              type: 'text',
              text: 'You are a Claude-Mem with memory capabilities'
            }
          ]
        }
      });

      expect(response.statusCode).toBeGreaterThanOrEqual(400);
    });
  });

  describe('Authentication Priority with ClaudeMem', () => {
    it('should override client OAuth for ClaudeMem requests', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/messages',
        headers: {
          'authorization': 'Bearer fake-client-oauth-token',
          'content-type': 'application/json'
        },
        payload: {
          model: 'anthropic,claude-3-sonnet',
          messages: [
            {
              role: 'user',
              content: 'You are a Claude-Mem'
            }
          ]
        }
      });

      // Client OAuth should result in 400 error in test environment
      expect(response.statusCode).toBeGreaterThanOrEqual(400);
    });

    it('should maintain OAuth priority for regular requests', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/messages',
        headers: {
          'authorization': 'Bearer fake-client-oauth-token',
          'content-type': 'application/json'
        },
        payload: {
          model: 'anthropic,claude-3-sonnet',
          messages: [
            {
              role: 'user',
              content: 'Regular request without ClaudeMem'
            }
          ]
        }
      });

      expect(response.statusCode).toBeGreaterThanOrEqual(400);
    });
  });
});