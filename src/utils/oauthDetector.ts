import { FastifyRequest } from 'fastify';

export interface OAuthRequestInfo {
  isOAuthRequest: boolean;
  requestType: 'token_exchange' | 'token_refresh' | 'user_info' | 'unknown';
  confidence: number;
  details: {
    urlMatch: boolean;
    bodyMatch: boolean;
    headerMatch: boolean;
  };
}

/**
 * Detects if the request is an OAuth-related request that should bypass model routing
 * OAuth requests include token exchange, token refresh, user info, etc.
 */
export const detectOAuthRequest = (req: FastifyRequest): OAuthRequestInfo => {
  const url = req.url || '';
  const body = req.body as any;
  const headers = req.headers || {};

  let isOAuthRequest = false;
  let requestType: 'token_exchange' | 'token_refresh' | 'user_info' | 'unknown' = 'unknown';
  let confidence = 0;

  const details = {
    urlMatch: false,
    bodyMatch: false,
    headerMatch: false,
  };

  // 1. URL pattern matching for OAuth endpoints
  const oauthUrlPatterns = [
    /\/v1\/oauth\/token/i,
    /\/v1\/oauth\/refresh/i,
    /\/v1\/oauth\/revoke/i,
    /\/v1\/oauth\/userinfo/i,
    /\/v1\/oauth\/introspect/i,
    /\/oauth\/token/i,
    /\/oauth\/refresh/i,
    /\/oauth\/userinfo/i,
  ];

  for (const pattern of oauthUrlPatterns) {
    if (pattern.test(url)) {
      details.urlMatch = true;
      confidence += 0.6;
      isOAuthRequest = true;

      // Determine request type from URL
      if (url.includes('/token')) {
        requestType = url.includes('/refresh') ? 'token_refresh' : 'token_exchange';
      } else if (url.includes('/userinfo')) {
        requestType = 'user_info';
      }
      break;
    }
  }

  // 2. Request body matching for OAuth parameters
  if (body && typeof body === 'object') {
    const oauthBodyParams = [
      'grant_type',
      'refresh_token',
      'client_id',
      'client_secret',
      'code',
      'redirect_uri',
      'scope',
    ];

    const oauthParamCount = oauthBodyParams.filter(param =>
      body.hasOwnProperty(param) && body[param] !== undefined
    ).length;

    if (oauthParamCount >= 2) {
      details.bodyMatch = true;
      confidence += 0.3;
      isOAuthRequest = true;

      // Determine request type from body
      if (body.grant_type) {
        switch (body.grant_type) {
          case 'authorization_code':
          case 'client_credentials':
            requestType = 'token_exchange';
            break;
          case 'refresh_token':
            requestType = 'token_refresh';
            break;
        }
      }
    }
  }

  // 3. Header matching for OAuth indicators
  const oauthHeaders = [
    'authorization',
    'x-oauth-client-id',
    'x-oauth-grant-type',
  ];

  const hasOAuthHeaders = oauthHeaders.some(header =>
    headers[header] !== undefined
  );

  if (hasOAuthHeaders) {
    details.headerMatch = true;
    // Only add small confidence for headers as they can be present in regular requests
    confidence += 0.1;
  }

  // Final determination
  confidence = Math.min(confidence, 1.0);
  isOAuthRequest = confidence >= 0.3; // Lower threshold for OAuth detection to catch body-only requests

  return {
    isOAuthRequest,
    requestType: isOAuthRequest ? requestType : 'unknown',
    confidence,
    details,
  };
};

/**
 * Checks if a specific path should be treated as OAuth transparent route
 * based on configuration
 */
export const isOAuthTransparentRoute = (url: string, transparentRoutes: string[] = []): boolean => {
  // Default transparent OAuth routes
  const defaultTransparentRoutes = [
    '/v1/oauth/token',
    '/v1/oauth/refresh',
    '/v1/oauth/revoke',
    '/v1/oauth/userinfo',
    '/v1/oauth/introspect',
    '/oauth/token',
    '/oauth/refresh',
    '/oauth/revoke',
    '/oauth/userinfo',
    '/oauth/introspect',
  ];

  const allTransparentRoutes = [...defaultTransparentRoutes, ...transparentRoutes];

  return allTransparentRoutes.some(route => {
    // Exact match or starts with route
    return url === route || url.startsWith(route + '/');
  });
};