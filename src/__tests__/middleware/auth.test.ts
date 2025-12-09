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

  describe('subagent marker detection (Priority 1.5)', () => {
    it('should use provider API key when <CCR-SUBAGENT-ROUTER> is present', async () => {
      const config = createMockConfig();
      const middleware = apiKeyAuth(config);
      const req = createMockRequest({
        headers: {
          authorization: 'Bearer client-oauth-token',
        },
        body: {
          system: [
            { type: 'text', text: 'You are a helpful assistant.' },
            { type: 'text', text: '<CCR-SUBAGENT-ROUTER>frontend</CCR-SUBAGENT-ROUTER>Help me with something.' }
          ]
        }
      });
      const reply = createMockReply();

      await middleware(req as any, reply);

      // Should clear client auth and use provider API key
      expect((req as any).authToken).toBeUndefined();
      expect((req as any).authType).toBeUndefined();
      expect((req as any).subagentMarkers.hasRouterMarker).toBe(true);
      expect((req as any).subagentMarkers.routerName).toBe('frontend');
    });

    it('should use provider API key when <CCR-SUBAGENT-MODEL> is present', async () => {
      const config = createMockConfig();
      const middleware = apiKeyAuth(config);
      const req = createMockRequest({
        headers: {
          'x-api-key': 'test-api-key-12345',
        },
        body: {
          system: [
            { type: 'text', text: 'You are a helpful assistant.' },
            { type: 'text', text: '<CCR-SUBAGENT-MODEL>openrouter,anthropic/claude-3.5-sonnet</CCR-SUBAGENT-MODEL>Help me code.' }
          ]
        }
      });
      const reply = createMockReply();

      vi.mocked(oauthTokenShare.getToken).mockResolvedValue(null);

      await middleware(req as any, reply);

      // Should clear API key auth and use provider API key
      expect((req as any).authToken).toBeUndefined();
      expect((req as any).authType).toBeUndefined();
      expect((req as any).subagentMarkers.hasModelMarker).toBe(true);
      expect((req as any).subagentMarkers.modelName).toBe('openrouter,anthropic/claude-3.5-sonnet');
    });

    it('should use provider API key when both markers are present', async () => {
      const config = createMockConfig();
      const middleware = apiKeyAuth(config);
      const req = createMockRequest({
        headers: {
          authorization: 'Bearer client-oauth-token',
        },
        body: {
          system: [
            { type: 'text', text: 'You are a helpful assistant.' },
            { type: 'text', text: '<CCR-SUBAGENT-ROUTER>backend</CCR-SUBAGENT-ROUTER><CCR-SUBAGENT-MODEL>deepseek,deepseek-chat</CCR-SUBAGENT-MODEL>Help me.' }
          ]
        }
      });
      const reply = createMockReply();

      await middleware(req as any, reply);

      // Should clear client auth and use provider API key
      expect((req as any).authToken).toBeUndefined();
      expect((req as any).authType).toBeUndefined();
      expect((req as any).subagentMarkers.hasRouterMarker).toBe(true);
      expect((req as any).subagentMarkers.hasModelMarker).toBe(true);
      expect((req as any).subagentMarkers.routerName).toBe('backend');
      expect((req as any).subagentMarkers.modelName).toBe('deepseek,deepseek-chat');
    });

    it('should NOT trigger for ClaudeMem requests (ClaudeMem has higher priority)', async () => {
      const config = createMockConfig();
      const middleware = apiKeyAuth(config);
      const req = createMockRequest({
        headers: {
          authorization: 'Bearer client-oauth-token',
        },
        body: {
          system: [
            { type: 'text', text: 'You are a Claude-Mem, a specialized observer tool...' },
            { type: 'text', text: '<CCR-SUBAGENT-ROUTER>frontend</CCR-SUBAGENT-ROUTER>Help me.' }
          ],
          messages: [
            { role: 'user', content: 'You are a claude-mem specialized observer tool.' }
          ]
        }
      });
      const reply = createMockReply();

      await middleware(req as any, reply);

      // ClaudeMem should take priority, not subagent markers
      expect((req as any).authToken).toBeUndefined();
      expect((req as any).authType).toBeUndefined();
      expect((req as any).subagentMarkers).toBeUndefined();
    });

    // Memory Agent detection tests
    it('should detect Memory Agent requests with "hello memory agent" pattern', async () => {
      const config = createMockConfig();
      const middleware = apiKeyAuth(config);
      const req = createMockRequest({
        headers: {
          authorization: 'Bearer client-oauth-token',
        },
        body: {
          messages: [
            {
              role: 'user',
              content: 'Hello memory agent, you are continuing to observe the primary Claude session.'
            }
          ]
        }
      });
      const reply = createMockReply();

      await middleware(req as any, reply);

      // Should detect Memory Agent and use Provider API Key
      expect((req as any).authToken).toBeUndefined();
      expect((req as any).authType).toBeUndefined();
    });

    it('should detect Memory Agent requests with "memory agent.*observation" pattern', async () => {
      const config = createMockConfig();
      const middleware = apiKeyAuth(config);
      const req = createMockRequest({
        headers: {
          authorization: 'Bearer client-oauth-token',
        },
        body: {
          messages: [
            {
              role: 'user',
              content: 'memory agent observation: Create observations from what you observe'
            }
          ]
        }
      });
      const reply = createMockReply();

      await middleware(req as any, reply);

      // Should detect Memory Agent and use Provider API Key
      expect((req as any).authToken).toBeUndefined();
      expect((req as any).authType).toBeUndefined();
    });

    it('should detect Memory Agent requests with "you do not have access to tools" pattern', async () => {
      const config = createMockConfig();
      const middleware = apiKeyAuth(config);
      const req = createMockRequest({
        headers: {
          authorization: 'Bearer client-oauth-token',
        },
        body: {
          messages: [
            {
              role: 'user',
              content: 'You do not have access to tools. Create observations from what you observe.'
            }
          ]
        }
      });
      const reply = createMockReply();

      await middleware(req as any, reply);

      // Should detect Memory Agent and use Provider API Key
      expect((req as any).authToken).toBeUndefined();
      expect((req as any).authType).toBeUndefined();
    });

    it('should detect Memory Agent requests with "memory processing continued" pattern', async () => {
      const config = createMockConfig();
      const middleware = apiKeyAuth(config);
      const req = createMockRequest({
        headers: {
          authorization: 'Bearer client-oauth-token',
        },
        body: {
          messages: [
            {
              role: 'user',
              content: 'MEMORY PROCESSING CONTINUED'
            }
          ]
        }
      });
      const reply = createMockReply();

      await middleware(req as any, reply);

      // Should detect Memory Agent and use Provider API Key
      expect((req as any).authToken).toBeUndefined();
      expect((req as any).authType).toBeUndefined();
    });

    it('should detect Memory Agent requests in system message', async () => {
      const config = createMockConfig();
      const middleware = apiKeyAuth(config);
      const req = createMockRequest({
        headers: {
          authorization: 'Bearer client-oauth-token',
        },
        body: {
          system: [
            {
              type: 'text',
              text: 'Hello memory agent, you are continuing to observe the primary Claude session.'
            }
          ],
          messages: [
            { role: 'user', content: 'Process this data' }
          ]
        }
      });
      const reply = createMockReply();

      await middleware(req as any, reply);

      // Should detect Memory Agent in system message and use Provider API Key
      expect((req as any).authToken).toBeUndefined();
      expect((req as any).authType).toBeUndefined();
    });

    it('should NOT detect non-Memory Agent requests with similar keywords', async () => {
      const config = createMockConfig();
      const middleware = apiKeyAuth(config);
      const req = createMockRequest({
        headers: {
          authorization: 'Bearer client-oauth-token',
        },
        body: {
          messages: [
            {
              role: 'user',
              content: 'I have a good memory of this project'
            }
          ]
        }
      });
      const reply = createMockReply();

      await middleware(req as any, reply);

      // Should NOT detect as Memory Agent, use OAuth
      expect((req as any).authToken).toBe('client-oauth-token');
      expect((req as any).authType).toBe('client-oauth');
    });

    // Tests based on actual log scenarios from ccr-20251204173425.log
    it('should detect Memory Agent in complex context with system reminders', async () => {
      const config = createMockConfig();
      const middleware = apiKeyAuth(config);
      const req = createMockRequest({
        headers: {
          authorization: 'Bearer client-oauth-token',
        },
        body: {
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: '<system-reminder>SessionStart:Callback hook success: Success</system-reminder>' },
                { type: 'text', text: '<system-reminder>SessionStart hook additional context: # [claude-code-router-cc] recent context</system-reminder>' },
                { type: 'text', text: 'Hello memory agent, you are continuing to observe the primary Claude session.' }
              ]
            }
          ]
        }
      });
      const reply = createMockReply();

      await middleware(req as any, reply);

      // Should detect Memory Agent despite complex structure and use Provider API Key
      expect((req as any).authToken).toBeUndefined();
      expect((req as any).authType).toBeUndefined();
    });

    it('should detect Memory Agent with observed session context', async () => {
      const config = createMockConfig();
      const middleware = apiKeyAuth(config);
      const req = createMockRequest({
        headers: {
          authorization: 'Bearer client-oauth-token',
        },
        body: {
          messages: [
            {
              role: 'user',
              content: 'Hello memory agent, you are continuing to observe the primary Claude session.\n\n<observed_from_primary_session>\n  <user_request>hello world</user_request>\n  <requested_at>2025-12-04</requested_at>\n</observed_from_primary_session>\n\nYou do not have access to tools. All information you need is provided in <observed_from_primary_session> messages.'
            }
          ]
        }
      });
      const reply = createMockReply();

      await middleware(req as any, reply);

      // Should detect Memory Agent with context and use Provider API Key
      expect((req as any).authToken).toBeUndefined();
      expect((req as any).authType).toBeUndefined();
    });

    it('should detect Memory Agent in warmup scenarios', async () => {
      const config = createMockConfig();
      const middleware = apiKeyAuth(config);
      const req = createMockRequest({
        headers: {
          authorization: 'Bearer client-oauth-token',
        },
        body: {
          system: [
            { type: 'text', text: 'You are a Claude agent, built on Anthropic\'s Claude Agent SDK.' },
            { type: 'text', text: 'Hello memory agent, you are continuing to observe the primary Claude session.' }
          ],
          messages: [
            { role: 'user', content: [{ type: 'text', text: 'Warmup' }] }
          ]
        }
      });
      const reply = createMockReply();

      await middleware(req as any, reply);

      // Should detect Memory Agent in system and use Provider API Key
      expect((req as any).authToken).toBeUndefined();
      expect((req as any).authType).toBeUndefined();
    });

    it('should NOT detect regular Claude Code requests as Memory Agent', async () => {
      const config = createMockConfig();
      const middleware = apiKeyAuth(config);
      const req = createMockRequest({
        headers: {
          authorization: 'Bearer client-oauth-token',
        },
        body: {
          system: [
            { type: 'text', text: 'You are Claude Code, Anthropic\'s official CLI for Claude.' },
            { type: 'text', text: 'You are a software architect and planning specialist for Claude Code.' }
          ],
          messages: [
            { role: 'user', content: [{ type: 'text', text: 'Warmup' }] }
          ]
        }
      });
      const reply = createMockReply();

      await middleware(req as any, reply);

      // Should NOT detect as Memory Agent, use OAuth
      expect((req as any).authToken).toBe('client-oauth-token');
      expect((req as any).authType).toBe('client-oauth');
    });

    it('should detect Memory Agent in multi-part content arrays', async () => {
      const config = createMockConfig();
      const middleware = apiKeyAuth(config);
      const req = createMockRequest({
        headers: {
          authorization: 'Bearer client-oauth-token',
        },
        body: {
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: 'System context:' },
                { type: 'text', text: 'Hello memory agent, continue observation.' },
                { type: 'text', text: 'Additional context provided.' }
              ]
            }
          ]
        }
      });
      const reply = createMockReply();

      await middleware(req as any, reply);

      // Should detect Memory Agent in content array and use Provider API Key
      expect((req as any).authToken).toBeUndefined();
      expect((req as any).authType).toBeUndefined();
    });

    it('should handle Memory Agent detection with mixed case', async () => {
      const config = createMockConfig();
      const middleware = apiKeyAuth(config);
      const req = createMockRequest({
        headers: {
          authorization: 'Bearer client-oauth-token',
        },
        body: {
          messages: [
            {
              role: 'user',
              content: 'HELLO MEMORY AGENT - you are continuing to observe'
            }
          ]
        }
      });
      const reply = createMockReply();

      await middleware(req as any, reply);

      // Should detect Memory Agent case-insensitively and use Provider API Key
      expect((req as any).authToken).toBeUndefined();
      expect((req as any).authType).toBeUndefined();
    });

    it('should continue normal auth flow when no subagent markers are present', async () => {
      const config = createMockConfig();
      const middleware = apiKeyAuth(config);
      const req = createMockRequest({
        headers: {
          authorization: 'Bearer client-oauth-token',
        },
        body: {
          system: [
            { type: 'text', text: 'You are a helpful assistant.' },
            { type: 'text', text: 'Help me with this task.' }
          ]
        }
      });
      const reply = createMockReply();

      await middleware(req as any, reply);

      // Should use normal client OAuth auth
      expect((req as any).authToken).toBe('client-oauth-token');
      expect((req as any).authType).toBe('client-oauth');
      expect((req as any).subagentMarkers).toBeUndefined();
    });

    it('should handle malformed system gracefully', async () => {
      const config = createMockConfig();
      const middleware = apiKeyAuth(config);
      const req = createMockRequest({
        headers: {
          authorization: 'Bearer client-oauth-token',
        },
        body: {
          system: 'not-an-array'
        }
      });
      const reply = createMockReply();

      await middleware(req as any, reply);

      // Should fall back to normal auth when system is malformed
      expect((req as any).authToken).toBe('client-oauth-token');
      expect((req as any).authType).toBe('client-oauth');
      expect((req as any).subagentMarkers).toBeUndefined();
    });

    it('should handle missing system[1].text gracefully', async () => {
      const config = createMockConfig();
      const middleware = apiKeyAuth(config);
      const req = createMockRequest({
        headers: {
          authorization: 'Bearer client-oauth-token',
        },
        body: {
          system: [
            { type: 'text', text: 'You are a helpful assistant.' }
          ]
        }
      });
      const reply = createMockReply();

      await middleware(req as any, reply);

      // Should fall back to normal auth when system[1] is missing
      expect((req as any).authToken).toBe('client-oauth-token');
      expect((req as any).authType).toBe('client-oauth');
      expect((req as any).subagentMarkers).toBeUndefined();
    });

    it('should handle malformed markers gracefully', async () => {
      const config = createMockConfig();
      const middleware = apiKeyAuth(config);
      const req = createMockRequest({
        headers: {
          authorization: 'Bearer client-oauth-token',
        },
        body: {
          system: [
            { type: 'text', text: 'You are a helpful assistant.' },
            { type: 'text', text: '<CCR-SUBAGENT-ROUTER><empty></CCR-SUBAGENT-ROUTER><CCR-SUBAGENT-MODEL><empty></CCR-SUBAGENT-MODEL>Help me.' }
          ]
        }
      });
      const reply = createMockReply();

      await middleware(req as any, reply);

      // Should detect markers and clear auth for provider API key
      expect((req as any).authToken).toBeUndefined();
      expect((req as any).authType).toBeUndefined();
      expect((req as any).subagentMarkers.hasRouterMarker).toBe(true);
      expect((req as any).subagentMarkers.hasModelMarker).toBe(true);
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
