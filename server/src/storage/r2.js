import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const UPLOAD_URL_TTL_SECONDS = 300;

const REQUIRED_ENV = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_UPLOAD_BUCKET",
  "R2_PUBLIC_BUCKET",
  "R2_PUBLIC_BASE_URL"
];

export function createR2Storage(env = process.env) {
  const configured = REQUIRED_ENV.filter(key => typeof env[key] === "string" && env[key].trim() !== "");

  // Local development remains usable without a remote storage account.
  if (configured.length === 0) return null;
  if (configured.length !== REQUIRED_ENV.length) {
    throw new Error("R2 storage configuration is incomplete. Configure all R2_* variables or leave them all empty.");
  }
  if (env.R2_UPLOAD_BUCKET === env.R2_PUBLIC_BUCKET) {
    throw new Error("R2_UPLOAD_BUCKET and R2_PUBLIC_BUCKET must be separate buckets.");
  }

  let publicBase;
  try {
    publicBase = new URL(env.R2_PUBLIC_BASE_URL);
  } catch {
    throw new Error("R2_PUBLIC_BASE_URL must be a valid HTTPS URL.");
  }

  if (
    publicBase.protocol !== "https:" ||
    publicBase.username ||
    publicBase.password ||
    publicBase.search ||
    publicBase.hash
  ) {
    throw new Error("R2_PUBLIC_BASE_URL must be an HTTPS base URL without credentials, query parameters or fragments.");
  }

  const publicBaseUrl = publicBase.toString().replace(/\/+$/, "");
  const client = new S3Client({
    region: "auto",
    endpoint: "https://" + env.R2_ACCOUNT_ID + ".r2.cloudflarestorage.com",
    forcePathStyle: true,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY
    },
    maxAttempts: 2
  });
  const uploadBucket = env.R2_UPLOAD_BUCKET;
  const publicBucket = env.R2_PUBLIC_BUCKET;

  return {
    publicBaseUrl,

    publicUrl(key) {
      return new URL(key, publicBaseUrl + "/").toString();
    },

    async createUploadUrl(key, contentType) {
      const command = new PutObjectCommand({
        Bucket: uploadBucket,
        Key: key,
        ContentType: contentType
      });
      return getSignedUrl(client, command, {
        expiresIn: UPLOAD_URL_TTL_SECONDS,
        signableHeaders: new Set(["content-type"])
      });
    },

    async headObject(key) {
      return client.send(new HeadObjectCommand({ Bucket: uploadBucket, Key: key }));
    },

    async getObjectBuffer(key) {
      const response = await client.send(new GetObjectCommand({ Bucket: uploadBucket, Key: key }));
      if (!response.Body) throw new Error("Storage returned an empty object body.");
      return Buffer.from(await response.Body.transformToByteArray());
    },

    async putObject(key, body, contentType = "image/webp") {
      return client.send(new PutObjectCommand({
        Bucket: publicBucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        CacheControl: "public, max-age=31536000, immutable"
      }));
    },

    async deleteUploadObject(key) {
      return client.send(new DeleteObjectCommand({ Bucket: uploadBucket, Key: key }));
    },

    async deletePublicObject(key) {
      return client.send(new DeleteObjectCommand({ Bucket: publicBucket, Key: key }));
    }
  };
}
