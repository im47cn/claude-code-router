import pino from 'pino';
import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { HOME_DIR } from '../constants';

export interface SessionLogConfig {
  enabled: boolean;
  retentionDays: number;
  maxFilesPerSession: number;
  maxSizePerFile: string;
  includeCommandName: boolean;
}

export interface SessionInfo {
  sessionId: string;
  commandName?: string;
  startTime: Date;
}

export class SessionLoggerManager {
  private sessions: Map<string, pino.Logger> = new Map();
  private sessionInfo: Map<string, SessionInfo> = new Map();
  private config: SessionLogConfig;
  private sessionsDir: string;
  private legacyDir: string;

  constructor(config: SessionLogConfig) {
    this.config = config;
    this.sessionsDir = join(HOME_DIR, 'logs', 'sessions');
    this.legacyDir = join(HOME_DIR, 'logs', 'legacy');
    
    // Ensure directories exist
    this.ensureDirectoryExists(this.sessionsDir);
    this.ensureDirectoryExists(this.legacyDir);
  }

  private ensureDirectoryExists(dir: string): void {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Generate filename for session log
   * Format: {sessionId}-{yyyyMMdd}-{HHmmss}[-{commandName}].log
   */
  private generateSessionFilename(sessionInfo: SessionInfo): string {
    const { sessionId, commandName, startTime } = sessionInfo;
    
    const pad = (num: number) => (num > 9 ? "" : "0") + num;
    const dateStr = `${startTime.getFullYear()}${pad(startTime.getMonth() + 1)}${pad(startTime.getDate())}`;
    const timeStr = `${pad(startTime.getHours())}${pad(startTime.getMinutes())}${pad(startTime.getSeconds())}`;
    
    const baseName = `${sessionId}-${dateStr}-${timeStr}`;
    const commandSuffix = this.config.includeCommandName && commandName ? `-${commandName}` : '';
    
    return `${baseName}${commandSuffix}.log`;
  }

  /**
   * Detect command type from request
   */
  private detectCommandType(req: any): string | undefined {
    // Check for slash commands in user message
    if (req.body?.messages) {
      const userMessage = req.body.messages.find((msg: any) => msg.role === 'user');
      if (userMessage?.content) {
        const content = typeof userMessage.content === 'string' 
          ? userMessage.content 
          : (userMessage.content as any[])?.find((part: any) => part.type === 'text')?.text;
          
        if (content) {
          // Look for slash commands like /yee-rd, /task, etc.
          const slashMatch = content.match(/^\/([a-zA-Z0-9_-]+)/);
          if (slashMatch) {
            return slashMatch[1];
          }
        }
      }
    }

    // Check request headers or metadata for command information
    if (req.headers?.['x-cli-command']) {
      return req.headers['x-cli-command'];
    }

    // Check in metadata
    if (req.body?.metadata?.command) {
      return req.body.metadata.command;
    }

    return undefined;
  }

  /**
   * Get or create session logger
   */
  public getSessionLogger(req: any): pino.Logger | null {
    if (!this.config.enabled) {
      return null;
    }

    // Extract session ID from request
    let sessionId: string | undefined;
    
    // Method 1: From metadata.user_id (format: {prefix}_session_{sessionId})
    if (req.body?.metadata?.user_id) {
      const parts = req.body.metadata.user_id.split('_session_');
      if (parts.length > 1) {
        sessionId = parts[1];
      }
    }

    // Method 2: From existing sessionId property
    if (!sessionId && req.sessionId) {
      sessionId = req.sessionId;
    }

    // Method 3: From headers
    if (!sessionId && req.headers?.['x-session-id']) {
      sessionId = req.headers['x-session-id'];
    }

    // Method 4: Generate unique session ID for new requests
    if (!sessionId) {
      sessionId = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    // Return existing logger if available
    if (this.sessions.has(sessionId)) {
      return this.sessions.get(sessionId)!;
    }

    // Create new session logger
    const commandName = this.detectCommandType(req);
    const sessionInfo: SessionInfo = {
      sessionId,
      commandName,
      startTime: new Date()
    };

    const filename = this.generateSessionFilename(sessionInfo);
    const filepath = join(this.sessionsDir, filename);

    // Create logger for this session
    const logger = pino({
      level: 'debug',
      base: {
        sessionId,
        commandName,
        sessionStart: sessionInfo.startTime.toISOString(),
        pid: process.pid,
        hostname: require('os').hostname()
      }
    }, createWriteStream(filepath));

    // Store stream reference for cleanup
    (logger as any)._stream = createWriteStream(filepath);

    // Store session info and logger
    this.sessionInfo.set(sessionId, sessionInfo);
    this.sessions.set(sessionId, logger);

    // Log session start
    logger.info({
      event: 'session_start',
      sessionId,
      commandName,
      reqId: req.id || req.reqId,
      userAgent: req.headers?.['user-agent'],
      url: req.url
    }, 'New session started');

    return logger;
  }

  /**
   * End a session and cleanup resources
   */
  public endSession(sessionId: string): void {
    const logger = this.sessions.get(sessionId);
    const sessionInfo = this.sessionInfo.get(sessionId);

    if (logger && sessionInfo) {
      const duration = Date.now() - sessionInfo.startTime.getTime();
      
      logger.info({
        event: 'session_end',
        sessionId,
        duration,
        sessionEnd: new Date().toISOString()
      }, 'Session ended');

      // Close the logger stream
      const stream = (logger as any)._stream;
      if (stream && typeof stream.end === 'function') {
        stream.end();
      }
    }

    this.sessions.delete(sessionId);
    this.sessionInfo.delete(sessionId);
  }

  /**
   * Get all active sessions
   */
  public getActiveSessions(): SessionInfo[] {
    return Array.from(this.sessionInfo.values());
  }

  /**
   * Get session info by ID
   */
  public getSessionInfo(sessionId: string): SessionInfo | undefined {
    return this.sessionInfo.get(sessionId);
  }

  /**
   * Clean up old session log files
   */
  public async cleanup(): Promise<void> {
    // This will be implemented later with enhanced cleanup logic
    console.log('Session log cleanup not yet implemented');
  }

  /**
   * Update configuration
   */
  public updateConfig(newConfig: Partial<SessionLogConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * Get current configuration
   */
  public getConfig(): SessionLogConfig {
    return { ...this.config };
  }
}

// Default configuration
export const DEFAULT_SESSION_LOG_CONFIG: SessionLogConfig = {
  enabled: true,
  retentionDays: 7,
  maxFilesPerSession: 5,
  maxSizePerFile: '10M',
  includeCommandName: true
};