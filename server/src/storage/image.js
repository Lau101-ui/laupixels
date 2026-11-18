import sharp from "sharp";

export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 40_000_000;

const ACCEPTED_FORMATS = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/webp": "webp"
};

export class InvalidImageError extends Error {
  constructor(message = "The uploaded file is not a supported image.") {
    super(message);
    this.name = "InvalidImageError";
  }
}

export async function normalizeImage(input, declaredContentType) {
  if (!Buffer.isBuffer(input) || input.length === 0 || !ACCEPTED_FORMATS[declaredContentType]) {
    throw new InvalidImageError();
  }

  try {
    const source = sharp(input, {
      failOn: "error",
      limitInputPixels: MAX_IMAGE_PIXELS
    });
    const metadata = await source.metadata();

    if (
      metadata.format !== ACCEPTED_FORMATS[declaredContentType] ||
      !metadata.width ||
      !metadata.height ||
      metadata.width < 320 ||
      metadata.height < 320 ||
      metadata.width * metadata.height > MAX_IMAGE_PIXELS ||
      (metadata.pages && metadata.pages > 1)
    ) {
      throw new InvalidImageError();
    }

    // Decode and re-encode instead of serving user-supplied bytes. This strips
    // EXIF/GPS metadata, rejects unsupported payloads and creates predictable files.
    const normalized = await sharp(input, {
      failOn: "error",
      limitInputPixels: MAX_IMAGE_PIXELS
    })
      .rotate()
      .resize({
        width: 5000,
        height: 7000,
        fit: "inside",
        withoutEnlargement: true
      })
      .webp({ quality: 88, effort: 4 })
      .toBuffer({ resolveWithObject: true });

    const preview = await sharp(normalized.data, {
      failOn: "error",
      limitInputPixels: MAX_IMAGE_PIXELS
    })
      .resize({
        width: 1200,
        height: 1600,
        fit: "inside",
        withoutEnlargement: true
      })
      .webp({ quality: 78, effort: 4 })
      .toBuffer();

    return {
      imageBuffer: normalized.data,
      previewBuffer: preview,
      width: normalized.info.width,
      height: normalized.info.height
    };
  } catch (error) {
    if (error instanceof InvalidImageError) throw error;
    throw new InvalidImageError();
  }
}
