import assert from "node:assert/strict";
import { test } from "node:test";
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
