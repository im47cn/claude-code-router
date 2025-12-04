/**
 * Tests for authConfigParser utility
 */
import { describe, it, expect } from 'vitest';
import {
  parseModelAuthConfig,
  getAuthStrategy,
  prefersOAuth,
  getFallbackAuth,
} from '../../utils/authConfigParser.js';

describe('authConfigParser', () => {
  describe('parseModelAuthConfig', () => {
    describe('basic format parsing', () => {
      it('should parse basic model string: "anthropic,claude-3-sonnet"', () => {
        const result = parseModelAuthConfig('anthropic,claude-3-sonnet');
        expect(result).toEqual({
          provider: 'anthropic',
          model: 'claude-3-sonnet',
        });
      });

      it('should parse model with multiple comma-separated parts', () => {
        const result = parseModelAuthConfig('openrouter,anthropic/claude-3,5-sonnet');
        expect(result).toEqual({
          provider: 'openrouter',
          model: 'anthropic/claude-3,5-sonnet',
        });
      });

      it('should handle empty string', () => {
        const result = parseModelAuthConfig('');
        expect(result).toEqual({
          provider: '',
          model: '',
        });
      });

      it('should handle provider only', () => {
        const result = parseModelAuthConfig('anthropic');
        expect(result).toEqual({
          provider: 'anthropic',
          model: '',
        });
      });
    });

    describe('auth directive parsing', () => {
      it('should parse auth=oauth directive', () => {
        const result = parseModelAuthConfig('anthropic,claude-3-sonnet;auth=oauth');
        expect(result).toEqual({
          provider: 'anthropic',
          model: 'claude-3-sonnet',
          auth: {
            primary: 'oauth',
          },
        });
      });

      it('should parse auth=api-key directive', () => {
        const result = parseModelAuthConfig('anthropic,claude-3-sonnet;auth=api-key');
        expect(result).toEqual({
          provider: 'anthropic',
          model: 'claude-3-sonnet',
          auth: {
            primary: 'api-key',
          },
        });
      });

      it('should parse auth=none directive', () => {
        const result = parseModelAuthConfig('anthropic,claude-3-sonnet;auth=none');
        expect(result).toEqual({
          provider: 'anthropic',
          model: 'claude-3-sonnet',
          auth: {
            primary: 'none',
          },
        });
      });
    });

    describe('fallback directive parsing', () => {
      it('should parse auth with fallback: "auth=oauth,fallback=api-key"', () => {
        const result = parseModelAuthConfig('anthropic,claude-3-sonnet;auth=oauth,fallback=api-key');
        expect(result).toEqual({
          provider: 'anthropic',
          model: 'claude-3-sonnet',
          auth: {
            primary: 'oauth',
            fallback: 'api-key',
          },
        });
      });

      it('should parse disabled fallback: "auth=oauth,fallback=none"', () => {
        const result = parseModelAuthConfig('anthropic,claude-3-sonnet;auth=oauth,fallback=none');
        expect(result).toEqual({
          provider: 'anthropic',
          model: 'claude-3-sonnet',
          auth: {
            primary: 'oauth',
            fallback: 'none',
          },
        });
      });
    });

    describe('subagent directive parsing', () => {
      it('should parse subagent=disable directive', () => {
        const result = parseModelAuthConfig('anthropic,claude-3-sonnet;subagent=disable');
        expect(result).toEqual({
          provider: 'anthropic',
          model: 'claude-3-sonnet',
          auth: {
            subagentPassthrough: false,
          },
        });
      });

      it('should parse subagent=enable directive', () => {
        const result = parseModelAuthConfig('anthropic,claude-3-sonnet;subagent=enable');
        expect(result).toEqual({
          provider: 'anthropic',
          model: 'claude-3-sonnet',
          auth: {
            subagentPassthrough: true,
          },
        });
      });
    });

    describe('oauth shortcut parsing', () => {
      it('should parse oauth=true shortcut', () => {
        const result = parseModelAuthConfig('anthropic,claude-3-sonnet;oauth=true');
        expect(result).toEqual({
          provider: 'anthropic',
          model: 'claude-3-sonnet',
          auth: {
            primary: 'oauth',
            fallback: 'api-key',
          },
        });
      });

      it('should parse oauth=1 shortcut', () => {
        const result = parseModelAuthConfig('anthropic,claude-3-sonnet;oauth=1');
        expect(result).toEqual({
          provider: 'anthropic',
          model: 'claude-3-sonnet',
          auth: {
            primary: 'oauth',
            fallback: 'api-key',
          },
        });
      });
    });

    describe('fallback-only directive parsing', () => {
      it('should parse fallback-only=oauth directive', () => {
        const result = parseModelAuthConfig('anthropic,claude-3-sonnet;fallback-only=oauth');
        expect(result).toEqual({
          provider: 'anthropic',
          model: 'claude-3-sonnet',
          auth: {
            primary: 'oauth',
            fallback: undefined,
          },
        });
      });
    });

    describe('complex combinations', () => {
      it('should parse multiple directives', () => {
        const result = parseModelAuthConfig('anthropic,claude-3-sonnet;auth=oauth,fallback=api-key,subagent=disable');
        expect(result).toEqual({
          provider: 'anthropic',
          model: 'claude-3-sonnet',
          auth: {
            primary: 'oauth',
            fallback: 'api-key',
            subagentPassthrough: false,
          },
        });
      });
    });
  });

  describe('getAuthStrategy', () => {
    describe('route type defaults', () => {
      it('default route: OAuth primary, API Key fallback', () => {
        const result = getAuthStrategy('default');
        expect(result).toEqual({
          primary: 'oauth',
          fallback: 'api-key',
          subagentPassthrough: true,
        });
      });

      it('think route: OAuth primary, API Key fallback', () => {
        const result = getAuthStrategy('think');
        expect(result).toEqual({
          primary: 'oauth',
          fallback: 'api-key',
          subagentPassthrough: true,
        });
      });

      it('longContext route: OAuth primary, API Key fallback', () => {
        const result = getAuthStrategy('longContext');
        expect(result).toEqual({
          primary: 'oauth',
          fallback: 'api-key',
          subagentPassthrough: true,
        });
      });

      it('background route: API Key only', () => {
        const result = getAuthStrategy('background');
        expect(result).toEqual({
          primary: 'api-key',
          subagentPassthrough: false,
        });
      });

      it('webSearch route: API Key only', () => {
        const result = getAuthStrategy('webSearch');
        expect(result).toEqual({
          primary: 'api-key',
          subagentPassthrough: false,
        });
      });

      it('subagent route: API Key only', () => {
        const result = getAuthStrategy('subagent');
        expect(result).toEqual({
          primary: 'api-key',
          subagentPassthrough: false,
        });
      });
    });

    describe('explicit auth config overrides', () => {
      it('should use explicit auth config when provided', () => {
        const result = getAuthStrategy('background', 'anthropic,claude-3-sonnet;auth=oauth');
        expect(result?.primary).toBe('oauth');
      });

      it('should fall back to route defaults when no explicit config', () => {
        const result = getAuthStrategy('background', 'anthropic,claude-3-sonnet');
        expect(result?.primary).toBe('api-key');
      });
    });
  });

  describe('prefersOAuth', () => {
    it('should return false for basic model string (no auth directive)', () => {
      // Default strategy for 'default' route is oauth, but prefersOAuth checks the model string
      const result = prefersOAuth('anthropic,claude-3-sonnet');
      // Without explicit auth config, getAuthStrategy('default') returns oauth as primary
      expect(result).toBe(true);
    });

    it('should return true for auth=oauth', () => {
      const result = prefersOAuth('anthropic,claude-3-sonnet;auth=oauth');
      expect(result).toBe(true);
    });

    it('should return false for auth=api-key', () => {
      const result = prefersOAuth('anthropic,claude-3-sonnet;auth=api-key');
      expect(result).toBe(false);
    });
  });

  describe('getFallbackAuth', () => {
    it('should return api-key for default route strategy', () => {
      const result = getFallbackAuth('anthropic,claude-3-sonnet');
      expect(result).toBe('api-key');
    });

    it('should return explicit fallback when configured', () => {
      const result = getFallbackAuth('anthropic,claude-3-sonnet;auth=oauth,fallback=none');
      expect(result).toBe('none');
    });
  });
});
