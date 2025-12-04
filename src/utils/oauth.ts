import { createHash, randomBytes } from "crypto";
import { readFileSync, writeFileSync, unlinkSync, existsSync } from "fs";
import { writeFile } from "fs/promises";
import path from "path";
import { lock } from "proper-lockfile";
import { HOME_DIR } from "../constants";

// Constants
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000; // Refresh 5 minutes before expiry

// Lock file path for cross-process synchronization
const OAUTH_LOCK_FILE = path.join(HOME_DIR, "oauth.lock");

// Token refresh mutex to prevent concurrent refresh (in-process)
let refreshPromise: Promise<OAuthCredentials | null> | null = null;

/**
 * Ensure lock file exists for proper-lockfile
 */
function ensureLockFile(): void {
  if (!existsSync(OAUTH_LOCK_FILE)) {
    writeFileSync(OAUTH_LOCK_FILE, "", { mode: 0o600 });
  }
}

/**
 * Safe unlink - ignores ENOENT errors
 */
function safeUnlink(filePath: string): void {
  try {
    unlinkSync(filePath);
  } catch (e: any) {
    if (e.code !== "ENOENT") {
      throw e;
    }
  }
}

// OAuth Configuration (from claude-code-login)
const OAUTH_CONFIG = {
  clientId: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
  authorizeUrl: "https://claude.ai/oauth/authorize",
  tokenUrl: "https://console.anthropic.com/v1/oauth/token",
  redirectUri: "https://console.anthropic.com/oauth/code/callback",
  scopes: ["org:create_api_key", "user:profile", "user:inference"],
};

// File paths
export const OAUTH_CREDENTIALS_FILE = path.join(HOME_DIR, "oauth.json");
export const OAUTH_STATE_FILE = path.join(HOME_DIR, "oauth_state.json");

// Credential structure (internal use, camelCase)
export interface OAuthCredentials {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix timestamp in milliseconds
  scopes: string[];
}

// Token structure for sharing with Claude Code (snake_case, matches Claude Code's format)
export interface OAuthToken {
  access_token: string;
  refresh_token?: string;
  expires_at?: number; // Unix timestamp in milliseconds
  token_type?: string;
}

// State for PKCE flow
interface OAuthState {
  state: string;
  codeVerifier: string;
  createdAt: number;
}

/**
 * Generate a random string for OAuth state/verifier
 */
function generateRandomString(length: number): string {
  return randomBytes(length).toString("hex");
}

/**
 * Generate base64url encoded string
 */
function base64url(buffer: Buffer): string {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

/**
 * Generate code challenge from verifier (PKCE)
 */
function generateCodeChallenge(verifier: string): string {
  const hash = createHash("sha256").update(verifier).digest();
  return base64url(hash);
}

/**
 * Generate OAuth login URL with PKCE
 */
export function generateLoginUrl(): { url: string; state: string; codeVerifier: string } {
  const state = generateRandomString(32);
  const codeVerifier = base64url(randomBytes(32));
  const codeChallenge = generateCodeChallenge(codeVerifier);

  const params = new URLSearchParams({
    client_id: OAUTH_CONFIG.clientId,
    response_type: "code",
    redirect_uri: OAUTH_CONFIG.redirectUri,
    scope: OAUTH_CONFIG.scopes.join(" "),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  const url = `${OAUTH_CONFIG.authorizeUrl}?${params.toString()}`;

  // Save state for verification with secure permissions (0600)
  const oauthState: OAuthState = {
    state,
    codeVerifier,
    createdAt: Date.now(),
  };
  writeFileSync(OAUTH_STATE_FILE, JSON.stringify(oauthState, null, 2), { mode: 0o600 });

  return { url, state, codeVerifier };
}

/**
 * Parse OAuth callback input (URL or code) and extract code and state
 */
function parseOAuthCallback(input: string): { code: string; state?: string } {
  // Check if input is a URL
  if (input.includes("?") || input.includes("&")) {
    try {
      // Handle full URL or query string
      const searchParams = input.includes("://")
        ? new URL(input).searchParams
        : new URLSearchParams(input.split("?").pop() || input);

      const code = searchParams.get("code");
      const state = searchParams.get("state");

      if (code) {
        return { code, state: state || undefined };
      }
    } catch {
      // Fall through to simple parsing
    }
  }

  // Simple case: just the code (strip fragments and extra params)
  const code = input.split("#")[0]?.split("&")[0] ?? input;
  return { code };
}

/**
 * Exchange authorization code for tokens
 * @param authorizationCode - The authorization code or full callback URL
 */
export async function exchangeCode(authorizationCode: string): Promise<OAuthCredentials | null> {
  const { code, state: returnedState } = parseOAuthCallback(authorizationCode);

  // Load state - use try-catch directly to avoid TOCTOU race
  let stateData: OAuthState;
  try {
    const content = readFileSync(OAUTH_STATE_FILE, "utf-8");
    stateData = JSON.parse(content);
  } catch (e: any) {
    if (e.code === "ENOENT") {
      console.error("OAuth state not found. Please run 'ccr login' first.");
    } else {
      console.error("OAuth state file is corrupted. Please run 'ccr login' again.");
    }
    return null;
  }

  // Validate state data
  if (!stateData.state || !stateData.codeVerifier || !stateData.createdAt) {
    console.error("OAuth state file is invalid. Please run 'ccr login' again.");
    return null;
  }

  // Validate returned state (CSRF protection) - state MUST exist and match
  if (!returnedState || returnedState !== stateData.state) {
    console.error("OAuth state mismatch. Possible CSRF attack or stale login attempt.");
    safeUnlink(OAUTH_STATE_FILE);
    return null;
  }

  // Check if state is expired
  if (Date.now() - stateData.createdAt > OAUTH_STATE_TTL_MS) {
    console.error("OAuth state expired. Please run 'ccr login' again.");
    safeUnlink(OAUTH_STATE_FILE);
    return null;
  }

  try {
    const response = await fetch(OAUTH_CONFIG.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://claude.ai/",
        "Origin": "https://claude.ai",
      },
      body: JSON.stringify({
        grant_type: "authorization_code",
        client_id: OAUTH_CONFIG.clientId,
        code: code,
        redirect_uri: OAUTH_CONFIG.redirectUri,
        code_verifier: stateData.codeVerifier,
        state: stateData.state,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Token exchange failed: ${response.status} ${errorText}`);
      return null;
    }

    let data: any;
    try {
      data = await response.json();
    } catch (e) {
      console.error(`Token exchange: invalid JSON response`);
      return null;
    }

    // Validate required fields
    if (!data.access_token || !data.refresh_token || typeof data.expires_in !== "number") {
      console.error(`Token exchange: missing required fields in response`);
      return null;
    }

    const credentials: OAuthCredentials = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1000,
      scopes: data.scope?.split(" ") || OAUTH_CONFIG.scopes,
    };

    // Save credentials with file lock
    await saveCredentials(credentials);

    // Cleanup state file
    safeUnlink(OAUTH_STATE_FILE);

    return credentials;
  } catch (error: any) {
    console.error(`Token exchange error: ${error.message}`);
    return null;
  }
}

/**
 * Refresh access token using refresh token
 */
export async function refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials | null> {
  try {
    const response = await fetch(OAUTH_CONFIG.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://claude.ai/",
        "Origin": "https://claude.ai",
      },
      body: JSON.stringify({
        grant_type: "refresh_token",
        client_id: OAUTH_CONFIG.clientId,
        refresh_token: credentials.refreshToken,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      // 安全记录错误，不暴露敏感信息
      console.error(`Token refresh failed: ${response.status}`);
      return null;
    }

    let data: any;
    try {
      data = await response.json();
    } catch (e) {
      console.error(`Token refresh: invalid JSON response`);
      return null;
    }

    // Validate required fields (refresh_token may be omitted, reuse existing)
    if (!data.access_token || typeof data.expires_in !== "number") {
      console.error(`Token refresh: missing required fields in response`);
      return null;
    }

    const newCredentials: OAuthCredentials = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || credentials.refreshToken,
      expiresAt: Date.now() + data.expires_in * 1000,
      scopes: data.scope?.split(" ") || credentials.scopes,
    };

    await saveCredentials(newCredentials);
    return newCredentials;
  } catch (error: any) {
    console.error(`Token refresh error: ${error.message}`);
    return null;
  }
}

/**
 * Save credentials to file with secure permissions (0600) and file lock
 */
export async function saveCredentials(credentials: OAuthCredentials): Promise<void> {
  ensureLockFile();
  let release: (() => Promise<void>) | null = null;
  try {
    release = await lock(OAUTH_LOCK_FILE, { retries: { retries: 5, minTimeout: 50, maxTimeout: 300 } });
    await writeFile(OAUTH_CREDENTIALS_FILE, JSON.stringify(credentials, null, 2), { mode: 0o600 });
  } finally {
    if (release) {
      await release();
    }
  }
}

/**
 * Save credentials synchronously (for backward compatibility in CLI)
 */
export function saveCredentialsSync(credentials: OAuthCredentials): void {
  writeFileSync(OAUTH_CREDENTIALS_FILE, JSON.stringify(credentials, null, 2), { mode: 0o600 });
}

/**
 * Load credentials from file
 */
export function loadCredentials(): OAuthCredentials | null {
  try {
    const data = readFileSync(OAUTH_CREDENTIALS_FILE, "utf-8");
    const credentials = JSON.parse(data) as OAuthCredentials;
    // Validate required fields
    if (!credentials.accessToken || !credentials.refreshToken || typeof credentials.expiresAt !== "number") {
      return null;
    }
    return credentials;
  } catch {
    return null;
  }
}

/**
 * Delete credentials file
 */
export function deleteCredentials(): void {
  safeUnlink(OAUTH_CREDENTIALS_FILE);
}

/**
 * Check if credentials are expired (with buffer for early refresh)
 */
export function isExpired(credentials: OAuthCredentials): boolean {
  return Date.now() >= credentials.expiresAt - TOKEN_REFRESH_BUFFER_MS;
}

/**
 * Get valid access token (auto-refresh if needed)
 * Uses both in-process mutex and cross-process file lock
 */
export async function getValidAccessToken(): Promise<string | null> {
  let credentials = loadCredentials();

  if (!credentials) {
    return null;
  }

  // Refresh if expired, with mutex to prevent concurrent refreshes
  if (isExpired(credentials)) {
    // In-process mutex check first
    if (refreshPromise) {
      credentials = await refreshPromise;
    } else {
      // Use file lock for cross-process synchronization
      ensureLockFile();
      let release: (() => Promise<void>) | null = null;
      try {
        release = await lock(OAUTH_LOCK_FILE, { retries: { retries: 5, minTimeout: 100, maxTimeout: 500 } });

        // Re-check after acquiring lock (another process may have refreshed)
        credentials = loadCredentials();
        if (credentials && !isExpired(credentials)) {
          return credentials.accessToken;
        }

        // Create in-process mutex
        const currentCredentials = credentials!;
        refreshPromise = (async () => {
          try {
            return await refreshToken(currentCredentials);
          } finally {
            refreshPromise = null;
          }
        })();
        credentials = await refreshPromise;
      } catch (lockError: any) {
        // If lock fails, fall back to in-process only refresh
        console.warn(`Failed to acquire OAuth lock: ${lockError.message}`);
        if (!credentials) {
          return null;
        }
        const currentCredentials = credentials;
        refreshPromise = (async () => {
          try {
            return await refreshToken(currentCredentials);
          } finally {
            refreshPromise = null;
          }
        })();
        credentials = await refreshPromise;
      } finally {
        if (release) {
          await release();
        }
      }
    }
    if (!credentials) {
      return null;
    }
  }

  return credentials.accessToken;
}

/**
 * Get OAuth status info
 */
export function getOAuthStatus(): {
  hasCredentials: boolean;
  expiresAt?: number;
  isExpired?: boolean;
} {
  const credentials = loadCredentials();
  if (!credentials) {
    return { hasCredentials: false };
  }

  return {
    hasCredentials: true,
    expiresAt: credentials.expiresAt,
    isExpired: isExpired(credentials),
  };
}
