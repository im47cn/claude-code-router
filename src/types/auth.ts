/**
 * Authentication priority configuration for different routing strategies
 * Each route can have a custom authentication strategy with fallback behavior
 */

export type AuthType = 'oauth' | 'api-key' | 'none';

export interface AuthStrategy {
  /** Primary authentication method */
  primary: AuthType;
  /** Fallback authentication method if primary fails (optional) */
  fallback?: AuthType;
}

export interface RouteAuthConfig {
  /** Authentication strategy for default route */
  default?: AuthStrategy;
  /** Authentication strategy for think route */
  think?: AuthStrategy;
  /** Authentication strategy for longContext route */
  longContext?: AuthStrategy;
  /** Authentication strategy for background route */
  background?: AuthStrategy;
  /** Authentication strategy for webSearch route */
  webSearch?: AuthStrategy;
}

/**
 * Default authentication configuration
 * - default/think/longContext: prefer OAuth, fallback to provider API key
 * - background: prefer provider API key
 * - webSearch: prefer OAuth, fallback to provider API key
 */
export const DEFAULT_AUTH_CONFIG: RouteAuthConfig = {
  default: { primary: 'oauth', fallback: 'api-key' },
  think: { primary: 'oauth', fallback: 'api-key' },
  longContext: { primary: 'oauth', fallback: 'api-key' },
  background: { primary: 'api-key' },
  webSearch: { primary: 'oauth', fallback: 'api-key' },
};

/**
 * Route type enumeration for easier routing decisions
 */
export type RouteType = 'default' | 'think' | 'longContext' | 'background' | 'webSearch' | 'subagent';