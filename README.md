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
│   ├── src/app.js                # Fastify API, auth, validation, admin routes
│   ├── src/server.js             # API process and graceful shutdown
│   ├── test/app.test.js          # API smoke tests
│   ├── package.json              # API dependencies and scripts
│   ├── prisma/schema.prisma      # PostgreSQL data model
│   ├── prisma/migrations/        # Versioned initial migration
│   ├── prisma/seed.js            # First administrator bootstrap
│   └── .env.example              # API environment template
├── SECURITY.md                   # Security posture and production gates
└── README.md
```

## Current foundation

- PWA frontend with install affordance, category browsing, search, preview and device-sized export.
- Best-effort device model detection. Browser-supplied model strings are hints only; iOS and some Android browsers intentionally withhold exact model data.
- Fastify API with Helmet, explicit CORS allowlist, request-size cap, global and login rate limits, strict request validation and generic error responses.
- PostgreSQL via Prisma, explicit public-field selection, category endpoint, cursor pagination, admin create/update/delete routes.
- Argon2id administrator password hashing and short-lived JWTs. Admin active status is checked on each protected request.
- Transactional audit records for wallpaper administration.
- Liveness and database-readiness endpoints.
- Local Docker Compose setup with database health checks and API bound to loopback on the host.
- GitHub Actions checks for JavaScript syntax, API smoke tests, Prisma schema validation and API container builds.

## Run the frontend

Use any static server; do not open `index.html` as a `file://` URL if you want the service worker/PWA behaviour.

```bash
python -m http.server 8000
```

Open `http://localhost:8000`.

## Run the backend locally

Requirements: Docker Compose and Node.js 22+.

1. Copy `.env.example` to root `.env` and set a unique `POSTGRES_PASSWORD`.
2. Copy `server/.env.example` to `server/.env`.
3. Replace `JWT_SECRET` with at least 32 random bytes and set a strong unique `ADMIN_INITIAL_PASSWORD` (14+ characters). Set `CORS_ORIGINS` to the exact frontend origin.
4. Start PostgreSQL: `docker compose up -d db`.
5. For the containerised API, run `docker compose run --rm api npx prisma migrate deploy` after the database is healthy, then `docker compose run --rm api node prisma/seed.js`, then `docker compose up -d api`. For a host-run API, in `server/` run `npm install`, `npx prisma generate`, `npm run db:migrate`, `npm run db:seed`, `npm run dev` (use a host-reachable database URL in `server/.env`).
6. API endpoints: `GET /health`, `GET /ready`, `GET /v1/categories`, `GET /v1/wallpapers`, `POST /v1/admin/login`, and authenticated admin wallpaper create/update/delete routes.

The API binds to `127.0.0.1:8787` from the host in Compose. Do not expose it directly to the public internet without TLS termination, a reverse proxy configured for the actual hosting environment, secrets management, monitoring, backups and a security review.

## Validate the backend

From the `server/` directory:

```bash
npm install
npm run check
npm test
npm run db:validate
```

The API smoke tests cover liveness, CORS rejection, login request validation and protection of admin write routes. They do not replace integration tests against a running PostgreSQL database. The same checks and a Docker image build run in GitHub Actions for pull requests and pushes to `main`.

## Neon Managed Better Auth

The static PWA includes an email/password account panel powered by Neon's Managed Better Auth SDK. The browser SDK is loaded as an ES module from esm.sh; the public branch Auth URL is configured in the module in `index.html`. The Auth URL is public configuration, not a secret. Passwords and auth records are handled by Neon; this frontend does not store passwords.

Email sign-up and sign-in are enabled on the Neon `production` branch. Email verification is currently disabled in the Neon Console, so new accounts are not required to prove mailbox ownership. Enable verification and configure the email provider before treating accounts as verified identities.

The account panel calls `signUp.email`, `signIn.email`, `getSession`, and `signOut`. Session persistence depends on the browser accepting the Managed Auth session cookies. Some browsers block cross-site cookies for a GitHub Pages origin; if session restoration fails, use a supported same-site custom-domain/proxy setup rather than weakening authentication.

A live signup against Neon and a real-user session read still need to be performed in a browser. GitHub Actions currently validates the API backend and does not exercise browser-to-Neon authentication.

## Important current boundaries

This is a development foundation, not a completed commercial backend. The frontend catalogue is still a local seed collection and is not yet connected to the API. There is no image-upload endpoint, object-storage integration, administrator UI, MFA, session revocation, payment system, moderation workflow or production deployment. Do not represent these as implemented. Read `SECURITY.md` before deployment.

## Deployment

The GitHub Pages workflow deploys only the static frontend. GitHub Pages cannot host the Fastify/PostgreSQL backend. The API requires a separate Node-capable host and managed PostgreSQL/database service. Configure the frontend API base URL and exact CORS origin when those services are provisioned.
