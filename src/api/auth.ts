import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { AuthenticatedRequest } from "../types/auth";
import { feishuAuthService } from "../auth/feishu";
import { z } from "zod";
import { randomUUID } from "crypto";

// 定义认证路由
export function authRoutes(fastify: FastifyInstance) {
  // 飞书登录
  fastify.get(
    "/auth/feishu/login",
    {
      schema: {
        querystring: z.object({ state: z.string().optional() }),
      },
    },
    (req: FastifyRequest, reply: FastifyReply) => {
      const state = (req.query as { state?: string }).state || randomUUID();
      const authUrl = feishuAuthService.generateAuthUrl(state);
      reply.setCookie('oauth_state', state, {
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production' || process.env.COOKIE_SECURE === 'true',
        sameSite: 'strict',
        maxAge: 10 * 60, // 10 minutes
        // 生产环境额外安全配置
        ...(process.env.NODE_ENV === "production" && {
          domain: process.env.COOKIE_DOMAIN,
        }),
      });
      reply.redirect(authUrl);
    },
  );

  // 飞书回调
  fastify.get(
    "/auth/feishu/callback",
    {
      schema: {
        querystring: z.object({
          code: z.string(),
          state: z.string().optional(),
        }),
      },
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { code, state } = req.query as { code: string; state?: string };
      const savedState = req.cookies.oauth_state;

      if (!savedState || state !== savedState) {
        reply.status(400).send({ error: "Invalid OAuth state" });
        return;
      }

      reply.clearCookie('oauth_state');

      if (!code) {
        reply.status(400).send({ error: "Authorization code is missing" });
        return;
      }

      const authResult = await feishuAuthService.authenticateWithFeishu(code);

      if (authResult.success) {
        // 登录成功，设置JWT到Cookie
        reply.setCookie("session_token", authResult.sessionToken!, {
          path: "/",
          httpOnly: true,
          secure: process.env.NODE_ENV === "production" || process.env.COOKIE_SECURE === "true",
          sameSite: "strict",
          maxAge: 7 * 24 * 60 * 60, // 7天
          // 生产环境额外安全配置
          ...(process.env.NODE_ENV === "production" && {
            // 添加额外的安全属性
            domain: process.env.COOKIE_DOMAIN,
          }),
        });

        // 重定向到前端应用
        reply.redirect(state || "/");
      } else {
        // 登录失败，重定向到登录页面并显示错误
        reply.redirect(`/login?error=${authResult.error}`);
      }
    },
  );

  // 登出
  fastify.get("/auth/logout", (req: FastifyRequest, reply: FastifyReply) => {
    reply.clearCookie("session_token");
    reply.redirect("/login");
  });

  // 获取当前用户信息
  fastify.get(
    "/api/me",
    {
      preHandler: [fastify.userSessionAuth],
    },
    async (req: AuthenticatedRequest, reply: FastifyReply) => {
      if (req.authContext?.isAuthenticated && req.authContext.user) {
        reply.send({ user: req.authContext.user });
      } else {
        reply.status(401).send({ error: "Unauthorized" });
      }
    },
  );
}
