CREATE TYPE "MediaUploadStatus" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'REJECTED', 'EXPIRED');

CREATE TABLE "MediaUpload" (
  "id" TEXT NOT NULL,
  "adminId" TEXT NOT NULL,
  "status" "MediaUploadStatus" NOT NULL DEFAULT 'PENDING',
  "uploadKey" TEXT NOT NULL,
  "objectKey" TEXT,
  "previewKey" TEXT,
  "imageUrl" TEXT,
  "previewUrl" TEXT,
  "expectedContentType" TEXT NOT NULL,
  "expectedSizeBytes" INTEGER NOT NULL,
  "outputSizeBytes" INTEGER,
  "width" INTEGER,
  "height" INTEGER,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "processingStartedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MediaUpload_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Wallpaper"
  ADD COLUMN "imageUploadId" TEXT,
  ADD COLUMN "previewUploadId" TEXT;

CREATE UNIQUE INDEX "MediaUpload_uploadKey_key" ON "MediaUpload"("uploadKey");
CREATE UNIQUE INDEX "MediaUpload_objectKey_key" ON "MediaUpload"("objectKey");
CREATE UNIQUE INDEX "MediaUpload_previewKey_key" ON "MediaUpload"("previewKey");
CREATE UNIQUE INDEX "MediaUpload_imageUrl_key" ON "MediaUpload"("imageUrl");
CREATE INDEX "MediaUpload_adminId_status_createdAt_idx" ON "MediaUpload"("adminId", "status", "createdAt");
CREATE INDEX "MediaUpload_status_expiresAt_idx" ON "MediaUpload"("status", "expiresAt");
CREATE UNIQUE INDEX "Wallpaper_imageUploadId_key" ON "Wallpaper"("imageUploadId");
CREATE UNIQUE INDEX "Wallpaper_previewUploadId_key" ON "Wallpaper"("previewUploadId");

ALTER TABLE "MediaUpload"
  ADD CONSTRAINT "MediaUpload_adminId_fkey"
  FOREIGN KEY ("adminId") REFERENCES "Admin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Wallpaper"
  ADD CONSTRAINT "Wallpaper_imageUploadId_fkey"
  FOREIGN KEY ("imageUploadId") REFERENCES "MediaUpload"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "Wallpaper_previewUploadId_fkey"
  FOREIGN KEY ("previewUploadId") REFERENCES "MediaUpload"("id") ON DELETE SET NULL ON UPDATE CASCADE;
