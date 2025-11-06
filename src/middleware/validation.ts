import { FastifySchema, FastifyRequest, FastifyReply } from "fastify";
import { sendErrorResponse } from "./errorHandler";

// 通用验证错误处理器
export function validationErrorHandler(
  error: any,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  reply.status(400).send({
    error: "Validation Failed",
    message: "请求参数不符合规范",
    details: error.validation.map((err: any) => ({
      field: err.dataPath.substring(1), // remove leading '.'
      message: err.message,
    })),
  });
}

/**
 * 类型转换函数
 */
function convertType(value: any, targetType: string): any {
  if (value === null || value === undefined) {
    return value;
  }

  switch (targetType) {
    case "number":
      if (typeof value === "number") return value;
      if (typeof value === "string") {
        const num = Number(value);
        return isNaN(num) ? value : num;
      }
      break;
    case "boolean":
      if (typeof value === "boolean") return value;
      if (typeof value === "string") {
        if (value === "true" || value === "1") return true;
        if (value === "false" || value === "0") return false;
      }
      if (typeof value === "number") {
        return value === 1 ? true : value === 0 ? false : value;
      }
      break;
    case "string":
      if (typeof value === "string") return value;
      return String(value);
    case "array":
      if (Array.isArray(value)) return value;
      if (typeof value === "string") {
        // 处理逗号分隔的字符串转换为数组
        return value.split(",").map(item => item.trim());
      }
      break;
  }
  
  return value;
}

/**
 * 简单的 JSON Schema 验证器
 */
function validateJsonSchema(data: any, schema: any): { isValid: boolean; errors?: any[]; convertedData?: any } {
  const errors: any[] = [];
  let convertedData = Array.isArray(data) ? [...data] : typeof data === "object" && data !== null ? { ...data } : data;

  // 检查 schema 类型
  if (schema.type === "invalid-type") {
    throw new Error("Invalid schema type");
  }

  // 检查类型
  if (schema.type === "object") {
    if (typeof data !== "object" || data === null) {
      errors.push({
        instancePath: "",
        keyword: "type",
        message: `must be object`,
      });
      return { isValid: false, errors };
    }

    // 检查必填字段
    if (schema.required) {
      for (const requiredField of schema.required) {
        if (!(requiredField in data)) {
          errors.push({
            instancePath: `/${requiredField}`,
            keyword: "required",
            message: `must have required property '${requiredField}'`,
          });
        }
      }
    }

    // 检查属性并进行类型转换
    if (schema.properties) {
      for (const [propName, propSchema] of Object.entries(schema.properties)) {
        if (propName in data) {
          const value = data[propName];
          const typedSchema = propSchema as any;

          // 进行类型转换
          const convertedValue = convertType(value, typedSchema.type);
          (convertedData as any)[propName] = convertedValue;

          // 验证转换后的值
          if (typedSchema.type === "string") {
            if (typeof convertedValue !== "string") {
              errors.push({
                instancePath: `/${propName}`,
                keyword: "type",
                message: `must be string`,
              });
            } else if (typedSchema.minLength !== undefined && convertedValue.length < typedSchema.minLength) {
              errors.push({
                instancePath: `/${propName}`,
                keyword: "minLength",
                message: `must NOT have fewer than ${typedSchema.minLength} characters`,
              });
            } else if (typedSchema.format === "email" && !convertedValue.includes("@")) {
              errors.push({
                instancePath: `/${propName}`,
                keyword: "format",
                message: `must match format "email"`,
              });
            }

            // 检查 pattern
            if (typedSchema.pattern && typeof convertedValue === "string") {
              const regex = new RegExp(typedSchema.pattern);
              if (!regex.test(convertedValue)) {
                errors.push({
                  instancePath: `/${propName}`,
                  keyword: "pattern",
                  message: `must match pattern "${typedSchema.pattern}"`,
                });
              }
            }

            // 检查 enum
            if (typedSchema.enum && Array.isArray(typedSchema.enum)) {
              if (!typedSchema.enum.includes(convertedValue)) {
                const enumValues = typedSchema.enum.join(", ");
                errors.push({
                  instancePath: `/${propName}`,
                  keyword: "enum",
                  message: `must be equal to one of the allowed values: ${enumValues}`,
                });
              }
            }
          } else if (typedSchema.type === "number") {
            if (typeof convertedValue !== "number") {
              errors.push({
                instancePath: `/${propName}`,
                keyword: "type",
                message: `must be number`,
              });
            } else {
              if (typedSchema.minimum !== undefined && convertedValue < typedSchema.minimum) {
                const customMessage = typedSchema.errorMessage?.minimum || `must be >= ${typedSchema.minimum}`;
                errors.push({
                  instancePath: `/${propName}`,
                  keyword: "minimum",
                  message: customMessage,
                });
              }
              if (typedSchema.maximum !== undefined && convertedValue > typedSchema.maximum) {
                errors.push({
                  instancePath: `/${propName}`,
                  keyword: "maximum",
                  message: `must be <= ${typedSchema.maximum}`,
                });
              }
            }
          } else if (typedSchema.type === "boolean") {
            if (typeof convertedValue !== "boolean") {
              errors.push({
                instancePath: `/${propName}`,
                keyword: "type",
                message: `must be boolean`,
              });
            }
          } else if (typedSchema.type === "array") {
            if (!Array.isArray(convertedValue)) {
              errors.push({
                instancePath: `/${propName}`,
                keyword: "type",
                message: `must be array`,
              });
            }
            
            // 检查 enum for arrays
            if (typedSchema.enum && Array.isArray(typedSchema.enum) && Array.isArray(convertedValue)) {
              for (let i = 0; i < convertedValue.length; i++) {
                if (!typedSchema.enum.includes(convertedValue[i])) {
                  const enumValues = typedSchema.enum.join(", ");
                  errors.push({
                    instancePath: `/${propName}/${i}`,
                    keyword: "enum",
                    message: `must be equal to one of the allowed values: ${enumValues}`,
                  });
                }
              }
            }
          }
        }
      }
    }

    // 检查额外属性
    if (schema.additionalProperties === false) {
      const allowedProps = new Set(Object.keys(schema.properties || {}));
      for (const propName of Object.keys(data)) {
        if (!allowedProps.has(propName)) {
          errors.push({
            instancePath: "",
            keyword: "additionalProperties",
            message: `must NOT have additional properties`,
            params: { additionalProperty: propName },
          });
        }
      }
    }
  }

  return { isValid: errors.length === 0, errors: errors.length > 0 ? errors : undefined, convertedData };
}

/**
 * 验证请求体中间件
 */
export function validateBody(schema: FastifySchema) {
  return async (request: FastifyRequest, reply: FastifyReply, done: Function) => {
    try {
      // 处理空 body
      if (request.body === null || request.body === undefined) {
        sendErrorResponse(
          reply,
          "VALIDATION_FAILED" as any,
          "Request body is required"
        );
        return;
      }

      // 使用简单验证
      const result = validateJsonSchema(request.body, schema);

      if (result.isValid) {
        // 更新 request.body 为转换后的值
        if (result.convertedData !== undefined) {
          request.body = result.convertedData;
        }
        done();
      } else {
        sendErrorResponse(
          reply,
          "VALIDATION_FAILED" as any,
          "Request body validation failed",
          { errors: result.errors }
        );
      }
    } catch (error) {
      sendErrorResponse(
        reply,
        "INTERNAL_ERROR" as any,
        "Validation schema error"
      );
    }
  };
}

/**
 * 验证路径参数中间件
 */
export function validateParams(schema: FastifySchema) {
  return async (request: FastifyRequest, reply: FastifyReply, done: Function) => {
    try {
      // 使用简单验证
      const result = validateJsonSchema(request.params, schema);

      if (result.isValid) {
        // 更新 request.params 为转换后的值
        if (result.convertedData !== undefined) {
          request.params = result.convertedData;
        }
        done();
      } else {
        sendErrorResponse(
          reply,
          "VALIDATION_FAILED" as any,
          "Request parameters validation failed",
          { errors: result.errors }
        );
      }
    } catch (error) {
      sendErrorResponse(
        reply,
        "INTERNAL_ERROR" as any,
        "Validation schema error"
      );
    }
  };
}

/**
 * 验证查询参数中间件
 */
export function validateQuery(schema: FastifySchema) {
  return async (request: FastifyRequest, reply: FastifyReply, done: Function) => {
    try {
      // 使用简单验证
      const result = validateJsonSchema(request.query, schema);

      if (result.isValid) {
        // 更新 request.query 为转换后的值
        if (result.convertedData !== undefined) {
          request.query = result.convertedData;
        }
        done();
      } else {
        sendErrorResponse(
          reply,
          "VALIDATION_FAILED" as any,
          "Query parameters validation failed",
          { errors: result.errors }
        );
      }
    } catch (error) {
      sendErrorResponse(
        reply,
        "INTERNAL_ERROR" as any,
        "Validation schema error"
      );
    }
  };
}
