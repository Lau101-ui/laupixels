import assert from "node:assert/strict";
import { after, before, test } from "node:test";

process.env.JWT_SECRET = "test-only-secret-that-is-at-least-32-bytes-long";
process.env.CORS_ORIGINS = "http://localhost:8000";

let app;

before(async () => {
  const { buildApp } = await import("../src/app.js");
  app = await buildApp();
});

after(async () => {
  await app?.close();
});

test("health endpoint reports the API as alive", async () => {
  const response = await app.inject({ method: "GET", url: "/health" });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    status: "ok",
    service: "laupixels-api"
  });
});

test("CORS rejects an origin outside the allowlist", async () => {
  const response = await app.inject({
    method: "GET",
    url: "/health",
    headers: { origin: "https://not-allowed.example" }
  });

  assert.equal(response.statusCode, 403);
  assert.equal(response.json().error, "origin_not_allowed");
});

test("admin login rejects a request with a missing password", async () => {
  const response = await app.inject({
    method: "POST",
    url: "/v1/admin/login",
    payload: { email: "admin@example.com" }
  });

  assert.equal(response.statusCode, 400);
});

test("admin wallpaper listing rejects unauthenticated requests", async () => {
  const response = await app.inject({
    method: "GET",
    url: "/v1/admin/wallpapers"
  });

  assert.equal(response.statusCode, 401);
  assert.equal(response.json().error, "unauthorized");
});

test("admin wallpaper creation rejects unauthenticated requests", async () => {
  const response = await app.inject({
    method: "POST",
    url: "/v1/admin/wallpapers",
    payload: {}
  });

  assert.equal(response.statusCode, 401);
});
