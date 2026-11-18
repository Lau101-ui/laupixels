import { createHmac } from "node:crypto";

export const UPLOAD_URL_TTL_SECONDS = 300;
const REQUIRED_ENV = ["IMAGEKIT_PRIVATE_KEY", "IMAGEKIT_PUBLIC_KEY", "IMAGEKIT_URL_ENDPOINT"];
const API_BASE = "https://api.imagekit.io/v1";

function endpointHost(value) {
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error("IMAGEKIT_URL_ENDPOINT must be a valid HTTPS URL."); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("IMAGEKIT_URL_ENDPOINT must be an HTTPS URL without credentials, query parameters or fragments.");
  }
  return parsed.hostname;
}

export function createImageKitStorage(env = process.env) {
  const configured = REQUIRED_ENV.filter(key => typeof env[key] === "string" && env[key].trim() !== "");
  if (configured.length === 0) return null;
  if (configured.length !== REQUIRED_ENV.length) throw new Error("ImageKit configuration is incomplete. Configure IMAGEKIT_PRIVATE_KEY, IMAGEKIT_PUBLIC_KEY and IMAGEKIT_URL_ENDPOINT or leave them all empty.");
  const host = endpointHost(env.IMAGEKIT_URL_ENDPOINT);
  const authorization = "Basic " + Buffer.from(env.IMAGEKIT_PRIVATE_KEY + ":").toString("base64");

  async function api(path, options = {}) {
    const response = await fetch(API_BASE + path, {
      ...options,
      headers: { Authorization: authorization, ...(options.headers || {}) },
      signal: AbortSignal.timeout(20000)
    });
    if (!response.ok) {
      const error = new Error("ImageKit API request failed with status " + response.status);
      error.status = response.status;
      throw error;
    }
    return response.status === 204 ? null : response.json();
  }

  return {
    async createUploadUrl(fileName) {
      const token = fileName;
      const expire = Math.floor(Date.now() / 1000) + UPLOAD_URL_TTL_SECONDS;
      const signature = createHmac("sha1", env.IMAGEKIT_PRIVATE_KEY).update(token + expire).digest("hex");
      return { token, expire, signature, publicKey: env.IMAGEKIT_PUBLIC_KEY };
    },

    async headObject(fileId, expectedFileName) {
      const file = await api("/files/" + encodeURIComponent(fileId));
      const expectedPath = "/laupixels/incoming/" + expectedFileName;
      if (file.filePath !== expectedPath || file.fileType !== "image" || !Number.isFinite(Number(file.size))) {
        throw new Error("ImageKit upload does not match the expected upload intent.");
      }
      const url = new URL(file.url);
      if (url.protocol !== "https:" || url.hostname !== host) throw new Error("ImageKit returned an unexpected media URL.");
      return file;
    },

    async getObjectBuffer(urlValue) {
      const url = new URL(urlValue);
      if (url.protocol !== "https:" || url.hostname !== host) throw new Error("Refusing to fetch media from an untrusted host.");
      const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error("Unable to retrieve uploaded image from ImageKit.");
      const declaredLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(declaredLength) && declaredLength > 15 * 1024 * 1024) throw new Error("Uploaded image exceeds the maximum size.");
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > 15 * 1024 * 1024) throw new Error("Uploaded image exceeds the maximum size.");
      return bytes;
    },

    async putObject(key, body) {
      const separator = key.lastIndexOf("/");
      const folder = "/laupixels/" + key.slice(0, separator);
      const fileName = key.slice(separator + 1);
      const form = new FormData();
      form.set("file", new Blob([body], { type: "image/webp" }), fileName);
      form.set("fileName", fileName);
      form.set("folder", folder);
      form.set("useUniqueFileName", "false");
      form.set("overwriteFile", "false");
      const response = await fetch("https://upload.imagekit.io/api/v1/files/upload", {
        method: "POST",
        headers: { Authorization: authorization },
        body: form,
        signal: AbortSignal.timeout(30000)
      });
      if (!response.ok) throw new Error("ImageKit media upload failed with status " + response.status);
      const result = await response.json();
      if (!result.fileId || !result.url) throw new Error("ImageKit upload response was incomplete.");
      return result;
    },

    async deleteUploadObject(fileId) {
      return api("/files/" + encodeURIComponent(fileId), { method: "DELETE" });
    },

    async deletePublicObject(fileId) {
      return api("/files/" + encodeURIComponent(fileId), { method: "DELETE" });
    }
  };
}
