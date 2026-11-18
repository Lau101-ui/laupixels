import assert from "node:assert/strict";
import { test } from "node:test";
import { createHmac } from "node:crypto";
import { createImageKitStorage, UPLOAD_URL_TTL_SECONDS } from "../src/storage/imagekit.js";

const config = {
  IMAGEKIT_PRIVATE_KEY: "private-test-key",
  IMAGEKIT_PUBLIC_KEY: "public-test-key",
  IMAGEKIT_URL_ENDPOINT: "https://ik.imagekit.io/testaccount"
};

test("ImageKit storage stays optional for local development", () => {
  assert.equal(createImageKitStorage({}), null);
});

test("ImageKit configuration fails closed when incomplete", () => {
  assert.throws(() => createImageKitStorage({ IMAGEKIT_PRIVATE_KEY: "private" }), /configuration is incomplete/);
});

test("ImageKit URL endpoint must use HTTPS", () => {
  assert.throws(() => createImageKitStorage({ ...config, IMAGEKIT_URL_ENDPOINT: "http://ik.imagekit.io/test" }), /HTTPS URL/);
});

test("upload authentication expires after five minutes", () => {
  assert.equal(UPLOAD_URL_TTL_SECONDS, 300);
});

test("ImageKit storage can be initialized with all required settings", () => {
  assert.ok(createImageKitStorage(config));
});

test("upload signature is generated server-side and bound to the upload token", async () => {
  const storage = createImageKitStorage(config);
  const auth = await storage.createUploadUrl("expected-file-name");
  assert.equal(auth.token, "expected-file-name");
  assert.equal(auth.publicKey, config.IMAGEKIT_PUBLIC_KEY);
  assert.equal(auth.expire - Math.floor(Date.now() / 1000), UPLOAD_URL_TTL_SECONDS);
  assert.equal(auth.signature, createHmac("sha1", config.IMAGEKIT_PRIVATE_KEY).update(auth.token + auth.expire).digest("hex"));
});
