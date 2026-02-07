# Security Audit Report — ProjectAchilles

**Date**: 2026-02-07
**Scope**: Full application (backend + frontend + configuration)
**Method**: Automated dependency scanning + 5 parallel manual code review agents

---

## Executive Summary

This audit identified **27 unique findings** across 20+ security-critical files. The codebase demonstrates strong foundational security practices (consistent `execFile` usage, multi-layer input validation, bcrypt-hashed tokens, AES-256-GCM encryption). However, several high-priority issues require immediate attention, notably arbitrary file read/write via the payloads endpoint, missing multi-tenancy authorization, and disabled Content Security Policy.

**Dependency scanning**: 0 vulnerabilities in both frontend (551 deps) and backend (309 deps).

---

## Findings by Severity

### CRITICAL

#### C1: Arbitrary Server-Side File Read via `upload-from-path`
- **OWASP**: A01 Broken Access Control
- **Location**: `backend/src/api/endpoints/payloads.routes.ts:83-107`
- **Description**: The `POST /api/endpoints/payloads/upload-from-path` endpoint accepts a `filePath` parameter from the request body and passes it to `fs.readFileSync()` with no path restriction. An authenticated user can read any file the Node.js process can access (`.env`, SSH keys, `/etc/shadow`, etc.) and exfiltrate it to LimaCharlie storage.
- **Impact**: Full read access to any server-accessible file. Exposure of all secrets.
- **Remediation**: Restrict `filePath` to a known safe directory using `path.resolve()` + `startsWith()` check. Or remove the endpoint if not required.

#### C2: Hardcoded Production Secrets in `.env`
- **OWASP**: A02 Cryptographic Failures
- **Location**: `backend/.env:4-6, 12, 26, 29-31`
- **Description**: The `.env` file contains functional Clerk keys, a GitHub PAT, Elasticsearch credentials, and a weak session secret. While `.env` is gitignored, it exists on disk in plaintext. The `ENCRYPTION_SECRET` variable is **not set**, meaning the weak machine-ID KDF fallback is active.
- **Impact**: Full compromise of auth, source code access, and analytics if the file is exposed.
- **Remediation**: Rotate all secrets immediately. Set `ENCRYPTION_SECRET`. Use a secrets manager for non-dev deployments.

---

### HIGH

#### H1: No Multi-Tenancy Authorization on Admin Endpoints
- **OWASP**: A01 Broken Access Control
- **Location**: `backend/src/api/agent/index.ts:29-34` and all admin route handlers
- **Description**: Admin endpoints are protected by `requireClerkAuth()` but do NOT verify the authenticated user belongs to the organization they are querying. The `org_id` parameter is user-supplied and never validated against Clerk organization membership. Any authenticated user can enumerate agents, create enrollment tokens, push tasks, and delete agents in any organization.
- **Impact**: Complete cross-tenant data access and modification.
- **Remediation**: Extract org membership from Clerk JWT claims and enforce that users can only access their own organization's resources.

#### H2: Enrollment Endpoint Lacks Rate Limiting (DoS Amplification)
- **OWASP**: A07 Identification and Authentication Failures
- **Location**: `backend/src/api/agent/enrollment.routes.ts:24-45`
- **Description**: `POST /api/agent/enroll` is public with no rate limiting. Each attempt triggers O(N) bcrypt comparisons against all active tokens. An attacker can flood this endpoint to exhaust CPU.
- **Impact**: Denial of service through bcrypt CPU exhaustion.
- **Remediation**: Add rate limiting (e.g., 5-10 attempts per 15 min per IP). Consider a fast HMAC pre-check before bcrypt iteration.

#### H3: Path Traversal in Payload Download Temp Path
- **OWASP**: A03 Injection
- **Location**: `backend/src/api/endpoints/payloads.routes.ts:149`
- **Description**: The download endpoint constructs a temp path using unsanitized `req.params.name`. A name containing `../` resolves via `path.join` to an arbitrary location. Combined with attacker-controlled payload content, this achieves arbitrary file write.
- **Impact**: Remote code execution via arbitrary file write (e.g., cron jobs, `.bashrc`).
- **Remediation**: Sanitize with `path.basename()` and verify the resolved path is confined to `/tmp/`.

#### H4: Weak Key Derivation — SHA-256 of Predictable Machine Identifiers
- **OWASP**: A02 Cryptographic Failures
- **Location**: `backend/src/services/tests/settings.ts:35-37`, `backend/src/services/analytics/settings.ts:48-50`
- **Description**: When `ENCRYPTION_SECRET` is unset, encryption keys are derived from `SHA-256(hostname + username)` — no salt, no iterations, trivially brute-forceable input space.
- **Impact**: Decryption of all stored Elasticsearch credentials and certificate PFX passwords.
- **Remediation**: Make `ENCRYPTION_SECRET` mandatory. If a fallback is needed, use PBKDF2 with 600K+ iterations and a persisted random salt.

#### H5: Content Security Policy Completely Disabled
- **OWASP**: A05 Security Misconfiguration
- **Location**: `backend/src/server.ts:48-51`
- **Description**: Helmet's CSP is explicitly disabled (`contentSecurityPolicy: false`) in all environments. Without CSP, any XSS vulnerability has no browser-level mitigation.
- **Impact**: XSS attacks can steal JWT tokens, exfiltrate data, and impersonate users.
- **Remediation**: Enable CSP with a policy appropriate for the React + Clerk stack.

#### H6: Attack Flow iframe with `allow-scripts` and Wildcard `postMessage`
- **OWASP**: A03 Injection
- **Location**: `frontend/src/pages/browser/TestDetailPage.tsx:505-511`
- **Description**: Server-fetched HTML is rendered in an iframe with `sandbox="allow-scripts"`. The `postMessage` uses `'*'` as target origin. If the test data source is compromised, persistent XSS is delivered to every user viewing attack flows.
- **Impact**: Script execution within sandboxed iframe. Constrained but persistent XSS risk.
- **Remediation**: Sanitize HTML server-side or with DOMPurify before setting `srcdoc`.

---

### MEDIUM

#### M1: OpenSSL Subject String Injection
- **OWASP**: A03 Injection
- **Location**: `backend/src/services/tests/settings.ts:320-331`
- **Description**: Certificate subject fields (commonName, organization) are interpolated into the OpenSSL `-subj` string without sanitizing `/` characters. An attacker can inject additional X.509 subject fields (emailAddress, OU, etc.) into generated certificates.
- **Impact**: Misleading code-signing certificates with injected fields.
- **Remediation**: Validate subject fields against `^[a-zA-Z0-9 .\-,&'()]+$` or strip `/` characters.

#### M2: Timing Oracle in Agent Authentication
- **OWASP**: A07 Identification and Authentication Failures
- **Location**: `backend/src/middleware/agentAuth.middleware.ts:51-59`
- **Description**: The middleware returns immediately (no bcrypt) for nonexistent or disabled agents, but performs slow bcrypt comparison for active agents. Response timing reveals agent existence and status.
- **Impact**: Agent ID enumeration and status disclosure.
- **Remediation**: Always execute `bcrypt.compare()` against a dummy hash for not-found cases. Return uniform 401 for all failures.

#### M3: TOCTOU Race Condition in Enrollment Token Use-Count
- **OWASP**: A04 Insecure Design
- **Location**: `backend/src/services/agent/enrollment.service.ts:68-118`
- **Description**: The enrollment flow checks `use_count < max_uses` in a SELECT, then unconditionally increments in an UPDATE. Concurrent requests can both pass the check, allowing a `max_uses=1` token to be used multiple times.
- **Impact**: Token reuse beyond intended limits; enrollment of rogue agents.
- **Remediation**: Add `WHERE use_count < max_uses` to the UPDATE and check `changes` count.

#### M4: LimaCharlie API Key in Plaintext Session
- **OWASP**: A02 Cryptographic Failures
- **Location**: `backend/src/middleware/auth.middleware.ts:117-119, 156-159`
- **Description**: LimaCharlie API keys are stored directly in the session object in cleartext. With any persistent session store, keys would be written unencrypted.
- **Impact**: Mass credential exposure if session store is compromised.
- **Remediation**: Encrypt sensitive session fields at rest or use short-lived JWT tokens.

#### M5: Session Cookie `SameSite=None` Without CSRF Protection
- **OWASP**: A01 Broken Access Control
- **Location**: `backend/src/server.ts:84`
- **Description**: Production session cookies use `sameSite: 'none'`, permitting cross-site request attachment. No CSRF token mechanism compensates for this.
- **Impact**: CSRF on session-authenticated endpoints. Mitigated by Clerk JWT on most routes.
- **Remediation**: Implement CSRF tokens (double-submit cookie pattern) or use `SameSite=Lax`.

#### M6: Vite `allowedHosts: true` — DNS Rebinding
- **OWASP**: A05 Security Misconfiguration
- **Location**: `frontend/vite.config.ts:15, 31`
- **Description**: Both `server` and `preview` disable host header validation. Combined with the `/api` proxy, DNS rebinding attacks can reach the backend.
- **Impact**: Unauthorized access to local dev/preview server via DNS rebinding.
- **Remediation**: Use explicit allowlist: `['localhost', '.ngrok.app', '.railway.app']`.

#### M7: Rate Limiting Disabled on All Main API Routes
- **OWASP**: A07 Identification and Authentication Failures
- **Location**: `backend/src/server.ts:92-97`
- **Description**: The rate limiter is commented out. Only the agent binary download has rate limiting.
- **Impact**: Brute-force and DoS on all API endpoints.
- **Remediation**: Apply rate limiting to enrollment, auth, and configuration endpoints.

#### M8: Unrestricted File Extension Upload to Test Dirs
- **OWASP**: A04 Insecure Design
- **Location**: `backend/src/api/tests.routes.ts:239-257`, `backend/src/services/tests/buildService.ts:153-166`
- **Description**: The build upload endpoint accepts any filename (after `path.basename()` sanitization). An attacker could upload a malicious `.go` file that gets compiled by the build flow.
- **Impact**: Server-side compilation of attacker-controlled code, signed with the active certificate.
- **Remediation**: Restrict uploads to known embed dependency filenames from `getEmbedDependencies()`.

#### M9: Unsanitized Payload Name in API URL Construction
- **OWASP**: A10 Server-Side Request Forgery
- **Location**: `backend/src/services/endpoints/payloads.service.ts:38,84,204,229`
- **Description**: Payload names are interpolated into LimaCharlie API URLs without encoding.
- **Impact**: Potential manipulation of LimaCharlie API paths.
- **Remediation**: Apply `encodeURIComponent()` to payload names in URL paths.

---

### LOW

#### L1: OpenSSL/osslsigncode Password in Process Arguments
- **OWASP**: A02 Cryptographic Failures
- **Location**: `backend/src/services/tests/settings.ts:345,423,431`, `backend/src/services/tests/buildService.ts:267`, `backend/src/services/agent/agentBuild.service.ts:133`
- **Description**: Certificate passwords are passed via `-passout pass:` / `-pass` arguments, visible in `/proc/<pid>/cmdline`.
- **Impact**: Password disclosure to local users via process listing.
- **Remediation**: Use `file:` or `fd:` prefix for password passing.

#### L2: Stack Traces Leaked in Non-Production
- **OWASP**: A09 Security Logging and Monitoring Failures
- **Location**: `backend/src/middleware/error.middleware.ts:44`
- **Description**: Stack traces are included when `NODE_ENV !== 'production'`. Default (unset) behavior leaks traces.
- **Remediation**: Change to `NODE_ENV === 'development'` guard.

#### L3: Default MemoryStore for Sessions
- **OWASP**: A05 Security Misconfiguration
- **Location**: `backend/src/server.ts:70-86`
- **Description**: No persistent session store configured. MemoryStore leaks memory and loses sessions on restart.
- **Remediation**: Use a persistent store (`connect-redis`, `connect-sqlite3`) for production.

#### L4: JWT Cache Key Uses Raw API Key
- **OWASP**: A02 Cryptographic Failures
- **Location**: `backend/src/services/endpoints/auth.service.ts:19`
- **Description**: The token cache uses `oid:apiKey` as Map key, keeping the raw secret in memory.
- **Remediation**: Hash the cache key with SHA-256.

#### L5: `getUserId` Accepts `any` Type with Fallback Chain
- **OWASP**: A07 Identification and Authentication Failures
- **Location**: `backend/src/middleware/clerk.middleware.ts:26-28`
- **Description**: Uses `||` (logical OR) with multiple fallback properties, bypassing TypeScript safety.
- **Remediation**: Type properly and use nullish coalescing (`??`).

#### L6: Hardcoded Development Session Secret
- **OWASP**: A05 Security Misconfiguration
- **Location**: `backend/src/server.ts:71-77`
- **Description**: Falls back to `'project-achilles-dev-secret'` when `SESSION_SECRET` and `NODE_ENV=production` are both unset.
- **Remediation**: Consider making `SESSION_SECRET` unconditionally required.

#### L7: Bcrypt Cost Factor Below OWASP Recommendation
- **OWASP**: A02 Cryptographic Failures
- **Location**: `backend/src/services/agent/enrollment.service.ts:12`
- **Description**: `BCRYPT_ROUNDS = 10`, OWASP recommends 12+. Impact is mitigated by 256-bit token entropy.
- **Remediation**: Increase to 12.

#### L8: No MIME/Magic Byte Validation on Certificate Upload
- **OWASP**: A04 Insecure Design
- **Location**: `backend/src/api/tests.routes.ts:95-119`
- **Description**: Only validates `.pfx`/`.p12` extension, not file content. OpenSSL provides secondary validation.
- **Remediation**: Add PKCS#12 magic byte check before invoking OpenSSL.

#### L9: Content-Disposition Header Injection
- **OWASP**: A03 Injection
- **Location**: `backend/src/services/agent/binary.service.ts:50`
- **Description**: Binary name in `Content-Disposition` is not sanitized for `"`, `\r`, `\n`.
- **Remediation**: Strip special characters or use RFC 6266 `filename*=UTF-8''` encoding.

#### L10: Temp File Race Condition in Payload Upload
- **OWASP**: A05 Security Misconfiguration
- **Location**: `backend/src/api/endpoints/payloads.routes.ts:17-76`
- **Description**: Multer writes to `/tmp/lc-uploads`. Crash between write and cleanup leaves files. 500MB limit amplifies disk impact.
- **Remediation**: Use `memoryStorage()` or add startup cleanup routine.

---

### INFORMATIONAL

#### I1: Redux DevTools in Production
- **Location**: `frontend/src/store/index.ts:6-10`
- **Description**: No explicit `devTools: false` for production. RTK auto-disables in production builds, but defense-in-depth is missing.

#### I2: `withCredentials: true` on All API Requests
- **Location**: `frontend/src/hooks/useAuthenticatedApi.ts:7-8`
- **Description**: Session cookies sent with every request. Safe if backend CORS is strict. No CSRF tokens found.

#### I3: Docker Runtime Config Injection via `env-config.js`
- **Location**: `frontend/docker-entrypoint.sh:5-10`
- **Description**: Shell heredoc interpolates env vars into JavaScript without escaping. An attacker controlling env vars could inject code by breaking out of the string literal.
- **Remediation**: Use JSON encoding (e.g., `jq`) for environment variable values.

---

## Positive Security Patterns

The codebase demonstrates several strong security practices:

1. **Consistent `execFile` usage** — All subprocess calls use `execFile` with array arguments. Zero instances of `shell: true` found.
2. **Multi-layer input validation** — UUIDs validated at both route and service layers (regex + format check).
3. **High-entropy tokens** — `crypto.randomBytes(32)` for enrollment tokens and API keys (256 bits).
4. **AES-256-GCM with fresh IVs** — Encryption uses GCM mode with `crypto.randomBytes(16)` per operation. No IV reuse.
5. **Private key permissions** — Generated keys set to `0o600`.
6. **Token masking** — `listTokens()` returns `'***'` instead of hash/plaintext.
7. **Clerk auth on all routes** — Global middleware ensures authentication is enforced.
8. **`httpOnly` cookies** — Session cookies are not accessible to JavaScript.
9. **Build timeouts** — 5-minute timeout on builds, 60-second on signing.
10. **Version string validation** — `^[\w.\-]+$` regex prevents ldflags injection in Go builds.
11. **Path traversal protection** — `path.basename()` consistently used for user-supplied filenames.
12. **GitHub token sanitization** — Tokens stripped from error messages via regex.
13. **`.env` excluded from git** — `.gitignore` correctly excludes all `.env` variants.

---

## Remediation Roadmap

### P0 — Critical (Fix Immediately)
| Finding | Action |
|---------|--------|
| C1: Arbitrary file read | Restrict `upload-from-path` to allowed directories |
| C2: Secrets in `.env` | Rotate all secrets, set `ENCRYPTION_SECRET` |
| H3: Path traversal write | Sanitize download temp path with `path.basename()` |

### P1 — High (Fix This Sprint)
| Finding | Action |
|---------|--------|
| H1: Missing multi-tenancy | Add org_id validation against Clerk JWT claims |
| H2: Enrollment DoS | Add rate limiter to enrollment endpoint |
| H4: Weak KDF | Mandate `ENCRYPTION_SECRET` or use PBKDF2 |
| H5: CSP disabled | Enable helmet CSP with app-appropriate policy |
| H6: iframe XSS | Sanitize attack flow HTML with DOMPurify |

### P2 — Medium (Fix This Month)
| Finding | Action |
|---------|--------|
| M1: Subject injection | Validate cert subject fields against safe charset |
| M2: Timing oracle | Always execute bcrypt, uniform error responses |
| M3: TOCTOU race | Add WHERE clause to token use-count UPDATE |
| M4: Plaintext session keys | Encrypt sensitive session fields |
| M5: SameSite=None | Implement CSRF tokens or switch to SameSite=Lax |
| M6: allowedHosts | Use explicit domain allowlist |
| M7: Rate limiting | Enable rate limiting on auth/config endpoints |
| M8: Upload extensions | Restrict to known embed dependency filenames |
| M9: URL injection | Apply encodeURIComponent to payload names |

### P3 — Low (Backlog)
| Finding | Action |
|---------|--------|
| L1-L10, I1-I3 | See individual finding remediations above |

---

## OWASP Top 10 Coverage

| Category | Findings | Status |
|----------|----------|--------|
| A01 Broken Access Control | C1, H1, M5 | Covered |
| A02 Cryptographic Failures | C2, H4, M4, L1, L4, L7 | Covered |
| A03 Injection | H3, H6, M1, M9, L9 | Covered |
| A04 Insecure Design | M3, M8, L8 | Covered |
| A05 Security Misconfiguration | H5, M6, L3, L6, L10 | Covered |
| A06 Vulnerable Components | (none) | 0 CVEs |
| A07 Auth Failures | H2, M2, M7, L5 | Covered |
| A08 Integrity Failures | (none) | N/A |
| A09 Logging Failures | L2 | Covered |
| A10 SSRF | M9 | Covered |

---

## GitHub Actions — Continuous Security

A security review workflow has been created at `.github/workflows/security-review.yml` that runs:
1. `npm audit` on both frontend and backend dependencies
2. Claude Code security review on every PR touching source code or config files

This provides ongoing automated security review for all future changes.
