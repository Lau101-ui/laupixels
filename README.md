# LAUPIXELS

LAUPIXELS is a standalone, mobile-first wallpaper platform. This repository is independent of any group or coursework repository.

## Repository layout

```text
.
├── index.html                    # PWA frontend / editorial wallpaper discovery
├── manifest.webmanifest          # Install metadata
├── sw.js                         # App-shell + bounded image cache
├── icon.svg                      # App icon
├── .github/workflows/
│   ├── ci.yml                     # Backend validation and container build
│   └── pages.yml                 # Static frontend deployment
├── docker-compose.yml            # Local PostgreSQL + API stack
├── .env.example                  # Local PostgreSQL environment template
├── server/
│   ├── src/app.js                # Fastify API, auth, upload and admin routes
│   ├── src/server.js             # API process and graceful shutdown
│   ├── src/storage/r2.js         # S3-compatible Cloudflare R2 adapter
│   ├── src/storage/image.js      # Image validation and WebP normalization
│   ├── test/                     # API and image/storage tests
│   ├── package.json              # API dependencies and scripts
│   ├── prisma/schema.prisma      # PostgreSQL data model
│   ├── prisma/migrations/        # Versioned database migrations
│   ├── prisma/seed.js            # First administrator bootstrap
│   └── .env.example              # API environment template
├── SECURITY.md                   # Security posture and production gates
└── README.md
```

## Current foundation

- PWA frontend with install affordance, category browsing, search, preview and device-sized export.
- Best-effort device model detection. Browser-supplied model strings are hints only; iOS and some Android browsers intentionally withhold exact model data.
- Fastify API with Helmet, explicit CORS allowlist, request-size cap, global and route-specific rate limits, strict request validation and generic error responses.
- PostgreSQL via Prisma, public wallpaper/category endpoints, cursor pagination, admin create/update/delete routes.
- Argon2id administrator password hashing and short-lived JWTs. Admin active status is checked on each protected request.
- Transactional audit records for wallpaper and media-upload administration.
- Cloudflare R2 integration through the S3-compatible API and short-lived, content-type-bound upload URLs.
- Separate private upload and public delivery buckets; raw uploads are never written to the public bucket.
- Server-side image decoding and WebP re-encoding, generated previews, pixel/byte limits and EXIF metadata removal.
- Liveness and database-readiness endpoints.
- Local Docker Compose setup with database health checks and API bound to loopback on the host.
- GitHub Actions checks for JavaScript syntax, API/image tests, Prisma schema validation and API container builds.

## Cloudflare R2 storage

R2 is the selected storage provider because its standard tier currently includes a monthly free allowance of 10 GB-month storage, 1 million Class A operations and 10 million Class B operations, with no internet egress charge. Usage above the allowance is billed; this is a free allowance, not unlimited free storage. Check Cloudflare's live [R2 pricing](https://developers.cloudflare.com/r2/pricing/) before launch.

### 1. Create the buckets and credentials

1. Create or sign in to a Cloudflare account.
2. Open **Storage & databases → R2** and create two Standard buckets:
   - `laupixels-private-uploads` — private staging bucket. Do not enable public access.
   - `laupixels-public-media` — delivery bucket. Enable public read access for published wallpaper images.
3. Create an R2 API token with **Object Read & Write**, restricted to these two buckets only. Do not create an account-wide token if bucket-scoped access is available.
4. Copy the Account ID, Access Key ID and Secret Access Key. The secret is shown once.
5. Connect a custom domain to the public delivery bucket for a real launch. The `r2.dev` public development URL is acceptable for a temporary demo, but is not the production delivery domain.
6. Add the CORS policy below to the private upload bucket, replacing the origin with the exact deployed frontend origin.

```json
[
  {
    "AllowedOrigins": ["https://YOUR-FRONTEND-DOMAIN"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

The private bucket receives raw files through short-lived signed URLs. The API decodes and re-encodes accepted images, then writes only sanitized WebP files to the public bucket. Configure an R2 lifecycle rule on the private bucket to delete objects under the `incoming/` prefix after one day as a safety net for uploads that are started but never completed.

### 2. Configure the API

Copy `server/.env.example` to `server/.env` for local development, then fill in:

- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_UPLOAD_BUCKET` — private staging bucket name.
- `R2_PUBLIC_BUCKET` — public delivery bucket name. It must be different from the upload bucket.
- `R2_PUBLIC_BASE_URL` — HTTPS custom domain or temporary `r2.dev` URL for the public delivery bucket.

Keep all credentials on the API host. Never put them in `index.html`, frontend JavaScript, GitHub Pages variables exposed to the browser, or a public repository. In production, set them in the backend host's secret/environment settings. Local development works with all R2 values blank, but upload endpoints return `storage_not_configured`.

### 3. Upload flow

All upload endpoints require an administrator bearer token.

1. Request an upload URL:

```http
POST /v1/admin/uploads
Authorization: Bearer ADMIN_ACCESS_TOKEN
Content-Type: application/json

{
  "contentType": "image/jpeg",
  "sizeBytes": 2480123
}
```

2. Send the file bytes directly to the returned `uploadUrl` using HTTP `PUT` and the exact returned `Content-Type` header. The signed URL expires after five minutes.
3. Complete processing:

```http
POST /v1/admin/uploads/UPLOAD_ID/complete
Authorization: Bearer ADMIN_ACCESS_TOKEN
```

4. Use the returned `uploadId` values when creating the wallpaper:

```json
{
  "slug": "midnight-drive",
  "title": "Midnight Drive",
  "description": "A cinematic night drive.",
  "category": "Cars",
  "imageUploadId": "IMAGE_UPLOAD_ID",
  "isPublished": false
}
```

The API checks the stored byte count and declared content type, decodes the image, rejects unsupported/animated or oversized images, strips embedded metadata by re-encoding, and stores WebP originals and previews. Accepted source formats are JPEG, PNG and WebP; uploads are limited to 15 MiB and 40 million pixels. The upload record is tied to the administrator and can be attached to a wallpaper once. Supplying `imageUploadId` automatically uses the generated preview; a separate `previewUploadId` is optional.

## Run the frontend

Use any static server; do not open `index.html` as a `file://` URL if you want the service worker/PWA behaviour.

```bash
python -m http.server 8000
```

Open `http://localhost:8000`.

## Run the backend locally

Requirements: Docker Compose and Node.js 22+.

1. Copy root `.env.example` to `.env` and set a unique `POSTGRES_PASSWORD`.
2. Copy `server/.env.example` to `server/.env`.
3. Replace `JWT_SECRET` with at least 32 random bytes and set a strong unique `ADMIN_INITIAL_PASSWORD` (14+ characters). Set `CORS_ORIGINS` to the exact frontend origin.
4. Start PostgreSQL: `docker compose up -d db`.
5. For the containerised API, run `docker compose run --rm api npx prisma migrate deploy` after the database is healthy, then `docker compose run --rm api node prisma/seed.js`, then `docker compose up -d api`. For a host-run API, in `server/` run `npm install`, `npx prisma generate`, `npm run db:migrate`, `npm run db:seed`, `npm run dev` (use a host-reachable database URL in `server/.env`).
6. API endpoints: `GET /health`, `GET /ready`, `GET /v1/categories`, `GET /v1/wallpapers`, `POST /v1/admin/login`, admin upload endpoints and authenticated wallpaper create/update/delete routes.

The API binds to `127.0.0.1:8787` from the host in Compose. Do not expose it directly to the public internet without TLS termination, a reverse proxy configured for the actual hosting environment, secrets management, monitoring, backups and a security review.

## Validate the backend

From the `server/` directory:

```bash
npm install
npm run check
npm test
npm run db:validate
```

Tests cover API smoke behaviour, R2 configuration validation and image normalization. They do not replace integration tests against a running PostgreSQL database or a real R2 bucket. The same checks and a Docker image build run in GitHub Actions for pull requests and pushes to `main`.

## Important current boundaries

The frontend catalogue is still a local seed collection and is not yet connected to the API. There is no administrator dashboard or frontend upload interface, MFA, session revocation, payment system, automated copyright moderation, malware scanning or production deployment. Do not represent these as implemented. Read `SECURITY.md` before deployment.

## Deployment

The GitHub Pages workflow deploys only the static frontend. GitHub Pages cannot host the Fastify/PostgreSQL backend. The API requires a separate Node-capable host and managed PostgreSQL/database service. Configure the frontend API base URL and exact CORS origin when those services are provisioned.
