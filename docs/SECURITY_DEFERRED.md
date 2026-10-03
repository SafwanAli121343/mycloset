# Security — Deferred & Operational Items

Items implemented in code are marked ✅. Everything else in this file is either deferred (needs
infrastructure, external tooling, or more resources) or ongoing (requires periodic attention).

---

## Already Implemented ✅

| Area | What's done |
|---|---|
| Password hashing | bcrypt cost 12 in `app/api/auth/register/route.ts` |
| Timing-safe auth | Constant-time compare even on email miss (`app/api/auth/login/route.ts`) |
| Session cookies | httpOnly, secure (prod), sameSite=strict, 7-day expiry (`lib/auth/session.ts`) |
| JWT algorithm pinned | HS256 with `setProtectedHeader` — no algorithm confusion |
| JWT revocation | JTI added to all tokens; in-memory blocklist checked on every request; cleared on logout (`lib/auth/tokenRevocation.ts`) |
| Security headers | CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy (`next.config.ts`) |
| Rate limiting — auth | 5 attempts / 15 min per IP on login and register |
| Account lockout | 5 failures by email → 15-min lockout; clears on success |
| Rate limiting — ALL routes | Every API route has `applyApiRateLimit`. AI routes: 5–20/hour. Data routes: 60–120/min. Admin PIN routes: 10/15min. |
| Input validation | Email length/format, password length, sanitized strings (`lib/security/validate.ts`) |
| Body size limits | 4KB cap on auth endpoints; file size + MIME type check on image uploads; 50MB edge cap in proxy |
| SSRF protection | `assertSafeUrl` in `lib/security/ssrfGuard.ts` before any outbound URL fetch, including `remove-bg` |
| Secrets in env vars | All API keys, JWT secret, DB keys in `.env.local` (gitignored via `.env*` rule) |
| No public service key | `SUPABASE_SERVICE_ROLE_KEY` has no NEXT_PUBLIC_ prefix; never in browser bundle |
| Server-side auth enforcement | Every API route calls `getSessionFromCookies()` and returns 401 before any DB access |
| Missing auth routes fixed | `garments/analyze`, `garments/upload-image`, `remove-bg` all now require session — these were previously calling OpenAI/storage with no auth |
| User scoping on all queries | All DB reads/writes filter by `session.userId` |
| User-scoped storage paths | Uploaded images stored under `{userId}/uploads/...` not a shared prefix |
| IDOR protection | DELETE verifies ownership before deletion; PATCH uses `.eq("user_id")` in the update clause |
| Parameterized queries | Supabase JS SDK uses parameterized queries internally — no raw SQL string interpolation |
| No raw error messages to clients | All 500 responses return generic "Something went wrong." — no Supabase error details leaked |
| Scanner/bot path blocking | `proxy.ts` rejects `.php`, `.env`, `.git`, `wp-admin`, etc. with 404 |
| Page auth guard | `proxy.ts` fail-closed: every page requires auth unless explicitly in PUBLIC_PAGES |
| Dependency updates | `npm audit fix` run; next.js 16.2→16.3.2 (DoS patch) and sharp updated. 26→10 vulns remaining |
| Generic error messages | Login/register never reveals whether the email or password was wrong |
| Security npm scripts | `npm run security:audit` and `npm run security:check` added to `package.json` |
| Field allowlisting | PATCH endpoint uses an explicit ALLOWED array — no mass-assignment possible |
| Image type validation | `upload-image` rejects non-`image/` MIME types and enforces 10 MB size cap |
| SSRF + content-type guard | `remove-bg` rejects non-image remote URLs and data URIs not starting with `data:image/` |

---

## Deferred — Infrastructure / Operational

### Rate Limiting — Multi-Instance (Redis)

**Current state:** In-memory sliding window per Node.js process. Works for single-instance. On Vercel
or any multi-replica deployment, each replica maintains its own counter, so an attacker can multiply
the effective limit by the number of replicas.

**Fix when scaling:** Replace `lib/security/rateLimit.ts` store with [`@upstash/ratelimit`](https://github.com/upstash/ratelimit) + Upstash Redis.
One-line swap per route: the API surface is identical.

### JWT Revocation — Persistent Store

**Current state:** In-memory blocklist in `lib/auth/tokenRevocation.ts`. Cleared on server restart.
A revoked token becomes valid again if the process restarts within its 7-day expiry window.

**Fix:** Store revoked JTIs in Redis with TTL set to the token's remaining lifetime. On Supabase,
could alternatively use a `revoked_tokens` table (`jti TEXT PRIMARY KEY, expires_at TIMESTAMPTZ`) and
query it in `verifySession`. Add a cleanup cron that deletes expired rows.

**Shorter-term mitigation:** Reduce JWT expiry from 7 days to 1 hour; issue a refresh token (HTTP-only
cookie, stored in DB) that rotates on use. Logout invalidates the refresh token immediately.

### TLS / Certificate Management

Managed by your hosting provider (Vercel, Cloudflare, etc.). Ensure:
- Auto-renewal is on (Vercel/Cloudflare handle this automatically)
- HSTS preload list submission once the domain is stable: https://hstspreload.org
- Review certificate on rotation — provider usually handles with zero downtime

### Supabase Row Level Security (RLS)

**Current state:** All DB access goes through the service-role key (bypasses RLS by design —
documented in `lib/db/garments.ts`). App-level `userId` checks in every route enforce access control.

**If the anon key ever needs DB access from the browser:** Enable RLS on all tables:
```sql
-- Enable RLS
ALTER TABLE garments ENABLE ROW LEVEL SECURITY;
ALTER TABLE outfits ENABLE ROW LEVEL SECURITY;
ALTER TABLE wardrobe_state ENABLE ROW LEVEL SECURITY;

-- Policy: users can only see/modify their own rows
CREATE POLICY "own_rows" ON garments FOR ALL USING (auth.uid()::text = user_id);
```
Because auth is custom JWT (not Supabase Auth), `auth.uid()` will be the custom claim — requires
setting `jwt_secret` in Supabase dashboard to match your `JWT_SECRET` env var.

### Multi-Factor Authentication (MFA)

Not implemented. Recommended for admin accounts before launch. Options:
- TOTP (Google Authenticator) — add `totp_secret` to users table, verify on login
- Supabase Auth's built-in MFA (requires switching to Supabase Auth)
- Auth0 / Clerk for managed MFA + SSO

### Bot Protection / CAPTCHA

Current protection: rate limiting + account lockout. For additional bot protection:
- **hCaptcha** or **Cloudflare Turnstile** on the register and login forms — add token to POST body, verify server-side before bcrypt/DB calls
- **Device fingerprinting** (FingerprintJS) to detect credential-stuffing bots across IPs
- Cloudflare WAF bot score if traffic is behind Cloudflare

### Session Activity Monitoring & Anomaly Detection

Not implemented. Best practices:
- Log all login attempts (success/failure) with IP, user-agent, timestamp to an append-only audit table
- Alert on: >3 logins from different countries in 1 hour, login after long inactivity, login from new device
- Log all sensitive actions: delete garment, change email, change password

### PII Handling & Data Retention

- Define what counts as PII: email addresses, potentially garment data if it identifies preferences
- Add a `/api/user/delete-account` endpoint that hard-deletes all garments, outfits, and the user row
- For GDPR/CCPA: add a data-export endpoint (`/api/user/export`) returning all user data as JSON
- Data retention policy: decide how long to keep deleted accounts' data (typically 30 days in case of accidental deletion)

### Audit Trails / Tamper-Evident Logging

- Append-only `audit_log` table: `(id, user_id, action, metadata JSONB, created_at TIMESTAMPTZ)`
- Log: login, logout, garment add/delete, outfit save/delete, password change, failed logins
- Export to a SIEM or time-series store (Datadog, Grafana Cloud) for alerting

### Dependency Scanning in CI

- Add `npm audit --audit-level=high` as a required CI step — fail the build if new high/critical vulns
- Consider `npm audit --audit-level=moderate` once the build is stable
- Use `dependabot` or `renovate` for automatic PR-based dependency updates

### Remaining Unfixable Vulnerabilities (as of 2026-08-21)

| Package | Severity | Notes |
|---|---|---|
| `tar` (via `@capacitor/cli`) | CRITICAL | Build tool only, never runs in production server. Monitor for `@capacitor/cli` update |
| `lodash` (via `@imgly/background-removal-node`) | HIGH | Code injection via `_.template` — not used in this codebase's call path. Monitor for package update |
| `sharp@0.32.6` (nested in `@imgly`) | HIGH | Old sharp nested inside the package. Not the same instance used for image processing. Monitor |
| `postcss` | HIGH | Build-time CSS tool. XSS only relevant if serving the postcss output as user-controlled HTML (it isn't) |
| `zod` (nested in `@imgly`) | MODERATE | DoS on malformed input — only affects the background-removal pipeline's internal schema validation |

None of these are exploitable in the current production runtime path. Revisit when upstream packages ship fixes.

---

## Deferred — Architecture / Engineering

### Refresh Token Rotation

Replace the 7-day JWT with a 15-minute access token + long-lived refresh token (stored as httpOnly
cookie, tracked in DB). On each API call, verify the access token; on expiry, exchange the refresh
token for a new pair. This limits the damage window of a stolen token to 15 minutes even without
revocation infrastructure.

### Circuit Breakers & Retry Logic

- Wrap OpenAI calls in a circuit breaker (e.g., `opossum`): if 3+ consecutive failures, fast-fail
  for 30 seconds instead of waiting for each timeout
- Add exponential backoff to Supabase DB retries

### Concurrency & Race Conditions

- Garment insert is not idempotent — if the client double-submits, two rows are created. Add a
  dedup key (hash of image + user_id + title) with a UNIQUE constraint
- Outfit save: use Supabase `upsert` with a conflict target to prevent duplicate outfit rows for the same date

### File Upload Hardening

Current: image data arrives as base64 string in JSON body. To harden:
- Accept multipart/form-data uploads instead of base64 (more efficient, avoids 33% size overhead)
- Validate magic bytes (first 4 bytes) to confirm JPEG/PNG/WebP regardless of Content-Type header
- Cap upload size at the route level (currently capped at 50MB in middleware; should be tighter for image-only routes, e.g. 10MB)
- Scan uploaded images for malware if compliance requires it (e.g., ClamAV)

### API Response Trimming

Several routes return full `SELECT *` which may expose fields you don't need on the client. Where
performance matters, enumerate only the needed columns. Already done on some routes (analysis, scoring);
audit remaining GET /api/garments which returns all columns including metadata clients don't use.

### Secrets Rotation Plan

- `JWT_SECRET`: if compromised, changing it immediately invalidates all sessions (good). Document
  how to rotate without service disruption (rolling rotation window)
- `OPENAI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`: rotate in Supabase/OpenAI dashboards; update env
  vars in hosting provider without redeployment (Vercel env var UI)

---

## Deferred — Testing

### Integration Testing

- Auth flow: register → login → session-protected route → logout → confirm 401
- Rate limit: 6th login attempt within 15 minutes returns 429
- Account lockout: 5 wrong-password attempts lock the email for 15 min

### End-to-End Testing

- Playwright suite for critical paths: add garment, view closet, build outfit, wardrobe analysis page load
- Run in CI against a staging Supabase project

### Load / Stress Testing

- Identify capacity limits before launch with k6 or Artillery
- Focus on: garments POST (AI inference path), analysis (OpenAI), concurrent session handling
- Target: understand RPS ceiling before rate limiting kicks in

### Chaos Engineering

- Simulate Supabase unavailability: confirm app returns a graceful error, not a 500 stack trace
- Simulate OpenAI timeout: confirm the image-inference path degrades gracefully

---

## Deferred — Compliance & Governance

### GDPR / CCPA

- Privacy policy must list all third parties that receive data (OpenAI, Supabase, Google Lens)
- Right to erasure: implement `/api/user/delete` (deletes all rows, cancels any background jobs)
- Right to data portability: implement `/api/user/export`
- Cookie consent banner if you use analytics

### Regulatory Compliance

- If storing health/payment data in future: HIPAA / PCI-DSS apply
- Currently out of scope — recheck if feature set expands

### Disaster Recovery

- **RTO** (Recovery Time Objective): define acceptable downtime — recommend < 1 hour
- **RPO** (Recovery Point Objective): define acceptable data loss — Supabase provides PITR (point-in-time recovery) on Pro plan
- Document recovery runbook: which env vars to restore, how to redeploy, how to verify DB integrity

### Code Review Process

- Require PR reviews before merging to main
- Use GitHub branch protection: require 1 approval, require status checks to pass
- Add `npm audit --audit-level=high` and TypeScript strict mode to CI checks

---

## Quick Reference: Security Checklist Before Launch

- [ ] Supabase RLS enabled on all tables (or service-role-only access locked down in DB settings)
- [ ] `npm audit` passes at `--audit-level=high` in CI
- [ ] Rate limiting backed by Redis for multi-instance production
- [ ] JWT expiry shortened to 1 hour + refresh token rotation implemented
- [ ] CAPTCHA on login/register forms
- [ ] Audit log table created and populated
- [ ] User data export and delete endpoints live
- [ ] Privacy policy published and linked in footer
- [ ] HSTS preload submitted for the production domain
