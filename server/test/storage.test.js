import assert from "node:assert/strict";
import { test } from "node:test";
import { createR2Storage, UPLOAD_URL_TTL_SECONDS } from "../src/storage/r2.js";

const completeConfig = {
  R2_ACCOUNT_ID: "account-id",
  R2_ACCESS_KEY_ID: "access-key",
  R2_SECRET_ACCESS_KEY: "secret-key",
  R2_BUCKET: "laupixels-media",
  R2_PUBLIC_BASE_URL: "https://images.example.test"
};

test("R2 storage stays optional for local development", () => {
  assert.equal(createR2Storage({}), null);
});

test("R2 configuration fails closed when only some credentials are supplied", () => {
  assert.throws(
    () => createR2Storage({ R2_ACCOUNT_ID: "account-id" }),
    /configuration is incomplete/
  );
});

test("R2 public asset URLs must use HTTPS", () => {
  assert.throws(
    () => createR2Storage({ ...completeConfig, R2_PUBLIC_BASE_URL: "http://images.example.test" }),
    /HTTPS base URL/
  );
});

test("upload authorization is deliberately short-lived", () => {
  assert.equal(UPLOAD_URL_TTL_SECONDS, 300);
});
