import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { InvalidImageError, normalizeImage } from "../src/storage/image.js";

test("normalizes a valid PNG into a WebP image and preview", async () => {
  const input = await sharp({
    create: {
      width: 800,
      height: 1200,
      channels: 3,
      background: "#26384a"
    }
  }).png().toBuffer();

  const result = await normalizeImage(input, "image/png");
  const metadata = await sharp(result.imageBuffer).metadata();
  const previewMetadata = await sharp(result.previewBuffer).metadata();

  assert.equal(metadata.format, "webp");
  assert.equal(previewMetadata.format, "webp");
  assert.equal(result.width, 800);
  assert.equal(result.height, 1200);
});

test("rejects a file whose declared MIME type does not match its content", async () => {
  const input = await sharp({
    create: {
      width: 800,
      height: 1200,
      channels: 3,
      background: "#26384a"
    }
  }).png().toBuffer();

  await assert.rejects(
    normalizeImage(input, "image/jpeg"),
    error => error instanceof InvalidImageError
  );
});

test("rejects arbitrary non-image bytes", async () => {
  await assert.rejects(
    normalizeImage(Buffer.from("not an image"), "image/png"),
    error => error instanceof InvalidImageError
  );
});
