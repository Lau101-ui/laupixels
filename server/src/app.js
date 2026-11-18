import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import jwt from "@fastify/jwt";
import argon2 from "argon2";
import { z } from "zod";
import { PrismaClient } from "@prisma/client";
import { createR2Storage, UPLOAD_URL_TTL_SECONDS } from "./storage/r2.js";
import { InvalidImageError, MAX_IMAGE_BYTES, normalizeImage } from "./storage/image.js";

const prisma = new PrismaClient();
const WallpaperInput = z.object({
  slug: z.string().trim().min(2).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  title: z.string().trim().min(2).max(120),
  description: z.string().trim().min(2).max(500),
  category: z.string().trim().min(2).max(60),
  imageUrl: z.string().url().max(2048).optional(),
  imageUploadId: z.string().min(1).max(100).optional(),
  previewUrl: z.string().url().max(2048).optional(),
  previewUploadId: z.string().min(1).max(100).optional(),
  width: z.number().int().positive().max(30000).optional(),
  height: z.number().int().positive().max(30000).optional(),
  isPublished: z.boolean().default(false)
}).strict().superRefine((data, ctx) => {
  if (Boolean(data.imageUrl) === Boolean(data.imageUploadId)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Provide exactly one of imageUrl or imageUploadId.", path: ["imageUrl"] });
  }
  if (data.previewUrl && data.previewUploadId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Provide either previewUrl or previewUploadId, not both.", path: ["previewUrl"] });
  }
  if (data.imageUploadId && data.imageUploadId === data.previewUploadId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Use separate uploads for the original and preview.", path: ["previewUploadId"] });
  }
});
const WallpaperPatchInput = z.object({
  slug: z.string().trim().min(2).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  title: z.string().trim().min(2).max(120),
  description: z.string().trim().min(2).max(500),
  category: z.string().trim().min(2).max(60),
  imageUrl: z.string().url().max(2048),
  previewUrl: z.string().url().max(2048),
  width: z.number().int().positive().max(30000),
  height: z.number().int().positive().max(30000),
  isPublished: z.boolean()
}).partial().strict();
const UploadInput = z.object({
  contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  sizeBytes: z.number().int().positive().max(MAX_IMAGE_BYTES)
}).strict();

function allowedAssetUrl(value, hosts) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && hosts.has(url.hostname);
  } catch {
    return false;
  }
}

export async function buildApp({ storage: storageOverride } = {}) {
  const storage = storageOverride === undefined ? createR2Storage() : storageOverride;
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

  app.post("/v1/admin/uploads", {
    preHandler: app.authenticateAdmin,
    config: { rateLimit: { max: 10, timeWindow: "1 hour" } }
  }, async (request, reply) => {
    const parsed = UploadInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_upload_request" });
    if (!storage) return reply.code(503).send({ error: "storage_not_configured" });

    const uploadKey = "incoming/" + randomUUID();
    const expiresAt = new Date(Date.now() + UPLOAD_URL_TTL_SECONDS * 1000);
    const upload = await prisma.$transaction(async tx => {
      const created = await tx.mediaUpload.create({
        data: {
          adminId: request.user.sub,
          uploadKey,
          expectedContentType: parsed.data.contentType,
          expectedSizeBytes: parsed.data.sizeBytes,
          expiresAt
        }
      });
      await tx.adminAuditLog.create({
        data: {
          adminId: request.user.sub,
          action: "media.upload.request",
          entity: "media_upload",
          entityId: created.id,
          metadata: { contentType: parsed.data.contentType, sizeBytes: parsed.data.sizeBytes }
        }
      });
      return created;
    });

    try {
      const uploadUrl = await storage.createUploadUrl(upload.uploadKey, upload.expectedContentType);
      return reply.code(201).send({
        uploadId: upload.id,
        method: "PUT",
        uploadUrl,
        headers: { "Content-Type": upload.expectedContentType },
        maxBytes: MAX_IMAGE_BYTES,
        expectedBytes: upload.expectedSizeBytes,
        expiresAt: upload.expiresAt.toISOString()
      });
    } catch (error) {
      await prisma.mediaUpload.update({
        where: { id: upload.id },
        data: { status: "REJECTED" }
      });
      throw error;
    }
  });

  app.post("/v1/admin/uploads/:id/complete", {
    preHandler: app.authenticateAdmin,
    config: { rateLimit: { max: 20, timeWindow: "1 hour" } }
  }, async (request, reply) => {
    const parsedId = z.string().min(1).max(100).safeParse(request.params.id);
    if (!parsedId.success) return reply.code(400).send({ error: "invalid_upload_id" });
    if (!storage) return reply.code(503).send({ error: "storage_not_configured" });

    const upload = await prisma.mediaUpload.findFirst({
      where: { id: parsedId.data, adminId: request.user.sub }
    });
    if (!upload) return reply.code(404).send({ error: "upload_not_found" });
    if (upload.status === "READY") return reply.code(409).send({ error: "upload_already_completed" });
    if (upload.status !== "PENDING") return reply.code(409).send({ error: "upload_not_pending" });
    if (upload.expiresAt.getTime() <= Date.now()) {
      await storage.deleteObject(upload.uploadKey).catch(() => {});
      await prisma.mediaUpload.update({ where: { id: upload.id }, data: { status: "EXPIRED" } });
      return reply.code(410).send({ error: "upload_expired" });
    }

    // Claim the upload atomically so two completion requests cannot process it twice.
    const claim = await prisma.mediaUpload.updateMany({
      where: { id: upload.id, adminId: request.user.sub, status: "PENDING" },
      data: { status: "PROCESSING", processingStartedAt: new Date() }
    });
    if (claim.count !== 1) return reply.code(409).send({ error: "upload_already_processing" });

    const finalKeys = [];
    try {
      const head = await storage.headObject(upload.uploadKey);
      if (
        Number(head.ContentLength) !== upload.expectedSizeBytes ||
        head.ContentType !== upload.expectedContentType
      ) {
        await storage.deleteObject(upload.uploadKey).catch(() => {});
        await prisma.mediaUpload.update({
          where: { id: upload.id },
          data: { status: "REJECTED", processingStartedAt: null }
        });
        return reply.code(422).send({ error: "uploaded_file_mismatch" });
      }

      const input = await storage.getObjectBuffer(upload.uploadKey);
      if (input.length !== upload.expectedSizeBytes || input.length > MAX_IMAGE_BYTES) {
        await storage.deleteObject(upload.uploadKey).catch(() => {});
        await prisma.mediaUpload.update({
          where: { id: upload.id },
          data: { status: "REJECTED", processingStartedAt: null }
        });
        return reply.code(422).send({ error: "uploaded_file_mismatch" });
      }

      const normalized = await normalizeImage(input, upload.expectedContentType);
      const suffix = randomUUID();
      const objectKey = "wallpapers/" + suffix + ".webp";
      const previewKey = "previews/" + suffix + ".webp";
      finalKeys.push(objectKey, previewKey);

      await storage.putObject(objectKey, normalized.imageBuffer);
      await storage.putObject(previewKey, normalized.previewBuffer);

      const imageUrl = storage.publicUrl(objectKey);
      const previewUrl = storage.publicUrl(previewKey);
      const outputSizeBytes = normalized.imageBuffer.length;

      await prisma.$transaction(async tx => {
        await tx.mediaUpload.update({
          where: { id: upload.id },
          data: {
            status: "READY",
            objectKey,
            previewKey,
            imageUrl,
            previewUrl,
            outputSizeBytes,
            width: normalized.width,
            height: normalized.height,
            completedAt: new Date(),
            processingStartedAt: null
          }
        });
        await tx.adminAuditLog.create({
          data: {
            adminId: request.user.sub,
            action: "media.upload.complete",
            entity: "media_upload",
            entityId: upload.id,
            metadata: { width: normalized.width, height: normalized.height, outputSizeBytes }
          }
        });
      });

      await storage.deleteObject(upload.uploadKey).catch(() => {});
      return reply.code(200).send({
        uploadId: upload.id,
        imageUrl,
        previewUrl,
        contentType: "image/webp",
        sizeBytes: outputSizeBytes,
        width: normalized.width,
        height: normalized.height
      });
    } catch (error) {
      await Promise.allSettled(finalKeys.map(key => storage.deleteObject(key)));
      if (error instanceof InvalidImageError) {
        await storage.deleteObject(upload.uploadKey).catch(() => {});
        await prisma.mediaUpload.update({
          where: { id: upload.id },
          data: { status: "REJECTED", processingStartedAt: null }
        }).catch(() => {});
        return reply.code(422).send({ error: "invalid_image" });
      }

      await prisma.mediaUpload.updateMany({
        where: { id: upload.id, status: "PROCESSING" },
        data: { status: "PENDING", processingStartedAt: null }
      }).catch(() => {});
      throw error;
    }
  });

  app.post("/v1/admin/wallpapers", { preHandler: app.authenticateAdmin }, async (request, reply) => {
    const parsed = WallpaperInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_input", details: parsed.error.flatten() });

    if (parsed.data.imageUrl && !allowedAssetUrl(parsed.data.imageUrl, assetHosts)) {
      return reply.code(400).send({ error: "asset_host_not_allowed", field: "imageUrl" });
    }
    if (parsed.data.previewUrl && !allowedAssetUrl(parsed.data.previewUrl, assetHosts)) {
      return reply.code(400).send({ error: "asset_host_not_allowed", field: "previewUrl" });
    }

    try {
      const result = await prisma.$transaction(async tx => {
        let imageUpload = null;
        let previewUpload = null;

        if (parsed.data.imageUploadId) {
          imageUpload = await tx.mediaUpload.findFirst({
            where: {
              id: parsed.data.imageUploadId,
              adminId: request.user.sub,
              status: "READY",
              imageFor: null,
              previewFor: null
            }
          });
          if (!imageUpload?.imageUrl) return { error: "image_upload_not_ready" };
        }
        if (parsed.data.previewUploadId) {
          previewUpload = await tx.mediaUpload.findFirst({
            where: {
              id: parsed.data.previewUploadId,
              adminId: request.user.sub,
              status: "READY",
              imageFor: null,
              previewFor: null
            }
          });
          if (!previewUpload?.previewUrl) return { error: "preview_upload_not_ready" };
        }

        const data = { ...parsed.data };
        delete data.imageUploadId;
        delete data.previewUploadId;
        data.imageUrl = imageUpload ? imageUpload.imageUrl : data.imageUrl;
        data.previewUrl = previewUpload
          ? previewUpload.previewUrl
          : (imageUpload ? imageUpload.previewUrl : data.previewUrl);
        if (imageUpload) {
          data.imageUpload = { connect: { id: imageUpload.id } };
          data.width = data.width ?? imageUpload.width;
          data.height = data.height ?? imageUpload.height;
        }
        if (previewUpload) data.previewUpload = { connect: { id: previewUpload.id } };

        const wallpaper = await tx.wallpaper.create({ data });
        await tx.adminAuditLog.create({ data: {
          adminId: request.user.sub,
          action: "wallpaper.create",
          entity: "wallpaper",
          entityId: wallpaper.id,
          metadata: {
            slug: wallpaper.slug,
            isPublished: wallpaper.isPublished,
            imageUploadId: imageUpload?.id || null,
            previewUploadId: previewUpload?.id || null
          }
        } });
        return { wallpaper };
      });

      if (result.error) return reply.code(409).send({ error: result.error });
      return reply.code(201).send(result.wallpaper);
    } catch (err) {
      if (err?.code === "P2002") return reply.code(409).send({ error: "slug_or_upload_already_used" });
      throw err;
    }
  });

  app.patch("/v1/admin/wallpapers/:id", { preHandler: app.authenticateAdmin }, async (request, reply) => {
    const id = z.string().min(1).max(100).safeParse(request.params.id);
    const parsed = WallpaperPatchInput.safeParse(request.body);
    if (!id.success || !parsed.success || Object.keys(parsed.data).length === 0) {
      return reply.code(400).send({ error: "invalid_input" });
    }
    for (const key of ["imageUrl", "previewUrl"]) {
      const value = parsed.data[key];
      if (value && !allowedAssetUrl(value, assetHosts)) {
        return reply.code(400).send({ error: "asset_host_not_allowed", field: key });
      }
    }
    const data = { ...parsed.data };
    if (Object.hasOwn(data, "imageUrl")) data.imageUpload = { disconnect: true };
    if (Object.hasOwn(data, "previewUrl")) data.previewUpload = { disconnect: true };
    try {
      return await prisma.$transaction(async tx => {
        const updated = await tx.wallpaper.update({ where: { id: id.data }, data });
        await tx.adminAuditLog.create({ data: {
          adminId: request.user.sub,
          action: "wallpaper.update",
          entity: "wallpaper",
          entityId: updated.id,
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
          adminId: request.user.sub,
          action: "wallpaper.delete",
          entity: "wallpaper",
          entityId: removed.id,
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
