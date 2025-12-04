import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { createAuthTestApp } from '../utils/authTestApp.js';

describe('Basic Infrastructure Test', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    try {
      app = await createAuthTestApp();
      await app.ready();
    } catch (error) {
      console.error('Error in beforeEach:', error);
      throw error;
    }
  });

  afterEach(async () => {
    await app.close();
  });

  it('should build app without hanging', async () => {
    expect(app).toBeDefined();
    expect(typeof app.inject).toBe('function');
  });

  it('should handle simple health check', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health'
    });

    // Force stringification to see error details
    expect(response.statusCode).toBe(200);
    if (response.statusCode !== 200) {
      throw new Error(`Health check failed: ${JSON.stringify({
        statusCode: response.statusCode,
        payload: response.payload,
        headers: response.headers
      }, null, 2)}`);
    }
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('should handle simple message request', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: {
        'content-type': 'application/json'
      },
      payload: {
        messages: [
          { role: 'user', content: 'Hello test' }
        ]
      }
    });

    expect(response.statusCode).toBe(401);
    expect(response.body).toBe("x-api-key is missing");
  });
});