import "dotenv/config";
import argon2 from "argon2";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

try {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_INITIAL_PASSWORD;
  if (!email || !password || password.length < 14 || password.startsWith("replace-")) {
    throw new Error("Set ADMIN_EMAIL and a unique ADMIN_INITIAL_PASSWORD of at least 14 characters.");
  }

  const passwordHash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1
  });

  await prisma.admin.upsert({
    where: { email },
    update: { passwordHash, isActive: true },
    create: { email, passwordHash }
  });
  console.log("Admin account seeded. Store the password in a password manager.");
} finally {
  await prisma.$disconnect();
}
