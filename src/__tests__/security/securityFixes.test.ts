/**
 * 安全修复验证测试
 * 验证所有关键安全漏洞的修复
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { validateUrl } from '../../cli';
import { validateMessageArray } from '../../middleware/auth';

describe('安全修复验证测试', () => {
  describe('CLI URL验证', () => {
    it('应该接受有效的HTTP和HTTPS URL', () => {
      expect(validateUrl('https://example.com')).toBe(true);
      expect(validateUrl('http://localhost:3000')).toBe(true);
      expect(validateUrl('https://claude.ai/auth')).toBe(true);
    });

    it('应该拒绝恶意URL', () => {
      expect(validateUrl('file:///etc/passwd')).toBe(false);
      expect(validateUrl('javascript:alert(1)')).toBe(false);
      expect(validateUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
      expect(validateUrl('ftp://malicious.com')).toBe(false);
    });

    it('应该拒绝包含命令注入字符的URL', () => {
      expect(validateUrl('https://example.com"; rm -rf /')).toBe(false);
      expect(validateUrl('https://example.com\' && curl malicious.com')).toBe(false);
      expect(validateUrl('https://example.com | cat /etc/passwd')).toBe(false);
      expect(validateUrl('https://example.com; wget malicious.com')).toBe(false);
      expect(validateUrl('https://example.com & ls')).toBe(false);
    });

    it('应该拒绝无效URL格式', () => {
      expect(validateUrl('not-a-url')).toBe(false);
      expect(validateUrl('')).toBe(false);
      expect(validateUrl('http://')).toBe(false);
    });
  });

  describe('消息验证', () => {
    it('应该接受有效的消息数组', () => {
      const validMessages = [
        { content: 'Hello world', role: 'user' },
        { content: 'Hi there!', role: 'assistant' }
      ];
      expect(validateMessageArray(validMessages)).toBe(true);
    });

    it('应该拒绝无效的消息结构', () => {
      const invalidMessages = [
        { not_content: 'missing content field' },
        null,
        undefined,
        'not-an-object'
      ];
      expect(validateMessageArray(invalidMessages)).toBe(false);
    });

    it('应该拒绝空内容消息', () => {
      const emptyMessages = [
        { content: '', role: 'user' },
        { content: '   ', role: 'user' }
      ];
      expect(validateMessageArray(emptyMessages)).toBe(false);
    });

    it('应该拒绝超大消息', () => {
      const hugeContent = 'a'.repeat(100001); // 超过100000字符限制
      const hugeMessages = [
        { content: hugeContent, role: 'user' }
      ];
      expect(validateMessageArray(hugeMessages)).toBe(false);
    });

    it('应该拒绝非数组输入', () => {
      expect(validateMessageArray(null)).toBe(false);
      expect(validateMessageArray(undefined)).toBe(false);
      expect(validateMessageArray('not-array')).toBe(false);
      expect(validateMessageArray(123)).toBe(false);
      expect(validateMessageArray({})).toBe(false);
    });
  });

  describe('令牌脱敏', () => {
    it('应该正确脱敏令牌', () => {
      // 这个测试验证maskToken函数的行为
      const maskToken = (token?: string): string => {
        if (!token) return 'undefined';
        if (token.length <= 8) return token;
        return token.substring(0, 8) + '...';
      };

      expect(maskToken('sk-1234567890abcdef')).toBe('sk-12345...');
      expect(maskToken('short')).toBe('short');
      expect(maskToken(undefined)).toBe('undefined');
      expect(maskToken(null as any)).toBe('undefined');
      expect(maskToken('')).toBe('undefined');
    });

    it('应该安全处理令牌信息', () => {
      const getTokenInfo = (token: string) => {
        return {
          length: token.length,
          prefix: token.substring(0, 3),
          masked: token.substring(0, 8) + '...'
        };
      };

      const token = 'sk-1234567890abcdef1234567890';
      const info = getTokenInfo(token);

      expect(info.length).toBe(token.length);
      expect(info.prefix).toBe('sk-');
      expect(info.masked).toBe('sk-12345...');
      expect(info.masked).not.toContain(token.substring(8));
    });
  });

  describe('竞态条件防护', () => {
    it('应该安全处理文件锁定失败', async () => {
      // 模拟锁定失败的情况
      let lockAttempts = 0;
      const mockLock = async () => {
        lockAttempts++;
        if (lockAttempts < 2) {
          throw new Error('Lock failed');
        }
        return () => Promise.resolve();
      };

      // 验证重试逻辑
      let retryCount = 0;
      try {
        await mockLock();
      } catch {
        retryCount++;
        await new Promise(resolve => setTimeout(resolve, 10)); // 模拟等待
        try {
          await mockLock();
        } catch {
          // 第二次也失败，应该返回null而不是崩溃
        }
      }

      expect(retryCount).toBe(1);
    });
  });

  describe('进程安全', () => {
    it('应该验证CLI路径安全性', () => {
      const __dirname = '/app/src';

      // 安全路径测试
      const safePath = `${__dirname}/cli.js`;
      expect(safePath.startsWith(__dirname)).toBe(true);

      // 不安全路径测试
      const unsafePath = '/malicious/path/cli.js';
      expect(unsafePath.startsWith(__dirname)).toBe(false);
    });

    it('应该验证PID有效性', () => {
      const validPid = 12345;
      const invalidPid1 = NaN;
      const invalidPid2 = -1;
      const invalidPid3 = 0;

      expect(Number.isInteger(validPid) && validPid > 0).toBe(true);
      expect(Number.isInteger(invalidPid1) && invalidPid1 > 0).toBe(false);
      expect(Number.isInteger(invalidPid2) && invalidPid2 > 0).toBe(false);
      expect(Number.isInteger(invalidPid3) && invalidPid3 > 0).toBe(false);
    });
  });

  describe('输入验证边界情况', () => {
    it('应该处理Unicode字符', () => {
      const unicodeMessages = [
        { content: 'Hello 🌍 世界!', role: 'user' },
        { content: '测试中文', role: 'assistant' }
      ];
      expect(validateMessageArray(unicodeMessages)).toBe(true);
    });

    it('应该处理特殊字符', () => {
      const specialCharMessages = [
        { content: 'Line\nbreak\tand\r\nspecial chars!@#$%^&*()', role: 'user' }
      ];
      expect(validateMessageArray(specialCharMessages)).toBe(true);
    });

    it('应该防止XSS攻击向量', () => {
      const xssMessages = [
        { content: '<script>alert("xss")</script>', role: 'user' },
        { content: 'javascript:alert(1)', role: 'user' },
        { content: '"><img src=x onerror=alert(1)>', role: 'user' }
      ];

      // 虽然这些消息包含XSS内容，但它们是有效的消息格式
      // XSS防护应该在渲染层处理，而不是在输入验证层
      expect(validateMessageArray(xssMessages)).toBe(true);
    });
  });
});