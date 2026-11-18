# LAUPIXELS security posture

## Implemented in this foundation

- No private credentials are shipped to the browser.
- Fastify API with Helmet security headers, explicit CORS origin allowlist, 64 KiB JSON request-body limit, request timeout, global and route-specific rate limiting and generic error responses.
- Strict request schemas, field allowlists, HTTPS host allowlists for third-party image URLs and redacted authorization/cookie headers in logs.
- Argon2id password hashes; administrator bootstrap rejects weak placeholder passwords.
- Short-lived JWTs with issuer/audience checks; every privileged request re-checks the administrator's active status in PostgreSQL.
- Privileged wallpaper and media-upload operations write audit records in database transactions.
- ImageKit private credentials remain server-side. Browser uploads use five-minute, one-time HMAC-signed upload parameters; the private key is never sent to the browser.
- Upload intents are tied to the requesting administrator, rate-limited, size-limited and checked against the stored object size and content type before processing.
- Sharp decodes accepted JPEG/PNG/WebP files, rejects invalid/animated/oversized images, limits input pixels, applies orientation, re-encodes to WebP and removes embedded EXIF/GPS metadata.
- Original and preview WebP objects use unpredictable keys; wallpaper records can reference only completed uploads belonging to the administrator.
- Public endpoints select only intended public wallpaper fields; unpublished wallpaper records are not returned.
- Prisma/PostgreSQL schema and versioned migrations.
- Liveness and database-readiness endpoints.
- Compose binds API port to host loopback rather than all interfaces.
- PWA service worker caches GET responses only and limits cached remote wallpaper responses.

## Not implemented / not production-ready

- No administrator dashboard or frontend upload interface.
- No MFA/passkeys, admin invitation/role-management workflow, password reset or token revocation/session table.
- No automated malware scanning, copyright verification, moderation workflow or user-submission review.
- No automatic deletion of final media objects when wallpapers are removed; configure retention and orphan cleanup before large-scale use.
- No production host, TLS termination, secret manager, backup/restore process, central monitoring or alerting.
- No penetration test, independent security audit, load test or complete automated API test suite.

## Required before public launch

1. Deploy API behind maintained HTTPS ingress; configure trusted proxy settings narrowly for that platform and enable HSTS only after TLS is verified.
2. Provision managed PostgreSQL with least-privilege credentials, encryption, automated backups and tested restores.
3. Use a secrets manager; rotate JWT signing material. Add refresh/session revocation, MFA and audited administrator lifecycle controls.
4. Keep ImageKit private credentials in the backend host's secret manager. Set storage usage alerts and monitor free-plan storage/bandwidth quotas.
5. Add automated tests for auth, authorization, CORS, rate limits, pagination, malformed payloads, asset host checks, upload races and storage failure paths.
6. Pin dependencies with a reviewed lockfile; run dependency and container vulnerability scanning continuously.
7. Add malware scanning and a copyright/moderation process before accepting uploads from anyone other than trusted administrators.
8. Add retention/orphan cleanup for media objects and test deletion/restore procedures.
9. Complete threat modelling, penetration testing, incident response and monitoring before describing the service as production-secure.

## Device data

Browser model strings are client-controlled and may be absent or spoofed. Use them only for display sizing and optional user experience. Never use them for authentication, authorisation, fraud decisions or account security.
