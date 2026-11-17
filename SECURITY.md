# LAUPIXELS security posture

## Implemented in this foundation

- No private credentials are shipped to the browser.
- Fastify API with Helmet security headers, explicit CORS origin allowlist, 64 KiB request-body limit, request timeout, global rate limiting and stricter login rate limiting.
- Strict request schemas, field allowlists, URL protocol/host allowlists for remote image assets, generic error responses and redacted authorization/cookie headers in logs.
- Argon2id password hashes; administrator bootstrap rejects weak placeholder passwords.
- Short-lived JWTs with issuer/audience checks; every privileged request re-checks the administrator's active status in PostgreSQL.
- Privileged wallpaper create/update/delete operations write audit records in the same database transaction.
- Public endpoints select only intended public fields; unpublished wallpaper records are not returned.
- Prisma/PostgreSQL schema and versioned initial migration.
- Liveness and database-readiness endpoints.
- Compose binds API port to host loopback rather than all interfaces.
- PWA service worker caches GET responses only and limits cached remote wallpaper responses.

## Not implemented / not production-ready

- No direct binary upload route, image processing pipeline, object storage or signed upload URLs.
- No MFA/passkeys, admin invitation/role-management workflow, password reset or token revocation/session table.
- No frontend-to-API integration or administrator dashboard.
- No production host, TLS termination, secret manager, backup/restore process, central monitoring or alerting.
- No penetration test, independent security audit, load test or complete automated API test suite.
- No copyright/licensing moderation workflow for anime, musicians, celebrities or user submissions.

## Required before public launch

1. Deploy API behind maintained HTTPS ingress; configure trusted proxy settings narrowly for that platform and enable HSTS only after TLS is verified.
2. Provision managed PostgreSQL with least-privilege credentials, encryption, automated backups and tested restores.
3. Use a secrets manager; rotate JWT signing material. Add refresh/session revocation, MFA and audited administrator lifecycle controls.
4. Add automated tests for auth, authorization, CORS, rate limits, pagination, malformed payloads, asset host checks and failure paths.
5. Pin dependencies with a reviewed lockfile; run dependency and container vulnerability scanning continuously.
6. Implement uploads only with MIME sniffing, decode/re-encode, size and pixel limits, EXIF removal, malware scanning, private object storage, short-lived signed URLs and moderation.
7. Add privacy disclosures and data minimisation for device model hints and analytics.
8. Complete threat modelling, penetration testing, incident response and monitoring before describing the service as production-secure.

## Device data

Browser model strings are client-controlled and may be absent or spoofed. Use them only for display sizing and optional user experience. Never use them for authentication, authorisation, fraud decisions or account security.
