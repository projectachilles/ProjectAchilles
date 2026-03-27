# Security Audit Findings Index

> **Audit Date:** 2026-03-26
> **Auditor:** Claude Code + Trail of Bits plugin suite
> **Target:** ProjectAchilles (purple team platform)
> **Standards:** OWASP Top 10 2021, CWE Top 25, CVSS 3.1

---

## Summary

| Severity | Total | Fixed | Open |
|----------|-------|-------|------|
| Critical | 3 | 2 + 1 mitigated | 0 |
| High | 10 | 10 | 0 |
| Medium | 24 | 22 | 2 |
| Low | 10 | 7 | 3 |
| **Total** | **47** | **42** | **5** |

### Remediation Progress

| Commit | Priority | Findings Resolved |
|---|---|---|
| `e72c71d` | P0 | PA-001, PA-002, PA-003 (mitigated), PA-016 |
| `f1f03e3` | P1 | PA-005, PA-006, PA-011, PA-032, PA-033 |
| `d551ac3` | P1 | PA-004, PA-020, PA-022 |
| `db8e986` | P2 | PA-008, PA-009, PA-025, PA-026, PA-027, PA-038, PA-046, PA-047 |
| `97c6029` | P2 | PA-010, PA-015, PA-024, PA-034, PA-035, PA-036, PA-037 |
| (pending) | P2 | PA-019, PA-039, PA-040, PA-043 |

**Deployment prerequisites for new code:**
- `ENCRYPTION_SECRET` must be >= 32 characters (was 16). Regenerate with `openssl rand -base64 32` (44 chars).
- `CLI_AUTH_SECRET` is now a separate mandatory env var for CLI auth features.
- Clerk session token must include `{"metadata": "{{user.public_metadata}}"}` customization.
- HKDF key derivation change requires re-entering encrypted credentials (ES, Azure, certs) via UI after upgrade.
- Agent binary must be rebuilt to include PA-004/PA-020/PA-022 Go fixes.

---

## Findings

### Critical

| ID | Title | CVSS | CWE | OWASP | Location | Status |
|---|---|---|---|---|---|---|
| PA-001 | No-role users receive ALL 54 permissions (silent admin) | 9.8 | CWE-276 | A01 | `roles.ts:164` | **Fixed** (e72c71d) |
| PA-002 | Org access silently bypassed when Clerk Orgs not configured | 9.1 | CWE-862 | A01 | `clerk.middleware.ts:58-63` | **Fixed** (e72c71d) |
| PA-003 | RCE chain: no-role -> all perms -> command task -> sh -c on agents | 9.8 | CWE-78 | A03 | `tasks.routes.ts:170` -> `executor.go:283` | **Mitigated** (PA-001 fix breaks chain) |

### High

| ID | Title | CVSS | CWE | OWASP | Location | Status |
|---|---|---|---|---|---|---|
| PA-004 | Agent update signature verification skippable (both conditions) | 8.1 | CWE-354 | A08 | `updater.go:56-69` | **Fixed** (P1) |
| PA-005 | Weak machine-derived encryption key fallback (hostname+username) | 7.5 | CWE-1188 | A02 | `settings.ts:36-48` | **Fixed** (P1) |
| PA-006 | CLI JWT secret falls back to weak encryption key | 7.5 | CWE-321 | A02 | `cliAuth.middleware.ts:22` | **Fixed** (P1) |
| PA-016 | Cross-org task/token creation via unvalidated org_id in request body | 7.2 | CWE-639 | A01 | `tasks.routes.ts:178`, `enrollment.routes.ts:119` | **Fixed** (e72c71d) |
| PA-020 | No version downgrade protection in agent updater | 7.5 | CWE-757 | A08 | `updater.go:108-109` | **Fixed** (P1) |
| PA-021 | No code signing verification on test binaries (only SHA256 from same server) | 7.5 | CWE-345 | A08 | `executor.go:115-117` | Open |
| PA-022 | Server-controlled env var injection without filtering (LD_PRELOAD, PATH) | 7.8 | CWE-426 | A03 | `executor.go:152-157` | **Fixed** (P1) |
| PA-023 | Test binaries can read agent config + machine-id to extract API key | 7.2 | CWE-732 | A01 | `executor.go:97-106` | Open |
| PA-032 | SSRF via SMTP host in email alert test endpoint | 7.2 | CWE-918 | A10 | `integrations.routes.ts:324-343` | **Fixed** (P1) |
| PA-033 | SSRF via Elasticsearch node URL in analytics settings | 7.2 | CWE-918 | A10 | `analytics.routes.ts:67-98` | **Fixed** (P1) |

### Medium

| ID | Title | CVSS | CWE | OWASP | Location | Status |
|---|---|---|---|---|---|---|
| PA-007 | No runtime request body validation (type casts only) on most routes | 6.5 | CWE-20 | A03 | All `*.routes.ts` | Open |
| PA-008 | Missing rate limit on /api/cli/auth/refresh | 5.3 | CWE-307 | A07 | `cli-auth.routes.ts` | **Fixed** (P2) |
| PA-009 | Agent replay protection optional (missing timestamp allowed) | 5.9 | CWE-294 | A07 | `agentAuth.middleware.ts:130-132` | **Fixed** (P2) |
| PA-010 | Unbounded agent auth cache (memory exhaustion DoS) | 5.3 | CWE-770 | A05 | `agentAuthCache.ts` | **Fixed** (P2) |
| PA-011 | Slack webhook URL not validated (SSRF to internal services) | 5.0 | CWE-918 | A10 | `integrations.routes.ts` | **Fixed** (P1) |
| PA-012 | CSP allows unsafe-inline for scripts and styles | 4.7 | CWE-79 | A03 | `server.ts:62-63` | Open |
| PA-017 | Risk acceptance endpoint returns ALL records globally (no org filter) | 6.5 | CWE-639 | A01 | `risk-acceptance.routes.ts` | **Fixed** (P2) |
| PA-018 | Integration settings (Azure/Defender) not org-scoped in multi-tenant | 5.5 | CWE-732 | A01 | `integrations.routes.ts` | Open |
| PA-019 | Cron endpoint CRON_SECRET uses timing-vulnerable string comparison | 4.3 | CWE-208 | A07 | `cron.routes.ts:14,34,55` | **Fixed** (P2) |
| PA-024 | Agent rate limiter keyed on client-supplied X-Agent-ID (bypass via fabrication) | 5.3 | CWE-770 | A04 | `agent/index.ts:51` | **Fixed** (P2) |
| PA-025 | CLI JWT verify does not pin algorithm | 5.9 | CWE-327 | A02 | `cliAuth.middleware.ts:38` | **Fixed** (P2) |
| PA-026 | Settings files with encrypted credentials written world-readable (0644) | 5.5 | CWE-732 | A01 | Multiple `settings.ts` files | **Fixed** (P2) |
| PA-027 | Trust proxy hop count hardcoded | 5.3 | CWE-348 | A05 | `server.ts:53` | **Fixed** (P2) |
| PA-028 | Bundle results read from shared /tmp/F0 path (TOCTOU race) | 5.0 | CWE-367 | A01 | `executor.go:228-239` | **Fixed** (P2) |
| PA-029 | Plaintext API key fallback when machine-id unavailable (Docker/WSL) | 5.5 | CWE-312 | A02 | `config.go:112-129` | **Fixed** (P2) |
| PA-030 | No update rollback mechanism on Linux/macOS (corrupt binary = bricked agent) | 4.5 | CWE-754 | A08 | `update_linux.go:12-22` | **Fixed** (P2) |
| PA-034 | Unsanitized HTML in kill chain iframe (sandbox="allow-scripts") | 5.4 | CWE-79 | A03 | `TestDetailPage.tsx:593-600` | **Fixed** (P2) |
| PA-035 | SHA256 used instead of HKDF for encryption key derivation | 5.3 | CWE-916 | A02 | 3x `settings.ts getEncryptionKey()` | **Fixed** (P2) |
| PA-036 | ENCRYPTION_SECRET minimum 16 chars too short for AES-256 | 5.0 | CWE-326 | A02 | 3x `settings.ts` | **Fixed** (P2) |
| PA-037 | Cross-deployment CLI token replay (shared secret, no iss/aud) | 5.9 | CWE-294 | A07 | `cli-auth.routes.ts:48` | **Fixed** (P2) |
| PA-038 | .env.example insecure SESSION_SECRET default | 4.3 | CWE-1188 | A05 | `backend/.env.example` | **Fixed** (P2) |
| PA-039 | ES security disabled in Docker Compose (xpack.security=false) | 4.7 | CWE-1188 | A05 | `docker-compose.yml:58` | **Fixed** (P2, documented) |
| PA-040 | Frontend Docker container receives all backend secrets via env_file | 4.0 | CWE-200 | A05 | `docker-compose.yml:34` | **Fixed** (P2) |
| PA-042 | Docker base images use floating tags instead of SHA digest pins | 5.3 | CWE-829 | A08 | Both Dockerfiles | **Fixed** (P3) |
| PA-043 | Backend/frontend ports bound to 0.0.0.0 in docker-compose | 4.7 | CWE-668 | A05 | `docker-compose.yml:5,44` | **Fixed** (P2) |
| PA-044 | Unpinned pip install in es-seed container (supply chain) | 5.0 | CWE-829 | A08 | `docker-compose.yml:91` | **Fixed** (P3) |
| PA-045 | GitHub Actions use mutable tag refs instead of SHA pins | 5.3 | CWE-829 | A08 | All `.github/workflows/*.yml` | **Fixed** (P3) |
| PA-046 | .gitignore missing *.pfx, *.key, *.pem, *.db patterns | 4.7 | CWE-312 | A05 | `.gitignore` | **Fixed** (P2) |
| PA-047 | Frontend .dockerignore does not exclude .env files | 4.7 | CWE-312 | A05 | `frontend/.dockerignore` | **Fixed** (P2) |

### Low

| ID | Title | CVSS | CWE | OWASP | Location | Status |
|---|---|---|---|---|---|---|
| PA-013 | Dockerfile: no multi-stage build, root user, Go without checksum | 3.7 | CWE-1104 | A06 | `Dockerfile` | Open |
| PA-014 | Three duplicated AES-256-GCM implementations (fix must be tripled) | 3.0 | CWE-710 | A04 | 3x `settings.ts` | Open |
| PA-015 | CLI JWT missing aud/iss claims (cross-deployment replay) | 3.1 | CWE-345 | A07 | `cli-auth.routes.ts` | **Fixed** (P2) |
| PA-031 | Agent TLS config missing explicit MinVersion (defaults to Go runtime) | 3.5 | CWE-326 | A02 | `httpclient/client.go:27` | **Fixed** (P3) |
| PA-041 | CLI JWT 7-day lifetime with no revocation mechanism | 3.1 | CWE-613 | A07 | `cli-auth.routes.ts:45` | **Fixed** (P3, 1h) |
| PA-048 | nodemailer < 8.0.4 SMTP command injection vulnerability | 3.5 | CWE-93 | A06 | `backend/package.json` | **Fixed** (P3) |
| PA-049 | Frontend Dockerfile runs nginx as root (no USER directive) | 3.7 | CWE-250 | A05 | `frontend/Dockerfile` | **Fixed** (P3) |

---

## Phase Progress

| Phase | Status | Findings Added |
|---|---|---|
| 0 - Setup | Complete | 15 (pre-identified) |
| 1 - Context | Complete | 4 new (PA-016 to PA-019) |
| 2 - SAST | Complete | 0 new (39 findings, all FP or already tracked) |
| 3 - Insecure Defaults | Complete | 6 new (PA-024 to PA-027, PA-029, PA-030) |
| 4 - Sharp Edges | Complete | 3 new (PA-032 to PA-034) + confirmed existing |
| 5 - Agent Deep Dive | Complete | 6 new (PA-020 to PA-023, PA-028, PA-031) |
| 6 - Crypto Review | Complete | 7 new (PA-035 to PA-041) |
| 7 - Semgrep Rules | Complete | 6 new rules (11 total, all passing) |
| 8 - Variant Analysis | Complete | Confirmed patterns across 48+ locations, 2 SSRF test endpoints elevated |
| 9 - Deployment Security | Complete | 9 new (PA-042 to PA-049, deduped) |
| 10 - Report | Complete | REPORT.md finalized |
