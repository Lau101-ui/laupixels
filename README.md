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
│   ├── src/storage/imagekit.js   # ImageKit upload and media API adapter
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
- ImageKit integration using short-lived, server-generated upload signatures; private API keys remain on the backend.
- Original uploads are checked against the administrator's pending upload intent, decoded and re-encoded before sanitized WebP files are saved to ImageKit.
- Server-side image decoding and WebP re-encoding, generated previews, pixel/byte limits and EXIF metadata removal.
- Liveness and database-readiness endpoints.
- Local Docker Compose setup with database health checks and API bound to loopback on the host.
- GitHub Actions checks for JavaScript syntax, API/image tests, Prisma schema validation and API container builds.

## ImageKit storage

ImageKit is the selected media provider. Its Free plan is subject to storage and bandwidth quotas; free availability and limits can change, so verify the current plan in your ImageKit dashboard. LAUPIXELS does not require a payment card to be configured in the application, but the provider account's own billing terms and quota behaviour still apply.

### Configure the API

In ImageKit, open **Developer options** and locate the Public Key, Private Key and URL Endpoint. Set these backend environment variables:

- `IMAGEKIT_PUBLIC_KEY`
- `IMAGEKIT_PRIVATE_KEY` — secret; backend only.
- `IMAGEKIT_URL_ENDPOINT` — HTTPS URL endpoint for your media library.

Keep the private key in the API host's secret/environment settings. Never place it in `index.html`, frontend JavaScript, GitHub Pages variables exposed to the browser, or a public repository. Leave all three values blank for local development without uploads; upload endpoints then return `storage_not_configured`.

### Upload flow

All upload endpoints require an administrator bearer token. The API issues a five-minute, one-time upload signature. The browser uses ImageKit's upload API with the returned token, signature, expiry and public key, then submits the resulting ImageKit file ID to the completion endpoint. The API verifies the file is in the expected incoming folder, checks its size, fetches it only from the configured ImageKit host, decodes and re-encodes JPEG/PNG/WebP to WebP, removes embedded metadata and stores a full image plus a preview. The original incoming file is deleted after successful processing.

Accepted source formats are JPEG, PNG and WebP; uploads are limited to 15 MiB and 40 million pixels. A completed upload is tied to the administrator and can be attached to a wallpaper once.

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

Tests cover API smoke behaviour, ImageKit configuration validation and image normalization. They do not replace integration tests against a running PostgreSQL database or a live ImageKit account. The same checks and a Docker image build run in GitHub Actions for pull requests and pushes to `main`.

## Important current boundaries

The frontend catalogue is still a local seed collection and is not yet connected to the API. There is no administrator dashboard or frontend upload interface, MFA, session revocation, payment system, automated copyright moderation, malware scanning or production deployment. Do not represent these as implemented. Read `SECURITY.md` before deployment.

## Deployment

The GitHub Pages workflow deploys only the static frontend. GitHub Pages cannot host the Fastify/PostgreSQL backend. The API requires a separate Node-capable host and managed PostgreSQL/database service. Configure the frontend API base URL and exact CORS origin when those services are provisioned.
