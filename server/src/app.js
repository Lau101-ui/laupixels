import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import jwt from "@fastify/jwt";
import argon2 from "argon2";
import { z } from "zod";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const WallpaperInput = z.object({
  slug: z.string().trim().min(2).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  title: z.string().trim().min(2).max(120),
  description: z.string().trim().min(2).max(500),
  category: z.string().trim().min(2).max(60),
  imageUrl: z.string().url().max(2048),
  previewUrl: z.string().url().max(2048).optional(),
  width: z.number().int().positive().max(30000).optional(),
  height: z.number().int().positive().max(30000).optional(),
  isPublished: z.boolean().default(false)
}).strict();

function allowedAssetUrl(value, hosts) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && hosts.has(url.hostname);
  } catch {
    return false;
  }
}

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || "info",
      redact: ["req.headers.authorization", "req.headers.cookie", "res.headers.set-cookie"]
    },
    bodyLimit: 64 * 1024,
    trustProxy: false,
    requestTimeout: 15000,
    disableRequestLogging: false
  });

  const corsOrigins = new Set((process.env.CORS_ORIGINS || "").split(",").map(x => x.trim()).filter(Boolean));
  const assetHosts = new Set((process.env.ASSET_HOSTS || "").split(",").map(x => x.trim()).filter(Boolean));

  if (!process.env.JWT_SECRET || Buffer.byteLength(process.env.JWT_SECRET) < 32) {
    throw new Error("JWT_SECRET must contain at least 32 bytes.");
  }
  if (process.env.NODE_ENV === "production" && corsOrigins.size === 0) {
    throw new Error("CORS_ORIGINS must be explicitly configured in production.");
  }

  await app.register(helmet, {
    global: true,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'self'"]
      }
    },
    crossOriginResourcePolicy: { policy: "same-site" }
  });

  await app.register(cors, {
    credentials: false,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    origin(origin, cb) {
      if (!origin || corsOrigins.has(origin)) return cb(null, true);
      return cb(new Error("Origin not allowed"), false);
    }
  });

  await app.register(rateLimit, {
    global: true,
    max: 100,
    timeWindow: "1 minute",
    ban: 2,
    errorResponseBuilder: () => ({ error: "rate_limit_exceeded" })
  });

  await app.register(jwt, {
    secret: process.env.JWT_SECRET,
    sign: { expiresIn: "15m", issuer: "laupixels-api", audience: "laupixels-admin" },
    verify: { allowedIss: "laupixels-api", allowedAud: "laupixels-admin" }
  });

  app.decorate("authenticateAdmin", async function (request, reply) {
    try {
      await request.jwtVerify();
      if (request.user?.role !== "admin" || typeof request.user?.sub !== "string") {
        return reply.code(403).send({ error: "forbidden" });
      }
      // Check account status on every request so deactivated administrators lose
      // access immediately instead of retaining access until their JWT expires.
      const currentAdmin = await prisma.admin.findUnique({
        where: { id: request.user.sub },
        select: { id: true, isActive: true }
      });
      if (!currentAdmin?.isActive) {
        return reply.code(401).send({ error: "unauthorized" });
      }
    } catch {
      return reply.code(401).send({ error: "unauthorized" });
    }
  });

  // Liveness confirms the process is running; readiness also checks PostgreSQL.
  app.get("/health", async () => ({ status: "ok", service: "laupixels-api" }));
  app.get("/ready", async (_request, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { status: "ready", database: "ok" };
    } catch {
      return reply.code(503).send({ status: "not_ready" });
    }
  });

  app.get("/v1/categories", async () => {
    const rows = await prisma.wallpaper.findMany({
      where: { isPublished: true }, distinct: ["category"], orderBy: { category: "asc" },
      select: { category: true }
    });
    return { data: rows.map(row => row.category) };
  });

  app.post("/v1/admin/login", {
    config: { rateLimit: { max: 5, timeWindow: "15 minutes", ban: 1 } },
    schema: { body: { type: "object", required: ["email", "password"], additionalProperties: false,
      properties: { email: { type: "string", minLength: 5, maxLength: 254 }, password: { type: "string", minLength: 1, maxLength: 256 } } } }
  }, async (request, reply) => {
    const email = request.body.email.trim().toLowerCase();
    const admin = await prisma.admin.findUnique({ where: { email } });
    const valid = admin?.isActive && await argon2.verify(admin.passwordHash, request.body.password).catch(() => false);
    if (!valid) return reply.code(401).send({ error: "invalid_credentials" });
    const token = app.jwt.sign({ role: "admin" }, { subject: admin.id });
    return { accessToken: token, tokenType: "Bearer", expiresIn: 900 };
  });

  app.get("/v1/wallpapers", {
    schema: { querystring: { type: "object", additionalProperties: false, properties: {
      category: { type: "string", maxLength: 60 },
      cursor: { type: "string", maxLength: 100 },
      limit: { type: "integer", minimum: 1, maximum: 50, default: 24 }
    } } }
  }, async request => {
    const { category, cursor, limit = 24 } = request.query;
    const rows = await prisma.wallpaper.findMany({
      where: { isPublished: true, ...(category ? { category } : {}) },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: limit + 1,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      select: { id: true, slug: true, title: true, description: true, category: true, imageUrl: true, previewUrl: true, width: true, height: true }
    });
    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;
    return { data, nextCursor: hasMore ? data.at(-1).id : null };
  });

  app.post("/v1/admin/wallpapers", { preHandler: app.authenticateAdmin }, async (request, reply) => {
    const parsed = WallpaperInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_input", details: parsed.error.flatten() });
    for (const key of ["imageUrl", "previewUrl"]) {
      const value = parsed.data[key];
      if (value && !allowedAssetUrl(value, assetHosts)) return reply.code(400).send({ error: "asset_host_not_allowed", field: key });
    }
    try {
      const created = await prisma.$transaction(async tx => {
        const wallpaper = await tx.wallpaper.create({ data: parsed.data });
        await tx.adminAuditLog.create({ data: {
          adminId: request.user.sub, action: "wallpaper.create", entity: "wallpaper", entityId: wallpaper.id,
          metadata: { slug: wallpaper.slug, isPublished: wallpaper.isPublished }
        } });
        return wallpaper;
      });
      return reply.code(201).send(created);
    } catch (err) {
      if (err?.code === "P2002") return reply.code(409).send({ error: "slug_already_exists" });
      throw err;
    }
  });

  app.patch("/v1/admin/wallpapers/:id", { preHandler: app.authenticateAdmin }, async (request, reply) => {
    const id = z.string().min(1).max(100).safeParse(request.params.id);
    const parsed = WallpaperInput.partial().strict().safeParse(request.body);
    if (!id.success || !parsed.success || Object.keys(parsed.data).length === 0) {
      return reply.code(400).send({ error: "invalid_input" });
    }
    for (const key of ["imageUrl", "previewUrl"]) {
      const value = parsed.data[key];
      if (value && !allowedAssetUrl(value, assetHosts)) return reply.code(400).send({ error: "asset_host_not_allowed", field: key });
    }
    try {
      return await prisma.$transaction(async tx => {
        const updated = await tx.wallpaper.update({ where: { id: id.data }, data: parsed.data });
        await tx.adminAuditLog.create({ data: {
          adminId: request.user.sub, action: "wallpaper.update", entity: "wallpaper", entityId: updated.id,
          metadata: { changedFields: Object.keys(parsed.data) }
        } });
        return updated;
      });
    } catch (err) {
      if (err?.code === "P2025") return reply.code(404).send({ error: "not_found" });
      if (err?.code === "P2002") return reply.code(409).send({ error: "slug_already_exists" });
      throw err;
    }
  });

  app.delete("/v1/admin/wallpapers/:id", { preHandler: app.authenticateAdmin }, async (request, reply) => {
    const id = z.string().min(1).max(100).safeParse(request.params.id);
    if (!id.success) return reply.code(400).send({ error: "invalid_input" });
    try {
      await prisma.$transaction(async tx => {
        const removed = await tx.wallpaper.delete({ where: { id: id.data } });
        await tx.adminAuditLog.create({ data: {
          adminId: request.user.sub, action: "wallpaper.delete", entity: "wallpaper", entityId: removed.id,
          metadata: { slug: removed.slug }
        } });
      });
      return reply.code(204).send();
    } catch (err) {
      if (err?.code === "P2025") return reply.code(404).send({ error: "not_found" });
      throw err;
    }
  });

  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, "request failed");
    if (error.validation) return reply.code(400).send({ error: "invalid_request" });
    if (error.message === "Origin not allowed") return reply.code(403).send({ error: "origin_not_allowed" });
    return reply.code(500).send({ error: "internal_server_error" });
  });

  app.addHook("onClose", async () => prisma.$disconnect());
  return app;
}
