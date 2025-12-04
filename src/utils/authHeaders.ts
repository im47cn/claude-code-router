/**
 * Authentication Headers Utility
 *
 * Handles creating authentication headers for upstream requests based on priority:
 * 1. Client OAuth2 (Authorization: Bearer) - from client request
 * 2. CCR OAuth2 (shared token) - from CCR's OAuth flow
 * 3. Provider API Key - from provider configuration (not CCR's APIKEY)
 *
 * Note: CCR's APIKEY is for inbound client validation, not outbound provider auth
 */

import { oauthTokenShare } from './oauthTokenShare.js';

export interface AuthHeaders {
  'Authorization'?: string;
  'x-api-key'?: string;
}

export interface Logger {
  warn?: (message: string, ...args: any[]) => void;
  error?: (message: string, ...args: any[]) => void;
}

/**
 * Get authentication headers based on priority
 * @param req - Request object with auth info from middleware
 * @param config - Configuration object (may contain provider API keys)
 * @param logger - Optional logger for error handling
 */
export async function getAuthHeaders(
  req: any,
  config: any,
  logger?: Logger
): Promise<AuthHeaders> {
  const headers: AuthHeaders = {};
  const log = logger ?? { warn: console.warn, error: console.error };

  // Priority 1: Check if request already has auth info from middleware
  if (req.authToken && req.authType) {
    switch (req.authType) {
      case 'client-oauth':
      case 'ccr-oauth':
        headers['Authorization'] = `Bearer ${req.authToken}`;
        return headers;

      case 'api-key':
        // Use the API key from middleware for upstream auth
        headers['x-api-key'] = req.authToken;
        return headers;
    }
  }

  // Priority 2: Try to get CCR OAuth token (fallback)
  try {
    const ccrOAuthToken = await oauthTokenShare.getToken();
    if (ccrOAuthToken) {
      headers['Authorization'] = `Bearer ${ccrOAuthToken.access_token}`;
      return headers;
    }
  } catch (error) {
    if (log.warn) {
      log.warn('Failed to get CCR OAuth token:', error);
    }
  }

  // Priority 3: Use configured API key as fallback
  // Note: This is the CCR's configured APIKEY, which can be used for upstream auth
  // when no OAuth is available. Provider-specific API keys are handled by providers.
  if (config.APIKEY) {
    headers['x-api-key'] = config.APIKEY;
  }

  return headers;
}

/**
 * Create headers for subagent calls
 */
export async function createSubagentHeaders(req: any, config: any): Promise<Record<string, string>> {
  const authHeaders = await getAuthHeaders(req, config);

  return {
    'content-type': 'application/json',
    ...authHeaders,
  };
}
