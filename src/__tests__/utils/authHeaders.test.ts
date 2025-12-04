/**
 * Tests for Authentication Headers utility
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock oauthTokenShare
vi.mock('../../utils/oauthTokenShare.js', () => ({
  oauthTokenShare: {
    getToken: vi.fn(),
  },
}));

import { getAuthHeaders, createSubagentHeaders } from '../../utils/authHeaders.js';
import { oauthTokenShare } from '../../utils/oauthTokenShare.js';

describe('authHeaders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getAuthHeaders', () => {
    describe('when request has auth info from middleware', () => {
      it('should generate Bearer header for client-oauth type', async () => {
        const req = {
          authToken: 'client-oauth-token',
          authType: 'client-oauth',
        };
        const config = { APIKEY: 'test-api-key' };

        const result = await getAuthHeaders(req, config);

        expect(result).toEqual({
          'Authorization': 'Bearer client-oauth-token',
        });
      });

      it('should generate Bearer header for ccr-oauth type', async () => {
        const req = {
          authToken: 'ccr-oauth-token',
          authType: 'ccr-oauth',
        };
        const config = { APIKEY: 'test-api-key' };

        const result = await getAuthHeaders(req, config);

        expect(result).toEqual({
          'Authorization': 'Bearer ccr-oauth-token',
        });
      });

      it('should generate x-api-key header for api-key type', async () => {
        const req = {
          authToken: 'api-key-token',
          authType: 'api-key',
        };
        const config = { APIKEY: 'test-api-key' };

        const result = await getAuthHeaders(req, config);

        expect(result).toEqual({
          'x-api-key': 'api-key-token',
        });
      });
    });

    describe('fallback when no auth info in request', () => {
      it('should try CCR OAuth token as fallback', async () => {
        const req = {};
        const config = { APIKEY: 'test-api-key' };
        vi.mocked(oauthTokenShare.getToken).mockResolvedValue({
          access_token: 'ccr-fallback-token',
          token_type: 'Bearer',
        });

        const result = await getAuthHeaders(req, config);

        expect(result).toEqual({
          'Authorization': 'Bearer ccr-fallback-token',
        });
      });

      it('should use configured API key when no OAuth token', async () => {
        const req = {};
        const config = { APIKEY: 'configured-api-key' };
        vi.mocked(oauthTokenShare.getToken).mockResolvedValue(null);

        const result = await getAuthHeaders(req, config);

        expect(result).toEqual({
          'x-api-key': 'configured-api-key',
        });
      });

      it('should return empty headers when no auth available', async () => {
        const req = {};
        const config = {}; // no APIKEY
        vi.mocked(oauthTokenShare.getToken).mockResolvedValue(null);

        const result = await getAuthHeaders(req, config);

        expect(result).toEqual({});
      });
    });

    describe('error handling', () => {
      it('should fallback to API key when OAuth token fetch fails', async () => {
        const req = {};
        const config = { APIKEY: 'fallback-api-key' };
        vi.mocked(oauthTokenShare.getToken).mockRejectedValue(new Error('Token fetch failed'));

        const result = await getAuthHeaders(req, config);

        expect(result).toEqual({
          'x-api-key': 'fallback-api-key',
        });
      });
    });
  });

  describe('createSubagentHeaders', () => {
    it('should include content-type header', async () => {
      const req = {
        authToken: 'test-token',
        authType: 'api-key',
      };
      const config = { APIKEY: 'test-api-key' };

      const result = await createSubagentHeaders(req, config);

      expect(result['content-type']).toBe('application/json');
    });

    it('should include auth headers from getAuthHeaders', async () => {
      const req = {
        authToken: 'bearer-token',
        authType: 'client-oauth',
      };
      const config = { APIKEY: 'test-api-key' };

      const result = await createSubagentHeaders(req, config);

      expect(result).toEqual({
        'content-type': 'application/json',
        'Authorization': 'Bearer bearer-token',
      });
    });

    it('should inherit parent request auth type', async () => {
      const req = {
        authToken: 'inherited-token',
        authType: 'ccr-oauth',
      };
      const config = {};

      const result = await createSubagentHeaders(req, config);

      expect(result['Authorization']).toBe('Bearer inherited-token');
    });
  });
});
