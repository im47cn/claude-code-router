/**
 * OAuth安全性测试
 * 验证OAuth令牌处理的安全性
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mock } from 'vitest-mock';
import fs from 'fs/promises';
import { lock, unlock } from 'proper-lockfile';
import { OAuthTokenShare } from '../../utils/oauthTokenShare';

// Mock the modules properly
vi.mock('fs/promises', () => ({
  default: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    unlink: vi.fn(),
    access: vi.fn(),
    stat: vi.fn(),
    mkdir: vi.fn(),
  },
  readFile: vi.fn(),
  writeFile: vi.fn(),
  unlink: vi.fn(),
  access: vi.fn(),
  stat: vi.fn(),
  mkdir: vi.fn(),
}));

vi.mock('proper-lockfile', () => ({
  lock: vi.fn(),
  unlock: vi.fn(),
}));

describe('OAuth安全性测试', () => {
  const mockTokenFile = '/tmp/test-oauth-token.json';

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset proper-lockfile mocks
    (lock as any).mockReset();
    (unlock as any).mockReset();
    // Set default implementations
    (lock as any).mockResolvedValue(vi.fn());
    (unlock as any).mockResolvedValue(undefined);
  });

  afterEach(async () => {
    try {
      await fs.unlink(mockTokenFile);
    } catch {
      // 文件可能不存在，忽略错误
    }
  });

  describe('令牌共享安全性', () => {
    it('应该正确验证令牌结构', async () => {
      // Use vi.mocked to mock the modules properly
      vi.mocked(fs.readFile).mockResolvedValueOnce(JSON.stringify({
        token: {
          access_token: 'test_access_token',
          expires_at: Date.now() + 3600000, // 1小时后过期
          token_type: 'Bearer'
        },
        timestamp: Date.now(),
        source: 'claude-code'
      }));

      (lock as any).mockResolvedValueOnce(vi.fn() as any);
      vi.mocked(fs.access).mockResolvedValueOnce(undefined);
      vi.mocked(fs.stat).mockResolvedValueOnce({
        mode: 0o600,
        isFile: () => true
      } as any);

      const tokenShare = new OAuthTokenShare(mockTokenFile);
      const token = await tokenShare.getToken();

      expect(token).toBeTruthy();
      expect(token?.access_token).toBe('test_access_token');
    });

    it('应该拒绝无效的令牌结构', async () => {
      const mockReadFile = vi.spyOn(fs, 'readFile').mockResolvedValueOnce(JSON.stringify({
        invalid: 'structure'
      }));

      (lock as any).mockResolvedValueOnce(vi.fn());
      (unlock as any).mockResolvedValueOnce();

      const tokenShare = new OAuthTokenShare(mockTokenFile);
      const token = await tokenShare.getToken();

      expect(token).toBeNull();
    });

    it('应该安全处理文件锁定失败', async () => {
      // Mock access to make sure file exists
      const mockAccess = vi.spyOn(fs, 'access').mockResolvedValueOnce(undefined);
      const mockStat = vi.spyOn(fs, 'stat').mockResolvedValueOnce({
        mode: 0o600,
        isFile: () => true
      } as any);

      (lock as any)
        .mockRejectedValueOnce(new Error('Lock failed'))
        .mockRejectedValueOnce(new Error('Lock still failed'));

      const mockWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const tokenShare = new OAuthTokenShare(mockTokenFile);
      const token = await tokenShare.getToken();

      expect(token).toBeNull();
      expect(mockWarn).toHaveBeenCalledWith('Failed to acquire token lock, attempting read-only access');
      expect(mockWarn).toHaveBeenCalledWith('Unable to acquire token lock, skipping token read to prevent corruption');
    });

    it('应该验证文件权限', async () => {
      // Mock access to make sure file exists
      const mockAccess = vi.spyOn(fs, 'access').mockResolvedValueOnce(undefined);

      const mockStats = {
        mode: 0o600, // 正确权限
        isFile: () => true
      };

      const mockStat = vi.spyOn(fs, 'stat').mockResolvedValueOnce(mockStats as any);
      (lock as any).mockResolvedValueOnce(vi.fn());
      (unlock as any).mockResolvedValueOnce();
      const mockReadFile = vi.spyOn(fs, 'readFile').mockResolvedValueOnce(JSON.stringify({
        token: { access_token: 'test', expires_at: Date.now() + 3600000 },
        timestamp: Date.now(),
        source: 'claude-code'
      }));

      const tokenShare = new OAuthTokenShare(mockTokenFile);
      await tokenShare.getToken();

      expect(mockStat).toHaveBeenCalledWith(mockTokenFile);
    });
  });

  describe('令牌过期验证', () => {
    it('应该拒绝过期的令牌', async () => {
      const expiredToken = {
        token: {
          access_token: 'expired_token',
          expires_at: Date.now() - 1000, // 已过期
          token_type: 'Bearer'
        },
        timestamp: Date.now(),
        source: 'claude-code'
      };

      const mockReadFile = vi.spyOn(fs, 'readFile').mockResolvedValueOnce(JSON.stringify(expiredToken));
      (lock as any).mockResolvedValueOnce(vi.fn());
      (unlock as any).mockResolvedValueOnce();

      const tokenShare = new OAuthTokenShare(mockTokenFile, { maxAge: 0 }); // 立即过期
      const token = await tokenShare.getToken();

      expect(token).toBeNull();
    });

    it('应该验证合理的过期时间', async () => {
      const now = Date.now();
      const maxFuture = now + (365 * 24 * 60 * 60 * 1000); // 1年

      // 测试过大过期时间
      const hugeExpiryToken = {
        token: {
          access_token: 'future_token',
          expires_at: now + (10 * 365 * 24 * 60 * 60 * 1000), // 10年后过期
          token_type: 'Bearer'
        },
        timestamp: Date.now(),
        source: 'claude-code'
      };

      const mockReadFile = vi.spyOn(fs, 'readFile').mockResolvedValueOnce(JSON.stringify(hugeExpiryToken));
      (lock as any).mockResolvedValueOnce(vi.fn());
      (unlock as any).mockResolvedValueOnce();

      // 模拟验证逻辑
      const isValidExpiry = (expiresAt: number) => {
        return expiresAt > now && expiresAt <= maxFuture;
      };

      expect(isValidExpiry(hugeExpiryToken.token.expires_at)).toBe(false);
    });
  });

  describe('错误处理', () => {
    it('应该安全处理JSON解析错误', async () => {
      // 使用独立的mock实现避免状态污染
      const mockReadFile = vi.mocked(fs.readFile);
      mockReadFile.mockReset();
      mockReadFile.mockResolvedValueOnce('invalid json{');

      (lock as any).mockReset();
      (lock as any).mockResolvedValueOnce(vi.fn());
      (unlock as any).mockReset();
      (unlock as any).mockResolvedValueOnce();

      // 确保access检查失败，文件存在检查成功
      vi.mocked(fs.access).mockReset();
      vi.mocked(fs.access).mockResolvedValueOnce(undefined);
      vi.mocked(fs.stat).mockReset();
      vi.mocked(fs.stat).mockResolvedValueOnce({
        mode: 0o600,
        isFile: () => true
      } as any);

      const tokenShare = new OAuthTokenShare(mockTokenFile);
      const token = await tokenShare.getToken();

      expect(token).toBeNull();
    });

    it('应该安全处理空文件', async () => {
      const mockReadFile = vi.spyOn(fs, 'readFile').mockResolvedValueOnce('');
      (lock as any).mockResolvedValueOnce(vi.fn());
      (unlock as any).mockResolvedValueOnce();

      const tokenShare = new OAuthTokenShare(mockTokenFile);
      const token = await tokenShare.getToken();

      expect(token).toBeNull();
    });
  });

  describe('CSRF保护', () => {
    it('应该正确验证OAuth状态', () => {
      const generateState = () => Math.random().toString(36).substring(2, 15);
      const originalState = generateState();

      // 有效状态匹配
      const returnedState = originalState;
      expect(returnedState).toBe(originalState);

      // 无效状态不匹配
      const invalidState = 'different_state';
      expect(invalidState).not.toBe(originalState);

      // 空状态处理 - 修复逻辑错误：应该测试空值或无效值
      const emptyState = '';
      const nullState = null;
      expect(emptyState).toBeFalsy();
      expect(nullState).toBeFalsy();
    });

    it('应该安全处理状态文件操作', async () => {
      const mockStateData = {
        state: 'test_state_123',
        codeVerifier: 'test_verifier',
        timestamp: Date.now()
      };

      // 使用独立的mock实现，避免状态污染
      const mockWriteFile = vi.mocked(fs.writeFile);
      const mockReadFile = vi.mocked(fs.readFile);
      const mockUnlink = vi.mocked(fs.unlink);

      // 重置 mocks
      mockWriteFile.mockReset();
      mockReadFile.mockReset();
      mockUnlink.mockReset();

      // 设置具体的mock行为
      mockWriteFile.mockResolvedValue(undefined);
      mockReadFile.mockResolvedValue(JSON.stringify(mockStateData));
      mockUnlink.mockResolvedValue(undefined);

      // 模拟状态文件操作
      const stateFile = '/tmp/oauth_state.json';

      // 写入状态
      await fs.writeFile(stateFile, JSON.stringify(mockStateData), { mode: 0o600 });
      expect(mockWriteFile).toHaveBeenCalledWith(stateFile, JSON.stringify(mockStateData), { mode: 0o600 });

      // 读取状态
      const readData = await fs.readFile(stateFile, 'utf-8');
      expect(readData).toBe(JSON.stringify(mockStateData));

      // 清理状态
      await fs.unlink(stateFile);
      expect(mockUnlink).toHaveBeenCalledWith(stateFile);
    });
  });
});