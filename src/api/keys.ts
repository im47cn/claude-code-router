import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { apiKeyService } from "../auth/apiKey";
import { sendSuccess, sendError, HttpStatusCode } from "../utils/apiResponse";
import { AuthenticatedRequest, CreateApiKeyRequest } from "../types/auth";

// 定义请求体验证schema
const CreateKeyBodySchema = z.object({
  name: z.string().min(1, "名称不能为空"),
});

const IdParamSchema = z.object({
  id: z.string().uuid("无效的ID格式"),
});

// 定义API密钥路由
export function apiKeyRoutes(fastify: FastifyInstance) {
  // 创建API密钥
  fastify.post(
    "/api/keys",
    {
      preHandler: [fastify.userSessionAuth],
    },
    async (req: AuthenticatedRequest, reply: FastifyReply) => {
      try {
        const validatedBody = CreateKeyBodySchema.safeParse(req.body);
        if (!validatedBody.success) {
          sendError(
            reply,
            HttpStatusCode.BAD_REQUEST,
            "VALIDATION_FAILED",
            "请求体验证失败",
            validatedBody.error.errors,
          );
          return;
        }

        const { name } = validatedBody.data;

        if (!req.authContext?.userId) {
          sendError(
            reply,
            HttpStatusCode.UNAUTHORIZED,
            "UNAUTHORIZED",
            "用户未认证",
          );
          return;
        }

        const createRequest: CreateApiKeyRequest = {
          name,
        };

        const apiKey = await apiKeyService.createApiKey(req.authContext.userId, createRequest);
        sendSuccess(reply, apiKey, HttpStatusCode.CREATED);
      } catch (error) {
        sendError(
          reply,
          HttpStatusCode.INTERNAL_SERVER_ERROR,
          "INTERNAL_ERROR",
          "创建API密钥失败",
          error,
        );
      }
    },
  );

  // 获取用户的API密钥列表
  fastify.get(
    "/api/keys",
    {
      preHandler: [fastify.userSessionAuth],
    },
    async (req: AuthenticatedRequest, reply: FastifyReply) => {
      if (!req.authContext?.userId) {
        sendError(
          reply,
          HttpStatusCode.UNAUTHORIZED,
          "UNAUTHORIZED",
          "用户未认证",
        );
        return;
      }

      try {
        const apiKeys = await apiKeyService.getUserApiKeys(req.authContext.userId);
        sendSuccess(reply, apiKeys);
      } catch (error) {
        sendError(
          reply,
          HttpStatusCode.INTERNAL_SERVER_ERROR,
          "INTERNAL_ERROR",
          "获取API密钥失败",
          error,
        );
      }
    },
  );

  // 删除API密钥
  fastify.delete(
    "/api/keys/:id",
    {
      preHandler: [fastify.userSessionAuth],
    },
    async (req: AuthenticatedRequest, reply: FastifyReply) => {
      try {
        const validatedParams = IdParamSchema.safeParse(req.params);
        if (!validatedParams.success) {
          sendError(
            reply,
            HttpStatusCode.BAD_REQUEST,
            "VALIDATION_FAILED",
            "无效的ID格式",
            validatedParams.error.errors,
          );
          return;
        }
        const { id } = validatedParams.data;

        if (!req.authContext?.userId) {
          sendError(
            reply,
            HttpStatusCode.UNAUTHORIZED,
            "UNAUTHORIZED",
            "用户未认证",
          );
          return;
        }

        const success = await apiKeyService.deleteApiKey(id, req.authContext.userId);
        if (success) {
          reply.status(HttpStatusCode.NO_CONTENT).send();
        } else {
          sendError(
            reply,
            HttpStatusCode.NOT_FOUND,
            "RESOURCE_NOT_FOUND",
            "API密钥不存在或无权限",
          );
        }
      } catch (error) {
        sendError(
          reply,
          HttpStatusCode.INTERNAL_SERVER_ERROR,
          "INTERNAL_ERROR",
          "删除API密钥失败",
          error,
        );
      }
    },
  );

  // 切换API密钥状态
  fastify.patch(
    "/api/keys/:id/toggle",
    {
      preHandler: [fastify.userSessionAuth],
    },
    async (req: AuthenticatedRequest, reply: FastifyReply) => {
      try {
        const validatedParams = IdParamSchema.safeParse(req.params);
        if (!validatedParams.success) {
          sendError(
            reply,
            HttpStatusCode.BAD_REQUEST,
            "VALIDATION_FAILED",
            "无效的ID格式",
            validatedParams.error.errors,
          );
          return;
        }
        const { id } = validatedParams.data;

        if (!req.authContext?.userId) {
          sendError(
            reply,
            HttpStatusCode.UNAUTHORIZED,
            "UNAUTHORIZED",
            "用户未认证",
          );
          return;
        }

        const newStatus = await apiKeyService.toggleApiKeyStatus(
          id,
          req.authContext.userId,
        );
        sendSuccess(reply, { newStatus });
      } catch (error) {
        sendError(
          reply,
          HttpStatusCode.INTERNAL_SERVER_ERROR,
          "INTERNAL_ERROR",
          "切换API密钥状态失败",
          error,
        );
      }
    },
  );
}
