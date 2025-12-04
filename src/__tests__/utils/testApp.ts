import fastify from 'fastify';

export function createTestApp(testConfig: any = {}) {
  const config = {
    PORT: 0,
    HOST: "127.0.0.1",
    APIKEY: "test-api-key",
    ...testConfig
  };

  const app = fastify({
    logger: false
  });

  // No authentication middleware for simplicity in testing
  // This avoids any potential authentication-related errors

  // Mock routes for testing
  app.post('/v1/messages', async (request: any, reply: any) => {
    // For testing, accept all requests regardless of auth type
    // In a real environment, auth would be validated by the actual middleware
    return {
      id: 'test-response',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'Test response' }]
    };
  });

  app.post('/v1/messages/count_tokens', async (request: any, reply: any) => {
    return { input_tokens: 100 };
  });

  app.get('/health', async (request: any, reply: any) => {
    return { status: 'ok' };
  });

  app.get('/', async (request: any, reply: any) => {
    return { status: 'ok' };
  });

  // OAuth endpoints - should return error (not implemented in test)
  app.post('/v1/oauth/token', async (request: any, reply: any) => {
    return reply.code(501).send({
      error: 'Not implemented',
      message: 'OAuth endpoint not available in test environment'
    });
  });

  app.post('/v1/oauth/refresh', async (request: any, reply: any) => {
    return reply.code(501).send({
      error: 'Not implemented',
      message: 'OAuth refresh endpoint not available in test environment'
    });
  });

  return app;
}