import fastify from 'fastify';

export async function createAuthTestApp(testConfig: any = {}) {
  const config = {
    PORT: 0,
    HOST: "127.0.0.1",
    APIKEY: "test-api-key",
    ...testConfig
  };

  const app = fastify({
    logger: false
  });

  // Global error handler
  app.setErrorHandler((error: any, request: any, reply: any) => {
    console.error('Global error handler:', error);
    reply.code(500).send({
      error: 'Internal server error',
      message: error.message || 'Unknown error'
    });
  });

  // Import the actual auth middleware
  const { apiKeyAuth } = await import('../../middleware/auth.js');

  // Apply the actual authentication middleware
  app.addHook('preHandler', apiKeyAuth(config));

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

  app.get('/v1/oauth/userinfo', async (request: any, reply: any) => {
    return reply.code(501).send({
      error: 'Not implemented',
      message: 'OAuth user info endpoint not available in test environment'
    });
  });

  // Main messages endpoint
  app.post('/v1/messages', async (request: any, reply: any) => {
    // If authentication failed, the middleware would have already sent a response
    // For testing purposes, simulate a 400 error to indicate the request was processed
    // but no actual LLM provider is available
    return reply.code(400).send({
      error: 'Processing completed',
      message: 'Authentication passed, but no LLM provider configured in test environment'
    });
  });

  app.post('/v1/messages/count_tokens', async (request: any, reply: any) => {
    return { input_tokens: 100 };
  });

  // Public endpoints
  app.get('/health', async (request: any, reply: any) => {
    try {
      return { status: 'ok' };
    } catch (error) {
      console.error('Health endpoint error:', error);
      return reply.code(500).send({
        error: 'Health check failed',
        message: error.message
      });
    }
  });

  app.get('/', async (request: any, reply: any) => {
    try {
      return { status: 'ok' };
    } catch (error) {
      console.error('Root endpoint error:', error);
      return reply.code(500).send({
        error: 'Root endpoint failed',
        message: error.message
      });
    }
  });

  // UI endpoints
  app.get('/ui', async (request: any, reply: any) => {
    return { status: 'ui-endpoint' };
  });

  app.get('/ui/*', async (request: any, reply: any) => {
    return { status: 'ui-file-endpoint' };
  });

  return app;
}