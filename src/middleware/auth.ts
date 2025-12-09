import { FastifyRequest, FastifyReply } from "fastify";
import { oauthTokenShare } from "../utils/oauthTokenShare.js";
import { detectOAuthRequest } from "../utils/oauthDetector.js";
import { MessageParam } from "@anthropic-ai/sdk/resources/messages";

/**
 * 验证消息内容块是否有效
 */
function isValidContentPart(part: unknown): boolean {
  if (!part || typeof part !== 'object') return false;
  const p = part as Record<string, unknown>;

  // Text content block
  if (p.type === 'text' && typeof p.text === 'string') {
    return p.text.length > 0 && p.text.length < 100000;
  }

  // Image content block (base64 or URL)
  if (p.type === 'image') {
    const source = p.source as Record<string, unknown> | undefined;
    if (source?.type === 'base64' && typeof source.data === 'string') {
      return true;
    }
    if (source?.type === 'url' && typeof source.url === 'string') {
      return true;
    }
  }

  // Tool use/result blocks
  if (p.type === 'tool_use' || p.type === 'tool_result') {
    return true;
  }

  return false;
}

/**
 * 验证消息数组是否有效
 * 支持 string 类型和 ContentBlock[] 类型的 content
 */
export function validateMessageArray(messages: unknown): messages is MessageParam[] {
  if (!Array.isArray(messages)) {
    return false;
  }

  return messages.every(msg => {
    if (!msg || typeof msg !== 'object' || !('content' in msg)) {
      return false;
    }

    const content = (msg as Record<string, unknown>).content;

    // String content
    if (typeof content === 'string') {
      return content.length > 0 && content.length < 100000;
    }

    // Array content (ContentBlock[])
    if (Array.isArray(content)) {
      return content.length > 0 && content.every(isValidContentPart);
    }

    return false;
  });
}

// Token masking utility for secure logging
function maskToken(token?: string): string {
  if (!token) return 'undefined';
  if (token.length <= 8) return token;
  return token.substring(0, 8) + '...';
}

// Extract token information for logging
function getTokenInfo(token: string) {
  return {
    length: token.length,
    prefix: token.substring(0, 3),
    masked: maskToken(token)
  };
}

/**
 * Determine the route type for a request based on model selection logic
 */
const determineRouteType = (req: FastifyRequest): 'default' | 'think' | 'background' | 'webSearch' | 'longContext' => {
  try {
    // Check for explicit thinking flag
    if ((req.body as any)?.thinking) {
      return 'think';
    }

    // Check for model-specific routing
    const model = (req.body as any)?.model;
    if (model && typeof model === 'string') {
      const lowerModel = model.toLowerCase();
      if (lowerModel.includes('think') || lowerModel.includes('reasoning')) {
        return 'think';
      }
      if (lowerModel.includes('background') || lowerModel.includes('haiku')) {
        return 'background';
      }
      if (lowerModel.includes('search') || lowerModel.includes('perplexity')) {
        return 'webSearch';
      }
      if (lowerModel.includes('long') || lowerModel.includes('context')) {
        return 'longContext';
      }
    }

    // Default route type
    return 'default';
  } catch (error) {
    // Default to 'default' if route type cannot be determined
    return 'default';
  }
};

/**
 * Detect subagent routing markers in request
 */
const detectSubagentMarkers = (req: FastifyRequest): {
  hasRouterMarker: boolean;
  hasModelMarker: boolean;
  routerName?: string;
  modelName?: string;
} => {
  const result = {
    hasRouterMarker: false,
    hasModelMarker: false,
    routerName: undefined as string | undefined,
    modelName: undefined as string | undefined
  };

  try {
    const system = (req.body as any)?.system;
    if (!Array.isArray(system) || system.length <= 1) {
      return result;
    }

    const systemText = system[1]?.text;
    if (typeof systemText !== 'string') {
      return result;
    }

    // Detect router marker
    const routerMatch = systemText.match(/<CCR-SUBAGENT-ROUTER>(.*?)<\/CCR-SUBAGENT-ROUTER>/s);
    if (routerMatch) {
      result.hasRouterMarker = true;
      result.routerName = routerMatch[1]?.trim();
    }

    // Detect model marker
    const modelMatch = systemText.match(/<CCR-SUBAGENT-MODEL>(.*?)<\/CCR-SUBAGENT-MODEL>/s);
    if (modelMatch) {
      result.hasModelMarker = true;
      result.modelName = modelMatch[1]?.trim();
    }
  } catch (error) {
    // Log error but don't fail authentication
    const logger = (req as any).server?.logger;
    if (logger?.warn) {
      logger.warn({
        error: error instanceof Error ? error.message : String(error),
        url: req.url
      }, 'Failed to detect subagent markers');
    }
  }

  return result;
};

export const apiKeyAuth =
  (config: any) =>
  async (req: FastifyRequest, reply: FastifyReply) => {
    const startTime = Date.now();
    const logger = (req as any).server?.logger;

    // Check if this is an OAuth request that should bypass authentication
    const oauthDetection = detectOAuthRequest(req);
    if (oauthDetection.isOAuthRequest) {
      // Mark request as OAuth for transparent forwarding
      (req as any).isOAuthRequest = true;
      (req as any).oauthRequestType = oauthDetection.requestType;
      (req as any).oauthConfidence = oauthDetection.confidence;

      if (logger?.info) {
        logger.info({
          url: req.url,
          method: req.method,
          requestType: oauthDetection.requestType,
          confidence: oauthDetection.confidence,
          details: oauthDetection.details
        }, 'OAuth request detected - marking for routing middleware processing');
      }

      // OAuth requests bypass authentication but continue to router for CCR-SUBAGENT processing
      return; // Return after marking to skip authentication but continue to router
    }

    // Public endpoints that don't require authentication
    if (["/", "/health"].includes(req.url) || req.url.startsWith("/ui")) {
      if (logger?.debug) {
        logger.debug({ url: req.url }, 'Public endpoint - authentication skipped');
      }
      return;
    }

    // Check for ClaudeMem requests (highest priority for auth override)
    // ClaudeMem system prompt pattern (case-insensitive)
    // Based on actual ClaudeMem system prompt: "You are a Claude-Mem, a specialized observer tool..."
    const claudeMemPatterns = [
      'you are a claude-mem',
      'hello memory agent',
      'memory agent.*observation',
      'you do not have access to tools.*create observations',
      'memory processing continued',
      'claude-mem.*specialized observer tool',
      'session tracking',
      'memory logs',
      'session_summary',
      'claude-mem://',
      'primary session',
      'memory agent.*hello',
      'observation.*session',
      'context index',
      'work investment'
    ];

    const isClaudeMem = (() => {
      const messages = (req.body as any)?.messages;
      if (!validateMessageArray(messages)) return false;

      // Check both messages and system for ClaudeMem/Memory Agent patterns
      const contentToCheck = [
        ...(messages || []),
        ...((req.body as any)?.system || [])
      ];

      for (const content of contentToCheck) {
        let textContent = '';

        if (typeof content === 'string') {
          textContent = content;
        } else if (typeof content === 'object' && content !== null) {
          if (typeof content.content === 'string') {
            textContent = content.content;
          } else if (typeof content.text === 'string') {
            textContent = content.text;
          } else if (Array.isArray(content.content)) {
            for (const contentPart of content.content) {
              if (contentPart.type === 'text' && typeof contentPart.text === 'string') {
                textContent += ' ' + contentPart.text;
              }
            }
          }
        }

        if (textContent) {
          const lowerText = textContent.toLowerCase();
          for (const pattern of claudeMemPatterns) {
            if (lowerText.includes(pattern) || new RegExp(pattern, 'i').test(lowerText)) {
              return true;
            }
          }
        }
      }
      return false;
    })();

    // Authentication priority (inbound - client to CCR):
    // 1. ClaudeMem detection (clear auth, use Provider API Key for upstream)
    // 2. Client OAuth2 (Authorization: Bearer header from client)
    // 3. CCR OAuth2 (shared OAuth token from CCR's own OAuth flow)
    // 4. CCR configured APIKEY validation (x-api-key header)
    //
    // Note: For upstream requests (CCR to provider), Provider API Key is used as final fallback
    // when no OAuth tokens are available. This is handled in authHeaders.ts, not here.

    // Determine route type early for authentication decision making
    const routeType = determineRouteType(req);

    // Start authentication process
    if (logger?.debug) {
      logger.debug({
        url: req.url,
        method: req.method,
        userAgent: req.headers['user-agent'],
        hasAuthHeader: !!req.headers['authorization'],
        hasApiKeyHeader: !!req.headers['x-api-key'],
        routeType,
        hasThinking: !!(req.body as any)?.thinking,
        model: (req.body as any)?.model
      }, 'Starting authentication process');
    }

    // Priority 1: ClaudeMem detection - clear any auth and use Provider API Key
    if (isClaudeMem) {
      // Clear any client authentication tokens to force Provider API Key usage
      const clientToken = (req as any).authToken;
      const clientAuthType = (req as any).authType;

      delete (req as any).authToken;
      delete (req as any).authType;

      // Log ClaudeMem detection and auth switch
      if (logger?.info) {
        logger.info({
          claudeMem: true,
          originalAuthType: clientAuthType,
          originalTokenPresent: !!clientToken,
          newAuthType: 'provider-api-key',
          url: req.url,
          method: req.method,
          priority: 'Priority_1_ClaudeMem_Override'
        }, 'ClaudeMem request detected - switching from client auth to Provider API Key');
      }

      const duration = Date.now() - startTime;
      if (logger?.debug) {
        logger.debug({
          authType: 'provider-api-key',
          duration: `${duration}ms`,
          priority: 'Priority_1_ClaudeMem_Override'
        }, 'Authentication completed');
      }

      return;
    }

    // Priority 1.5: Subagent Markers - use Provider API Key (but preserve OAuth for think models)
    const subagentMarkers = detectSubagentMarkers(req);
    const hasSubagentMarkers = subagentMarkers.hasRouterMarker || subagentMarkers.hasModelMarker;

    if (hasSubagentMarkers && routeType !== 'think') {
      // Clear any client authentication tokens to force Provider API Key usage
      const clientToken = (req as any).authToken;
      const clientAuthType = (req as any).authType;

      delete (req as any).authToken;
      delete (req as any).authType;

      // Store marker info for router processing
      (req as any).subagentMarkers = subagentMarkers;

      // Log subagent marker detection and auth switch
      if (logger?.info) {
        logger.info({
          hasRouterMarker: subagentMarkers.hasRouterMarker,
          hasModelMarker: subagentMarkers.hasModelMarker,
          routerName: subagentMarkers.routerName,
          modelName: subagentMarkers.modelName,
          routeType,
          originalAuthType: clientAuthType,
          originalTokenPresent: !!clientToken,
          newAuthType: 'provider-api-key',
          url: req.url,
          method: req.method,
          priority: 'Priority_1_5_Subagent_Markers'
        }, 'Subagent markers detected - switching from client auth to Provider API Key');
      }

      const duration = Date.now() - startTime;
      if (logger?.debug) {
        logger.debug({
          authType: 'provider-api-key',
          duration: `${duration}ms`,
          hasRouterMarker: subagentMarkers.hasRouterMarker,
          hasModelMarker: subagentMarkers.hasModelMarker,
          routeType,
          priority: 'Priority_1_5_Subagent_Markers'
        }, 'Authentication completed');
      }

      return;
    }

    // Log why subagent markers didn't trigger Provider API Key
    if (hasSubagentMarkers && routeType === 'think') {
      if (logger?.info) {
        logger.info({
          hasRouterMarker: subagentMarkers.hasRouterMarker,
          hasModelMarker: subagentMarkers.hasModelMarker,
          routerName: subagentMarkers.routerName,
          modelName: subagentMarkers.modelName,
          routeType,
          url: req.url,
          method: req.method,
          priority: 'Priority_1_5_Think_Model_Exception',
          reason: 'Think model detected - preserving OAuth authentication instead of switching to Provider API Key'
        }, 'Subagent markers detected but think model exception applied');
      }
    }

    const authHeader = req.headers["authorization"];
    const authHeaderValue = Array.isArray(authHeader) ? authHeader[0] : authHeader;
    // 安全地提取Bearer令牌并验证其非空（不存储中间结果）
    const clientBearerToken = (() => {
      if (!authHeaderValue || !authHeaderValue.startsWith("Bearer ")) {
        return null;
      }
      return authHeaderValue.substring(7).trim();
    })();

    // Priority 2: Client OAuth2 token in Authorization header
    if (clientBearerToken && clientBearerToken.length > 0) {
      const tokenInfo = getTokenInfo(clientBearerToken);

      if (logger?.debug) {
        logger.debug({
          authType: 'client-oauth',
          tokenInfo,
          url: req.url,
          method: req.method,
          routeType,
          hasThinking: !!(req.body as any)?.thinking,
          model: (req.body as any)?.model
        }, 'Client OAuth2 token detected and attached');
      } else if (logger?.info) {
        logger.info({
          authType: 'client-oauth',
          tokenLength: tokenInfo.length,
          routeType,
          priority: 'Priority_2_Client_OAuth'
        }, 'Client OAuth2 authentication successful');
      }

      // Attach client OAuth token to request for upstream use
      (req as any).authToken = clientBearerToken;
      (req as any).authType = 'client-oauth';

      const duration = Date.now() - startTime;
      if (logger?.info) {
        logger.info({
          authType: 'client-oauth',
          tokenLength: tokenInfo.length,
          duration: `${duration}ms`,
          url: req.url,
          method: req.method,
          routeType,
          priority: 'Priority_2_Client_OAuth'
        }, 'Client OAuth2 authentication successful');
      } else if (logger?.debug) {
        logger.debug({
          authType: 'client-oauth',
          duration: `${duration}ms`,
          routeType,
          priority: 'Priority_2_Client_OAuth'
        }, 'Authentication completed');
      }

      return;
    }

    // Priority 3: CCR OAuth2 (shared token from CCR's OAuth flow)
    if (logger?.debug) {
      logger.debug({
        url: req.url,
        method: req.method
      }, 'Attempting to retrieve CCR OAuth2 token');
    }

    try {
      const ccrOAuthToken = await oauthTokenShare.getToken();
      if (ccrOAuthToken) {
        const tokenInfo = getTokenInfo(ccrOAuthToken.access_token);
        const now = Date.now();
        // Use expires_at (snake_case) as defined in OAuthToken interface
        const expiresAt = ccrOAuthToken.expires_at ?? 0;
        const timeToExpiry = expiresAt - now;
        const hoursToExpiry = Math.floor(timeToExpiry / (1000 * 60 * 60));

        if (logger?.debug) {
          logger.debug({
            authType: 'ccr-oauth',
            tokenInfo,
            expiresAt: expiresAt > 0 ? new Date(expiresAt).toISOString() : 'unknown',
            timeToExpiry: expiresAt > 0 ? `${hoursToExpiry}h` : 'unknown',
            url: req.url,
            method: req.method
          }, 'CCR OAuth2 token retrieved and attached');
        } else if (logger?.info) {
          logger.info({
            authType: 'ccr-oauth',
            tokenLength: tokenInfo.length,
            timeToExpiry: expiresAt > 0 ? `${hoursToExpiry}h` : 'unknown',
            priority: 'Priority_3_CCR_OAuth'
          }, 'CCR OAuth2 authentication successful');
        }

        // Check if token is expiring soon (only if expires_at is available)
        if (expiresAt > 0 && hoursToExpiry < 24 && logger?.warn) {
          logger.warn({
            authType: 'ccr-oauth',
            timeToExpiry: `${hoursToExpiry}h`,
            expiresAt: new Date(expiresAt).toISOString()
          }, 'OAuth token expiring soon');
        }

        // Attach CCR OAuth token to request for upstream use
        (req as any).authToken = ccrOAuthToken.access_token;
        (req as any).authType = 'ccr-oauth';

        const duration = Date.now() - startTime;
        if (logger?.debug) {
          logger.debug({
            authType: 'ccr-oauth',
            duration: `${duration}ms`
          }, 'Authentication completed');
        }

        return;
      } else {
        if (logger?.debug) {
          logger.debug({
            url: req.url,
            method: req.method
          }, 'No CCR OAuth2 token available');
        }
      }
    } catch (error) {
      if (logger?.error) {
        logger.error({
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          url: req.url,
          method: req.method
        }, 'Failed to get CCR OAuth2 token');
      } else {
        // Fallback to console for backward compatibility
        console.warn('Failed to get CCR OAuth token:', error);
      }
    }

    // Priority 4: CCR configured APIKEY validation (x-api-key header)
    // Note: This validates client access to CCR, not upstream provider authentication
    // Provider API Key for upstream requests is handled separately in authHeaders.ts
    const apiKey = config.APIKEY;
    if (!apiKey) {
      if (logger?.debug) {
        logger.debug({
          url: req.url,
          method: req.method
        }, 'No API key configured - checking for client OAuth or allowing local access');
      }

      // Check if there's client OAuth token first
      if (clientBearerToken && clientBearerToken.length > 0) {
        if (logger?.debug) {
          logger.debug({
            authType: 'client-oauth-only',
            url: req.url,
            method: req.method
          }, 'Using client OAuth token (no server API key configured)');
        }

        // Attach client OAuth token to request for upstream use
        (req as any).authToken = clientBearerToken;
        (req as any).authType = 'client-oauth';

        const duration = Date.now() - startTime;
        if (logger?.debug) {
          logger.debug({
            authType: 'client-oauth',
            duration: `${duration}ms`
          }, 'Authentication completed');
        }
        return;
      }

      // Check CORS first for cross-origin requests
      const allowedOrigins = [
        `http://127.0.0.1:${config.PORT || 3456}`,
        `http://localhost:${config.PORT || 3456}`,
      ];
      if (req.headers.origin) {
        if (!allowedOrigins.includes(req.headers.origin)) {
          if (logger?.warn) {
            logger.warn({
              origin: req.headers.origin,
              allowedOrigins
            }, 'CORS not allowed for this origin');
          }
          reply.status(403).send("CORS not allowed for this origin");
          return;
        }
        reply.header('Access-Control-Allow-Origin', req.headers.origin);
        reply.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key');
      }

      // For protected endpoints, require authentication
      if (req.url.startsWith('/v1/messages') || req.url.startsWith('/v1/chat')) {
        if (logger?.warn) {
          logger.warn({
            url: req.url,
            method: req.method
          }, 'No authentication provided for protected endpoint');
        }
        reply.status(401).send("Authentication required");
        return;
      }

      const duration = Date.now() - startTime;
      if (logger?.debug) {
        logger.debug({
          authType: 'none',
          duration: `${duration}ms`
        }, 'Authentication completed (no auth required for public endpoint)');
      }

      return;
    }

    // Validate x-api-key
    const apiKeyHeaderValue = req.headers["x-api-key"];
    const clientApiKey: string = Array.isArray(apiKeyHeaderValue)
      ? apiKeyHeaderValue[0]
      : apiKeyHeaderValue || "";

    if (logger?.debug) {
      logger.debug({
        url: req.url,
        method: req.method,
        hasApiKey: !!clientApiKey
      }, 'Validating API key');
    }

    if (!clientApiKey) {
      if (logger?.warn) {
        logger.warn({
          url: req.url,
          method: req.method
        }, 'API key missing in request');
      }
      reply.status(401).send("x-api-key is missing");
      return;
    }

    if (clientApiKey !== apiKey) {
      if (logger?.error) {
        logger.error({
          url: req.url,
          method: req.method,
          providedKeyPrefix: maskToken(clientApiKey),
          expectedKeyPrefix: maskToken(apiKey)
        }, 'Invalid API key provided');
      }
      reply.status(401).send("Invalid API key");
      return;
    }

    // API key is valid - client is authorized to access CCR
    if (logger?.debug) {
      logger.debug({
        authType: 'api-key',
        keyInfo: getTokenInfo(clientApiKey),
        url: req.url,
        method: req.method
      }, 'API key validation successful');
    } else if (logger?.info) {
      logger.info({
        authType: 'api-key',
        url: req.url,
        priority: 'Priority_4_CCR_API_Key'
      }, 'CCR API key authentication successful');
    }

    // Attach API key info to request
    (req as any).authToken = clientApiKey;
    (req as any).authType = 'api-key';

    const duration = Date.now() - startTime;
    if (logger?.debug) {
      logger.debug({
        authType: 'api-key',
        duration: `${duration}ms`
      }, 'Authentication completed');
    }

    // Authentication successful, continue processing
};
