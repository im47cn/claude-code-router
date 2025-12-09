import fs from "node:fs/promises";
import path from "node:path";
import { HOME_DIR } from "../constants";

/**
 * Enhanced cleanup options for different log types
 */
interface CleanupOptions {
  legacyLogs?: {
    maxFiles?: number;
    maxAgeDays?: number;
  };
  sessionLogs?: {
    maxAgeDays?: number;
    maxFilesPerSession?: number;
    maxTotalSize?: string; // e.g., "500M"
  };
  archive?: {
    enabled?: boolean;
    maxAgeDays?: number;
    compress?: boolean;
  };
}

/**
 * Cleans up old log files with enhanced options
 * @param options - Cleanup configuration options
 */
export async function cleanupLogFiles(options: number | CleanupOptions = 9): Promise<void> {
  const cleanupOptions: CleanupOptions = typeof options === 'number' 
    ? { legacyLogs: { maxFiles: options } }
    : { 
        legacyLogs: { maxFiles: 9, maxAgeDays: 30 },
        sessionLogs: { maxAgeDays: 7, maxFilesPerSession: 5, maxTotalSize: '1G' },
        archive: { enabled: true, maxAgeDays: 7, compress: false },
        ...options 
      };

  await cleanupLegacyLogFiles(cleanupOptions.legacyLogs!);
  await cleanupSessionLogFiles(cleanupOptions.sessionLogs!);
  
  if (cleanupOptions.archive?.enabled) {
    await archiveOldLogs(cleanupOptions.archive!);
  }
}

/**
 * Cleans up legacy log files (ccr-*.log format)
 */
async function cleanupLegacyLogFiles(options: NonNullable<CleanupOptions['legacyLogs']>): Promise<void> {
  try {
    const logsDir = path.join(HOME_DIR, "logs");
    
    // Check if logs directory exists
    try {
      await fs.access(logsDir);
    } catch {
      // Logs directory doesn't exist, nothing to clean up
      return;
    }
    
    // Read all files in the logs directory
    const files = await fs.readdir(logsDir);
    
    // Filter for legacy log files (files starting with 'ccr-' and ending with '.log', not in sessions subdirectory)
    const logFiles = files
      .filter(file => 
        file.startsWith('ccr-') && 
        file.endsWith('.log') &&
        !file.includes('-') // Exclude session files which have session IDs
      )
      .map(file => ({
        name: file,
        path: path.join(logsDir, file),
        mtime: fs.stat(path.join(logsDir, file)).then(stat => stat.mtime)
      }));
    
    // Wait for all stat operations
    const logFilesWithStats = await Promise.all(
      logFiles.map(async file => ({
        ...file,
        mtime: await file.mtime
      }))
    );
    
    // Sort by modification time (newest first)
    logFilesWithStats.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
    
    const now = new Date();
    const filesToDelete: string[] = [];
    
    // Check for files exceeding maxFiles limit
    if (logFilesWithStats.length > (options.maxFiles || 9)) {
      const excessFiles = logFilesWithStats.slice(options.maxFiles || 9);
      filesToDelete.push(...excessFiles.map(f => f.path));
    }
    
    // Check for files exceeding maxAgeDays
    if (options.maxAgeDays) {
      const cutoffDate = new Date(now.getTime() - options.maxAgeDays * 24 * 60 * 60 * 1000);
      const oldFiles = logFilesWithStats.filter(f => f.mtime < cutoffDate);
      filesToDelete.push(...oldFiles.map(f => f.path));
    }
    
    // Delete unique files
    const uniqueFilesToDelete = [...new Set(filesToDelete)];
    for (const filePath of uniqueFilesToDelete) {
      try {
        await fs.unlink(filePath);
        console.log(`Deleted legacy log file: ${path.basename(filePath)}`);
      } catch (error) {
        console.warn(`Failed to delete log file ${filePath}:`, error);
      }
    }
  } catch (error) {
    console.warn("Failed to clean up legacy log files:", error);
  }
}

/**
 * Cleans up session log files
 */
async function cleanupSessionLogFiles(options: NonNullable<CleanupOptions['sessionLogs']>): Promise<void> {
  try {
    const sessionsDir = path.join(HOME_DIR, "logs", "sessions");
    
    // Check if sessions directory exists
    try {
      await fs.access(sessionsDir);
    } catch {
      // Sessions directory doesn't exist, nothing to clean up
      return;
    }
    
    // Read all session log files
    const files = await fs.readdir(sessionsDir);
    const sessionFiles = files.filter(file => file.endsWith('.log'));
    
    const now = new Date();
    const cutoffDate = new Date(now.getTime() - (options.maxAgeDays || 7) * 24 * 60 * 60 * 1000);
    
    // Group files by session ID
    const sessionGroups = new Map<string, string[]>();
    for (const file of sessionFiles) {
      const sessionId = file.split('-')[0]; // Extract session ID from filename
      if (!sessionGroups.has(sessionId)) {
        sessionGroups.set(sessionId, []);
      }
      sessionGroups.get(sessionId)!.push(file);
    }
    
    // Clean up each session's files
    for (const [sessionId, files] of sessionGroups) {
      try {
        // Get file stats and sort by modification time
        const filesWithStats = await Promise.all(
          files.map(async file => {
            const filePath = path.join(sessionsDir, file);
            const stat = await fs.stat(filePath);
            return { file, filePath, mtime: stat.mtime, size: stat.size };
          })
        );
        
        filesWithStats.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
        
        // Delete old files
        const oldFiles = filesWithStats.filter(f => f.mtime < cutoffDate);
        for (const { filePath, file } of oldFiles) {
          try {
            await fs.unlink(filePath);
            console.log(`Deleted old session log: ${file}`);
          } catch (error) {
            console.warn(`Failed to delete session log ${filePath}:`, error);
          }
        }
        
        // Keep only the most recent files per session (if specified)
        const remainingFiles = filesWithStats.filter(f => f.mtime >= cutoffDate);
        const maxFilesPerSession = options.maxFilesPerSession || 5;
        if (remainingFiles.length > maxFilesPerSession) {
          const excessFiles = remainingFiles.slice(maxFilesPerSession);
          for (const { filePath, file } of excessFiles) {
            try {
              await fs.unlink(filePath);
              console.log(`Deleted excess session log: ${file}`);
            } catch (error) {
              console.warn(`Failed to delete excess session log ${filePath}:`, error);
            }
          }
        }
      } catch (error) {
        console.warn(`Failed to clean up session ${sessionId}:`, error);
      }
    }
  } catch (error) {
    console.warn("Failed to clean up session log files:", error);
  }
}

/**
 * Archives old log files
 */
async function archiveOldLogs(options: NonNullable<CleanupOptions['archive']>): Promise<void> {
  try {
    const archiveDir = path.join(HOME_DIR, "logs", "archive");
    const cutoffDate = new Date(Date.now() - (options.maxAgeDays || 7) * 24 * 60 * 60 * 1000);
    
    // Ensure archive directory exists
    try {
      await fs.access(archiveDir);
    } catch {
      await fs.mkdir(archiveDir, { recursive: true });
    }
    
    // Archive legacy logs
    const logsDir = path.join(HOME_DIR, "logs");
    const files = await fs.readdir(logsDir);
    
    for (const file of files) {
      if (file.endsWith('.log') && !file.includes('session')) {
        const filePath = path.join(logsDir, file);
        const stat = await fs.stat(filePath);
        
        if (stat.mtime < cutoffDate) {
          const archivePath = path.join(archiveDir, file);
          try {
            await fs.rename(filePath, archivePath);
            console.log(`Archived log file: ${file}`);
          } catch (error) {
            console.warn(`Failed to archive log file ${file}:`, error);
          }
        }
      }
    }
  } catch (error) {
    console.warn("Failed to archive log files:", error);
  }
}

/**
 * Get disk usage statistics for log files
 */
export async function getLogDiskUsage(): Promise<{
  totalSize: number;
  legacyLogs: { size: number; count: number };
  sessionLogs: { size: number; count: number };
  archiveLogs: { size: number; count: number };
}> {
  const result = {
    totalSize: 0,
    legacyLogs: { size: 0, count: 0 },
    sessionLogs: { size: 0, count: 0 },
    archiveLogs: { size: 0, count: 0 }
  };

  try {
    const logsDir = path.join(HOME_DIR, "logs");
    
    // Legacy logs
    try {
      const files = await fs.readdir(logsDir);
      for (const file of files) {
        if (file.endsWith('.log') && !file.includes('session')) {
          const filePath = path.join(logsDir, file);
          const stat = await fs.stat(filePath);
          result.legacyLogs.size += stat.size;
          result.legacyLogs.count++;
          result.totalSize += stat.size;
        }
      }
    } catch (error) {
      // Directory doesn't exist
    }

    // Session logs
    try {
      const sessionsDir = path.join(logsDir, "sessions");
      const files = await fs.readdir(sessionsDir);
      for (const file of files) {
        if (file.endsWith('.log')) {
          const filePath = path.join(sessionsDir, file);
          const stat = await fs.stat(filePath);
          result.sessionLogs.size += stat.size;
          result.sessionLogs.count++;
          result.totalSize += stat.size;
        }
      }
    } catch (error) {
      // Directory doesn't exist
    }

    // Archive logs
    try {
      const archiveDir = path.join(logsDir, "archive");
      const files = await fs.readdir(archiveDir);
      for (const file of files) {
        if (file.endsWith('.log')) {
          const filePath = path.join(archiveDir, file);
          const stat = await fs.stat(filePath);
          result.archiveLogs.size += stat.size;
          result.archiveLogs.count++;
          result.totalSize += stat.size;
        }
      }
    } catch (error) {
      // Directory doesn't exist
    }
  } catch (error) {
    console.warn("Failed to get log disk usage:", error);
  }

  return result;
}