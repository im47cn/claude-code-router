import jwt from "jsonwebtoken";
import { db } from "../db/client";
import { logger } from "../utils/logger";
import { randomUUID } from "crypto";
import { AuthResult, User } from "../types/auth";

export interface FeishuUserInfo {
  user_id: string;
  name: string;
  avatar_url?: string;
  email?: string;
  mobile?: string;
  tenant_key?: string;
}

export interface FeishuTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope?: string;
}


export class FeishuAuthService {
  private readonly appId: string;
  private readonly appSecret: string;
  private readonly redirectUri: string;
  private readonly baseUrl = "https://open.feishu.cn";

  constructor() {
    this.appId = process.env.FEISHU_APP_ID || "";
    this.appSecret = process.env.FEISHU_APP_SECRET || "";
    this.redirectUri =
      process.env.FEISHU_REDIRECT_URI ||
      "http://localhost:3000/auth/feishu/callback";

    if (!this.appId || !this.appSecret) {
      logger.warn("飞书OAuth配置不完整");
    }
  }

  /**
   * 生成飞书OAuth授权URL
   */
  generateAuthUrl(state?: string): string {
    const params = new URLSearchParams({
      client_id: this.appId,
      redirect_uri: this.redirectUri,
      response_type: "code",
      scope: "contact:user.base:readonly",
      state: state || randomUUID(),
    });

    return `${this.baseUrl}/open-apis/authen/v3/authorize?${params.toString()}`;
  }

  /**
   * 使用授权码获取访问令牌
   */
  async exchangeCodeForToken(
    code: string,
  ): Promise<FeishuTokenResponse | null> {
    try {
      // 添加10秒超时设置
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(
        `${this.baseUrl}/open-apis/authen/v3/access_token`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            grant_type: "authorization_code",
            client_id: this.appId,
            client_secret: this.appSecret,
            code,
            redirect_uri: this.redirectUri,
          }),
          signal: controller.signal,
        },
      );

      clearTimeout(timeoutId);

      const data = await response.json();

      if (data.code === 0) {
        return data.data as FeishuTokenResponse;
      } else {
        logger.error("飞书授权码交换失败", {
          code: data.code,
          message: data.msg,
        });
        return null;
      }
    } catch (error) {
      logger.error("飞书授权码交换异常", { error });
      return null;
    }
  }

  /**
   * 获取用户信息
   */
  async getUserInfo(accessToken: string): Promise<FeishuUserInfo | null> {
    try {
      // 添加10秒超时设置
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(
        `${this.baseUrl}/open-apis/authen/v1/user_info`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
          signal: controller.signal,
        },
      );

      clearTimeout(timeoutId);

      const data = await response.json();

      if (data.code === 0) {
        return data.data as FeishuUserInfo;
      } else {
        logger.error("获取飞书用户信息失败", {
          code: data.code,
          message: data.msg,
        });
        return null;
      }
    } catch (error) {
      logger.error("获取飞书用户信息异常", { error });
      return null;
    }
  }

  /**
   * 通过飞书用户信息进行认证
   */
  async authenticateWithFeishu(code: string): Promise<AuthResult & { sessionToken?: string }> {
    try {
      // 1. 使用授权码获取访问令牌
      const tokenResponse = await this.exchangeCodeForToken(code);
      if (!tokenResponse) {
        return { success: false, error: "授权码交换失败" };
      }

      // 2. 使用访问令牌获取用户信息
      const userInfo = await this.getUserInfo(tokenResponse.access_token);
      if (!userInfo) {
        return { success: false, error: "获取用户信息失败" };
      }

      // 3. 查找或创建用户
      const user = await this.findOrCreateUser(userInfo);
      if (!user) {
        return { success: false, error: "用户创建失败" };
      }

      // 4. 更新用户身份信息
      await this.updateUserIdentity(user.id, userInfo, tokenResponse);

      // 5. 生成JWT会话令牌
      const sessionToken = this.generateSessionToken(user.id);

      logger.info("飞书用户认证成功", {
        userId: user.id,
        feishuUserId: userInfo.user_id,
        name: userInfo.name,
      });

      return {
        success: true,
        user: {
          id: user.id,
          name: user.name,
          avatarUrl: user.avatarUrl || undefined,
          isAdmin: user.isAdmin,
          isActive: user.isActive,
        },
        sessionToken,
      };
    } catch (error) {
      logger.error("飞书认证失败", { error });
      return { success: false, error: "认证过程异常" };
    }
  }

  /**
   * 查找或创建用户
   */
  private async findOrCreateUser(feishuUserInfo: FeishuUserInfo): Promise<User | null> {
    try {
      // 1. 查找是否已存在飞书身份
      const existingIdentity = await db.userIdentity.findUnique({
        where: {
          provider_providerId: {
            provider: "feishu",
            providerId: feishuUserInfo.user_id,
          },
        },
        include: {
          user: true,
        },
      });

      if (existingIdentity) {
        // 用户已存在，更新用户信息
        const updatedUser = await db.user.update({
          where: { id: existingIdentity.userId },
          data: {
            name: feishuUserInfo.name,
            avatarUrl: feishuUserInfo.avatar_url,
            updatedAt: new Date(),
          },
        });

        return updatedUser;
      }

      // 2. 创建新用户
      const newUser = await db.user.create({
        data: {
          id: randomUUID(),
          name: feishuUserInfo.name,
          avatarUrl: feishuUserInfo.avatar_url,
          isActive: true,
          isAdmin: false, // 默认不是管理员
        },
      });

      logger.info("新用户创建成功", {
        userId: newUser.id,
        feishuUserId: feishuUserInfo.user_id,
        name: feishuUserInfo.name,
      });

      return newUser;
    } catch (error) {
      logger.error("查找或创建用户失败", { error, feishuUserInfo });
      return null;
    }
  }

  /**
   * 更新用户身份信息
   */
  private async updateUserIdentity(
    userId: string,
    feishuUserInfo: FeishuUserInfo,
    tokenResponse: FeishuTokenResponse,
  ) {
    try {
      const expiresAt = new Date(Date.now() + tokenResponse.expires_in * 1000);

      await db.userIdentity.upsert({
        where: {
          provider_providerId: {
            provider: "feishu",
            providerId: feishuUserInfo.user_id,
          },
        },
        update: {
          accessToken: tokenResponse.access_token,
          refreshToken: tokenResponse.refresh_token,
          expiresAt,
          updatedAt: new Date(),
        },
        create: {
          id: randomUUID(),
          userId,
          provider: "feishu",
          providerId: feishuUserInfo.user_id,
          accessToken: tokenResponse.access_token,
          refreshToken: tokenResponse.refresh_token,
          expiresAt,
        },
      });
    } catch (error) {
      logger.error("更新用户身份信息失败", { error, userId, feishuUserInfo });
      // 不抛出错误，因为这不是关键路径
    }
  }

  /**
   * 生成JWT会话令牌
   */
  private generateSessionToken(userId: string): string {
    const jwtSecret = process.env.JWT_SECRET;
    const jwtExpiresIn = process.env.JWT_EXPIRES_IN || "7d";

    if (!jwtSecret) {
      throw new Error("JWT_SECRET environment variable is required");
    }

    return jwt.sign({ userId }, jwtSecret, {
      expiresIn: jwtExpiresIn,
    } as jwt.SignOptions);
  }

  /**
   * 验证JWT会话令牌
   */
  verifySessionToken(token: string): { userId: string } | null {
    try {
      const jwtSecret = process.env.JWT_SECRET;

      if (!jwtSecret) {
        logger.error("JWT_SECRET environment variable is not configured");
        return null;
      }

      const decoded = jwt.verify(token, jwtSecret) as { userId: string };
      return decoded;
    } catch (error) {
      logger.warn("JWT令牌验证失败", { error });
      return null;
    }
  }

  /**
   * 检查服务是否可用
   */
  isConfigured(): boolean {
    return !!(this.appId && this.appSecret);
  }

  /**
   * 刷新访问令牌
   */
  async refreshAccessToken(refreshToken: string): Promise<string | null> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(
        `${this.baseUrl}/open-apis/authen/v3/refresh_access_token`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            grant_type: "refresh_token",
            refresh_token: refreshToken,
          }),
          signal: controller.signal,
        },
      );

      clearTimeout(timeoutId);

      const data = await response.json();

      if (data.code === 0) {
        return (data.data as FeishuTokenResponse).access_token;
      } else {
        logger.error("刷新飞书访问令牌失败", {
          code: data.code,
          message: data.msg,
        });
        return null;
      }
    } catch (error) {
      logger.error("刷新飞书访问令牌异常", { error });
      return null;
    }
  }
}

// 导出服务实例
export const feishuAuthService = new FeishuAuthService();

// 默认导出
export default feishuAuthService;
