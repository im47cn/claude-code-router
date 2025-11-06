import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";
import { v4 as uuidv4 } from "uuid";

const prisma = new PrismaClient();

async function main() {
  console.log("开始种子数据初始化...");

  // 创建系统配置
  await createSystemConfigs();

  // 创建默认管理员用户（如果不存在）
  await createDefaultAdmin();

  console.log("种子数据初始化完成！");
}

async function createSystemConfigs() {
  const configs = [
    {
      key: "auth.feishu.enabled",
      value: "true",
    },
    {
      key: "quota.default_user_limit",
      value: "1000",
    },
    {
      key: "quota.default_user_window",
      value: "86400",
    },
    {
      key: "quota.default_api_key_limit",
      value: "500",
    },
    {
      key: "quota.default_api_key_window",
      value: "86400",
    },
    {
      key: "auth.jwt_expires_in",
      value: "7d",
    },
    {
      key: "auth.session_timeout",
      value: "86400",
    },
  ];

  for (const config of configs) {
    await prisma.systemConfig.upsert({
      where: { key: config.key },
      update: { value: config.value },
      create: config,
    });
  }

  console.log("系统配置初始化完成");
}

async function createDefaultAdmin() {
  // 检查是否已存在管理员
  const existingAdmin = await prisma.user.findFirst({
    where: { isAdmin: true },
  });

  if (existingAdmin) {
    console.log("管理员用户已存在，跳过创建");
    return;
  }

  // 创建默认管理员
  const adminUser = await prisma.user.create({
    data: {
      id: uuidv4(),
      name: "系统管理员",
      isAdmin: true,
      isActive: true,
    },
  });

  // 创建管理员身份信息
  await prisma.userIdentity.create({
    data: {
      id: uuidv4(),
      userId: adminUser.id,
      provider: "system",
      providerId: "admin",
      accessToken: "system_token",
      refreshToken: "system_refresh",
    },
  });

  // 创建管理员用户配额
  await prisma.userQuota.create({
    data: {
      id: uuidv4(),
      userId: adminUser.id,
      requestLimit: 10000, // 管理员配额更高
      timeWindow: 86400, // 24小时
      currentCount: 0,
      isActive: true,
    },
  });

  console.log("默认管理员用户创建完成");
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error("种子数据初始化失败:", e);
    await prisma.$disconnect();
    process.exit(1);
  });
