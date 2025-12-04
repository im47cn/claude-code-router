/**
 * Parse authentication configuration from model strings
 * Supports extended format: "provider,model;auth=oauth,fallback=api-key;subagent=disable"
 *
 * Examples:
 * - "anthropic,claude-3-sonnet"  // Default: API key
 * - "anthropic,claude-3-sonnet;auth=oauth"  // OAuth only
 * - "anthropic,claude-3-sonnet;auth=oauth,fallback=api-key"  // OAuth with fallback
 * - "zhipu,glm-4;auth=api-key"  // API key only
 * - "openrouter,claude-3-haiku;auth=oauth,subagent=disable"  // OAuth, disable subagent passthrough
 */

export interface ParsedAuthConfig {
  provider: string;
  model: string;
  auth?: {
    primary?: 'oauth' | 'api-key' | 'none';
    fallback?: 'oauth' | 'api-key' | 'none';
    subagentPassthrough?: boolean;
  };
}

export function parseModelAuthConfig(modelString: string): ParsedAuthConfig {
  // Split by semicolon to separate model config from auth config
  const parts = modelString.split(';');
  const modelPart = parts[0] || '';
  const authParts = parts.slice(1);

  // Parse provider and model
  const [provider, ...modelComponents] = modelPart.split(',');
  const model = modelComponents.join(',');

  const result: ParsedAuthConfig = {
    provider: provider || '',
    model: model || '',
  };

  // Parse authentication configuration
  if (authParts.length > 0) {
    result.auth = {};

    for (const authPart of authParts) {
      // Parse key=value pairs separated by commas
      const directives = authPart.split(',');

      for (const directive of directives) {
        const [key, value] = directive.split('=').map(s => s.trim());

        if (!key || !value) continue;

        const validAuthTypes = ['oauth', 'api-key', 'none'] as const;

        switch (key) {
          case 'auth':
            if (validAuthTypes.includes(value as any)) {
              result.auth.primary = value as typeof validAuthTypes[number];
            } else {
              console.warn(`Invalid auth type: ${value}, using default 'none'`);
              result.auth.primary = 'none';
            }
            break;

          case 'fallback':
            if (validAuthTypes.includes(value as any)) {
              result.auth.fallback = value as typeof validAuthTypes[number];
            } else {
              console.warn(`Invalid fallback auth type: ${value}, using default 'none'`);
              result.auth.fallback = 'none';
            }
            break;

          case 'subagent':
            result.auth.subagentPassthrough = value !== 'disable';
            break;

          case 'oauth':
            // Shortcut: "oauth" means "auth=oauth,fallback=api-key"
            if (value === 'true' || value === '1') {
              result.auth.primary = 'oauth';
              result.auth.fallback = result.auth.fallback || 'api-key';
            }
            break;

          case 'fallback-only':
            // Special directive: only use fallback
            if (value === 'oauth' || value === 'api-key' || value === 'none') {
              result.auth.primary = value;
              result.auth.fallback = undefined;
            }
            break;
        }
      }
    }
  }

  return result;
}

/**
 * Get authentication strategy for a route based on model configuration
 * Falls back to intelligent defaults based on route type
 */
export function getAuthStrategy(
  routeType: 'default' | 'think' | 'longContext' | 'background' | 'webSearch' | 'subagent',
  modelString?: string
): ParsedAuthConfig['auth'] {
  // If model string has explicit auth config, use it
  if (modelString && modelString.includes(';')) {
    const parsed = parseModelAuthConfig(modelString);
    if (parsed.auth) {
      return parsed.auth;
    }
  }

  // Intelligent defaults based on route type
  switch (routeType) {
    case 'background':
      // Background tasks: prefer API key
      return {
        primary: 'api-key',
        subagentPassthrough: false,
      };

    case 'subagent':
      // Subagents: inherit background behavior
      return {
        primary: 'api-key',
        subagentPassthrough: false,
      };

    case 'think':
    case 'longContext':
    case 'default':
      // Default routes: prefer OAuth with fallback
      return {
        primary: 'oauth',
        fallback: 'api-key',
        subagentPassthrough: true,
      };

    case 'webSearch':
      // Web search: API key only for cost control
      return {
        primary: 'api-key',
        subagentPassthrough: false,
      };

    default:
      return undefined;
  }
}

/**
 * Check if a model string indicates OAuth preference
 */
export function prefersOAuth(modelString: string): boolean {
  const auth = getAuthStrategy('default', modelString);
  return auth?.primary === 'oauth';
}

/**
 * Get fallback authentication method
 */
export function getFallbackAuth(modelString: string): 'oauth' | 'api-key' | 'none' | undefined {
  const auth = getAuthStrategy('default', modelString);
  return auth?.fallback;
}