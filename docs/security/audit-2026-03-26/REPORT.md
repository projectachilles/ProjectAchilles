# ProjectAchilles Security Audit Report

> **Classification:** Confidential
> **Audit Date:** 2026-03-26
> **Auditor:** Claude Code with Trail of Bits plugin suite
> **Methodology:** Manual code review + automated SAST (Semgrep) + custom rule development + variant analysis
> **Standards:** OWASP Top 10 2021, CWE Top 25, CVSS 3.1
> **Scope:** Full codebase — backend (Express/TS), backend-serverless (Vercel), frontend (React), Go agent, Docker/CI infrastructure

---

## Executive Summary

ProjectAchilles is a purple team platform for continuous security validation. This audit examined the complete codebase across 5 deployment targets, 2 parallel backend implementations, a Go endpoint agent, and supporting infrastructure.

### Risk Posture

| Severity | Total | Fixed | Open | Key Themes |
|----------|-------|-------|------|------------|
| **Critical** | 3 | **3** | 0 | Authentication bypass chain leading to RCE on enrolled agents |
| **High** | 10 | **10** | 0 | SSRF vectors, unsigned binaries, env var injection, missing verification |
| **Medium** | 24 | **14** | 10 | Weak crypto defaults, rate limit bypasses, validation gaps, supply chain |
| **Low** | 10 | **1** | 9 | Dockerfile hardening, TLS config, deployment config |
| **Total** | **47** | **27 (57%)** | **20** | All Critical and High resolved in same session |

> **Remediation status as of 2026-03-27:** All Critical and High severity findings have been resolved across 5 commits. See FINDINGS-INDEX.md for per-finding status and deployment prerequisites.

### Top 3 Attack Chains

**1. Unauthenticated-to-RCE (PA-001 + PA-003)**
A user with no role assigned silently receives all 54 permissions including `endpoints:tasks:command`. They can create arbitrary shell command tasks that execute as root/SYSTEM on any enrolled agent via `sh -c`. This is the highest-severity chain — it requires only a valid Clerk account with no role.

**2. Backend Compromise to Fleet Takeover (PA-004 + PA-020 + PA-021 + PA-022)**
If the backend server is compromised, every enrolled agent is fully compromised: updates have optional signature verification (PA-004), version downgrades are not blocked (PA-020), test binaries have no code signing (PA-021), and the server can inject arbitrary environment variables including `LD_PRELOAD` (PA-022). No additional verification layers exist between server and agent.

**3. SSRF to Cloud Metadata Exfiltration (PA-032 + PA-033 + PA-011)**
Three independent SSRF vectors allow authenticated admin users to make server-side requests to arbitrary URLs: SMTP host configuration, Elasticsearch node URL, and Slack webhook URL. These can target cloud metadata endpoints (169.254.169.254), internal services, or external infrastructure.

### Strengths

The codebase demonstrates strong security fundamentals in several areas:
- Timing-safe bcrypt comparison with dummy hash (prevents agent enumeration)
- AES-256-GCM encryption with random IVs and proper auth tag verification
- Parameterized SQLite queries throughout (no SQL injection)
- Path traversal protection with `path.basename()` and whitelist validation
- HTTPS-to-HTTP downgrade protection in the Go agent
- Agent config file permissions properly set (0600 / icacls)
- Enrollment tokens hashed with bcrypt, single-use, rate-limited
- Agent API keys: 256-bit entropy, bcrypt-hashed, dual-key rotation

---

## Findings by Severity

### Critical (CVSS 9.0-10.0)

#### PA-001: No-Role Users Receive ALL 54 Permissions
- **CVSS:** 9.8 (AV:N/AC:L/PR:L/UI:N/S:C/C:H/I:H/A:H)
- **CWE:** CWE-276 (Incorrect Default Permissions)
- **OWASP:** A01:2021 Broken Access Control
- **Location:** `backend/src/types/roles.ts:164`
- **Description:** `getPermissionsForRole(undefined)` returns `new Set(ALL_PERMISSIONS)`. Any authenticated Clerk user without an explicit role assignment receives full admin access including `endpoints:tasks:command` (RCE), `integrations:write` (credential access), and `settings:users:manage` (self-escalation).
- **Impact:** Privilege escalation from any authenticated user to full admin. Combined with PA-003, this enables remote code execution on all enrolled agents.
- **Remediation:** Change the undefined role fallback to return an empty set or the most restrictive role (`explorer`). Add a startup warning when users are detected without roles.

#### PA-002: Org Access Silently Bypassed When Clerk Orgs Not Configured
- **CVSS:** 9.1 (AV:N/AC:L/PR:L/UI:N/S:C/C:H/I:H/A:N)
- **CWE:** CWE-862 (Missing Authorization)
- **OWASP:** A01:2021 Broken Access Control
- **Location:** `backend/src/middleware/clerk.middleware.ts:58-63, 86-90`
- **Description:** Both `requireOrgAccess()` and `requireAgentOrgAccess()` call `next()` when the JWT has no org claim. Multi-tenant isolation is completely disabled — users from org A can access agents, tasks, and tokens belonging to org B.
- **Impact:** Complete tenant isolation failure. Cross-org data access, task creation, and agent manipulation.
- **Remediation:** Default to deny (return 403) when `userOrgId` is undefined. Require Clerk Organizations to be configured for multi-tenant deployments.

#### PA-003: RCE Chain via Command Tasks
- **CVSS:** 9.8 (AV:N/AC:L/PR:L/UI:N/S:C/C:H/I:H/A:H)
- **CWE:** CWE-78 (OS Command Injection)
- **OWASP:** A03:2021 Injection
- **Location:** `backend/src/api/agent/tasks.routes.ts:170` -> `agent/internal/executor/executor.go:283`
- **Description:** `POST /admin/tasks/command` accepts a freeform `command` string (validated only for non-empty and max 10KB). This is stored verbatim in SQLite, polled by agents, and executed via `sh -c <command>` (Linux) or `cmd.exe /C` (Windows) with root/SYSTEM privileges. Working directory is `/` (Linux) or `C:\` (Windows).
- **Impact:** Arbitrary command execution on any enrolled endpoint as root/SYSTEM. When combined with PA-001 (no role = all permissions), any authenticated user can achieve RCE.
- **Remediation:** Add command allowlist/validation, require explicit confirmation for command tasks, add audit logging, consider removing freeform command execution in favor of predefined task types.

### High (CVSS 7.0-8.9)

| ID | Title | CVSS | CWE | Location |
|---|---|---|---|---|
| PA-004 | Agent update signature verification skippable | 8.1 | CWE-354 | `updater.go:56-69` |
| PA-005 | Weak machine-derived encryption key fallback | 7.5 | CWE-1188 | `settings.ts:36-48` (3 copies) |
| PA-006 | CLI JWT secret falls back to weak encryption key | 7.5 | CWE-321 | `cliAuth.middleware.ts:22` |
| PA-016 | Cross-org task/token creation via unvalidated org_id | 7.2 | CWE-639 | `tasks.routes.ts:178` |
| PA-020 | No version downgrade protection in agent updater | 7.5 | CWE-757 | `updater.go:108-109` |
| PA-021 | No code signing on test binaries (SHA256 from same server) | 7.5 | CWE-345 | `executor.go:115-117` |
| PA-022 | Server-controlled env var injection (LD_PRELOAD, PATH) | 7.8 | CWE-426 | `executor.go:152-157` |
| PA-023 | Test binaries can read agent config to extract API key | 7.2 | CWE-732 | `executor.go:97-106` |
| PA-032 | SSRF via SMTP host in email alert test endpoint | 7.2 | CWE-918 | `integrations.routes.ts:324-343` |
| PA-033 | SSRF via Elasticsearch node URL in analytics settings | 7.2 | CWE-918 | `analytics.routes.ts:67-98` |

### Medium (CVSS 4.0-6.9)

| ID | Title | CVSS | CWE | Location |
|---|---|---|---|---|
| PA-007 | No runtime request body validation on most routes | 6.5 | CWE-20 | All `*.routes.ts` |
| PA-008 | Missing rate limit on /api/cli/auth/refresh | 5.3 | CWE-307 | `cli-auth.routes.ts` |
| PA-009 | Agent replay protection optional (missing timestamp) | 5.9 | CWE-294 | `agentAuth.middleware.ts:130-132` |
| PA-010 | Unbounded agent auth cache (memory DoS) | 5.3 | CWE-770 | `agentAuthCache.ts` |
| PA-011 | Slack webhook URL not validated (SSRF) | 5.0 | CWE-918 | `integrations.routes.ts` |
| PA-012 | CSP allows unsafe-inline for scripts and styles | 4.7 | CWE-79 | `server.ts:62-63` |
| PA-017 | Risk acceptance returns ALL records (no org filter) | 6.5 | CWE-639 | `risk-acceptance.routes.ts` |
| PA-018 | Integration settings not org-scoped in multi-tenant | 5.5 | CWE-732 | `integrations.routes.ts` |
| PA-019 | Cron CRON_SECRET timing-vulnerable string comparison | 4.3 | CWE-208 | `cron.routes.ts` |
| PA-024 | Rate limiter keyed on client-supplied X-Agent-ID | 5.3 | CWE-770 | `agent/index.ts:51` |
| PA-025 | CLI JWT verify does not pin algorithm | 5.9 | CWE-327 | `cliAuth.middleware.ts:38` |
| PA-026 | Settings files written world-readable (0644) | 5.5 | CWE-732 | Multiple `settings.ts` |
| PA-027 | Trust proxy hop count hardcoded | 5.3 | CWE-348 | `server.ts:53` |
| PA-028 | Bundle results read from shared /tmp (TOCTOU) | 5.0 | CWE-367 | `executor.go:228-239` |
| PA-029 | Plaintext API key fallback when machine-id unavailable | 5.5 | CWE-312 | `config.go:112-129` |
| PA-030 | No update rollback on Linux/macOS | 4.5 | CWE-754 | `update_linux.go:12-22` |
| PA-034 | Unsanitized HTML in kill chain iframe | 5.4 | CWE-79 | `TestDetailPage.tsx:593-600` |
| PA-035 | SHA256 instead of HKDF for key derivation | 5.3 | CWE-916 | 3x `settings.ts` |
| PA-036 | ENCRYPTION_SECRET minimum 16 chars too short | 5.0 | CWE-326 | 3x `settings.ts` |
| PA-037 | Cross-deployment CLI token replay | 5.9 | CWE-294 | `cli-auth.routes.ts` |
| PA-038 | .env.example insecure SESSION_SECRET default | 4.3 | CWE-1188 | `backend/.env.example` |
| PA-039 | ES security disabled in Docker Compose | 4.7 | CWE-1188 | `docker-compose.yml:58` |
| PA-040 | Frontend container receives all backend secrets | 4.0 | CWE-200 | `docker-compose.yml:34` |
| PA-042 | Docker base images use floating tags (supply chain) | 5.3 | CWE-829 | Both Dockerfiles |
| PA-043 | Ports bound to 0.0.0.0 in docker-compose | 4.7 | CWE-668 | `docker-compose.yml` |
| PA-044 | Unpinned pip install in es-seed container | 5.0 | CWE-829 | `docker-compose.yml:91` |
| PA-045 | GitHub Actions use mutable tags not SHA pins | 5.3 | CWE-829 | All workflow files |
| PA-046 | .gitignore missing cert/database file patterns | 4.7 | CWE-312 | `.gitignore` |
| PA-047 | Frontend .dockerignore doesn't exclude .env | 4.7 | CWE-312 | `frontend/.dockerignore` |

### Low (CVSS 0.1-3.9)

| ID | Title | CVSS | CWE | Location |
|---|---|---|---|---|
| PA-013 | Dockerfile: no multi-stage build, root user, Go without checksum | 3.7 | CWE-1104 | `Dockerfile` |
| PA-014 | Three duplicated AES-256-GCM implementations | 3.0 | CWE-710 | 3x `settings.ts` |
| PA-015 | CLI JWT missing aud/iss claims | 3.1 | CWE-345 | `cli-auth.routes.ts` |
| PA-031 | Agent TLS missing explicit MinVersion | 3.5 | CWE-326 | `httpclient/client.go:27` |
| PA-041 | CLI JWT 7-day lifetime with no revocation | 3.1 | CWE-613 | `cli-auth.routes.ts:45` |
| PA-048 | nodemailer < 8.0.4 SMTP command injection | 3.5 | CWE-93 | `backend/package.json` |
| PA-049 | Frontend Dockerfile runs nginx as root | 3.7 | CWE-250 | `frontend/Dockerfile` |

---

## OWASP Top 10 Coverage

| Category | Findings | Status |
|---|---|---|
| **A01: Broken Access Control** | PA-001, PA-002, PA-016, PA-017, PA-018, PA-023, PA-026, PA-028 | 8 findings |
| **A02: Cryptographic Failures** | PA-005, PA-006, PA-025, PA-029, PA-031, PA-035, PA-036, PA-037 | 8 findings |
| **A03: Injection** | PA-003, PA-007, PA-012, PA-022, PA-034 | 5 findings |
| **A04: Insecure Design** | PA-010, PA-014, PA-024, PA-030 | 4 findings |
| **A05: Security Misconfiguration** | PA-027, PA-038, PA-039, PA-040 | 4 findings |
| **A06: Vulnerable Components** | PA-013 | 1 finding |
| **A07: Auth and Session** | PA-008, PA-009, PA-015, PA-019, PA-041 | 5 findings |
| **A08: Software Integrity** | PA-004, PA-020, PA-021 | 3 findings |
| **A09: Logging and Monitoring** | (covered by error leakage findings) | Partial |
| **A10: SSRF** | PA-011, PA-032, PA-033 | 3 findings |

---

## Remediation Roadmap

### P0 — Immediate (Week 1)
These findings enable RCE or complete access control bypass:

| Finding | Fix |
|---|---|
| **PA-001** | Change `getPermissionsForRole(undefined)` to return empty set or `explorer` role permissions |
| **PA-002** | Change `requireOrgAccess` to return 403 when org claim is missing (not `next()`) |
| **PA-003** | Add command validation/allowlist; require confirmation for command tasks |
| **PA-016** | Validate `org_id` in request body matches user's own org from JWT |

### P1 — Short-term (Week 2-3)
These enable binary tampering, credential exposure, or privilege escalation:

| Finding | Fix |
|---|---|
| **PA-004** | Make signature verification mandatory (reject updates without valid signature) |
| **PA-005** | Make `ENCRYPTION_SECRET` mandatory; refuse to start without it |
| **PA-006** | Require separate `CLI_AUTH_SECRET`; don't fall back to `ENCRYPTION_SECRET` |
| **PA-020** | Add semantic version comparison; reject downgrades |
| **PA-021** | Add Ed25519 signature verification for test binaries |
| **PA-022** | Implement env var name allowlist on agent side (e.g., `AZURE_`, `F0_` prefixes) |
| **PA-032, PA-033** | Validate URLs against private IP denylist before HTTP requests |

### P2 — Medium-term (Month 1-2)
Hardening and defense-in-depth:

| Finding | Fix |
|---|---|
| **PA-007** | Add Zod schema validation on all route handlers |
| **PA-008** | Add rate limiter to `/api/cli/auth/refresh` |
| **PA-009** | Reject requests missing `X-Request-Timestamp` header |
| **PA-010, PA-024** | LRU cache with max size; key rate limiter on IP not X-Agent-ID |
| **PA-011** | Validate Slack webhook URL matches `https://hooks.slack.com/*` |
| **PA-017, PA-018** | Add org_id filtering to risk acceptance and integration queries |
| **PA-025** | Add `{ algorithms: ['HS256'] }` to jwt.verify() calls |
| **PA-026** | Write settings files with `{ mode: 0o600 }` |
| **PA-035** | Replace SHA256 with HKDF-SHA256 for key derivation |

### P3 — Hardening (Ongoing)

| Finding | Fix |
|---|---|
| **PA-012** | Evaluate CSP nonces for Clerk SDK instead of unsafe-inline |
| **PA-013** | Multi-stage Dockerfile, non-root USER, Go binary checksum |
| **PA-014** | Deduplicate encryption code into shared utility |
| **PA-015, PA-037** | Add `iss`/`aud` claims to CLI JWTs |
| **PA-027** | Make trust proxy configurable via env var |
| **PA-029** | Log error and disable API key encryption when machine-id unavailable (don't store plaintext) |
| **PA-030** | Preserve old binary as rollback on Linux/macOS |
| **PA-031** | Add `MinVersion: tls.VersionTLS12` to TLS configs |
| **PA-036** | Increase ENCRYPTION_SECRET minimum to 32 characters |
| **PA-038** | Use invalid placeholder in .env.example |
| **PA-039** | Document ES security disabled is dev-only |
| **PA-040** | Create separate frontend env_file |
| **PA-041** | Reduce CLI access token TTL to 1 hour |

---

## SAST Results Summary

| Scan | Findings | True Positives | New Issues |
|---|---|---|---|
| TypeScript/JS (22) | 15 auth-missing (FP: agent routes), 4 env-fallback (known), 2 GCM tag (FP), 1 XSS (FP) | 4 | 0 |
| Go (14) | 11 unsafe-block (FP: syscalls), 2 TLS MinVersion, 1 math/rand | 3 | 0 |
| Infrastructure (3) | 2 missing-user, 1 missing-user-entrypoint | 3 | 0 |

**Key insight:** All 39 SAST findings were either false positives or already tracked from manual review. The real vulnerabilities are logic-level issues in authorization, verification, and trust boundaries — exactly what community SAST rules cannot detect.

---

## Custom Semgrep Rules (Phase 7)

6 new rules developed to catch ProjectAchilles-specific patterns in CI. All 11 rules (5 existing + 6 new) validate and pass tests (11/11):

| Rule | Language | Severity | Detects |
|---|---|---|---|
| `no-role-elevation` | TS | ERROR | Permissive defaults for undefined roles |
| `unvalidated-command-task` | TS | ERROR | Unvalidated command fields in task creation |
| `env-var-injection` | Go | WARNING | Unfiltered env var injection in executor |
| `ssrf-url` | TS | WARNING | User-supplied URLs to HTTP clients without validation |
| `settings-file-permissions` | TS | WARNING | writeFileSync without mode 0o600 |
| `jwt-no-algorithm` | TS | WARNING | jwt.verify without algorithm pinning |

---

## Variant Analysis Results (Phase 8)

6 seed patterns searched across the full codebase:

| Seed Pattern | Known | Variants Found | Total Locations |
|---|---|---|---|
| Permissive default on undefined input | 3 | +3 (getUserRole cascade) | 6 |
| Silent auth bypass on missing claim | 2 | +3 (agentOrgAccess, timestamp) | 5 |
| User-controlled URL to server-side request | 3 | +2 (test endpoints are direct SSRF) | 5 |
| Unvalidated req.body | 1 (generic) | +8 critical routes | 24+ routes |
| Predictable key derivation | 2 | +3 (all three settings services) | 5 |
| Skippable security verification | 1 | +2 (signature strip, plaintext fallback) | 3 |

**Key variant finding:** The SSRF "test" endpoints (`POST /settings/test`, `POST /alerts/test`) are more dangerous than the stored variants because they use the URL from `req.body` *immediately* without requiring it to be saved first. This lowers the attack bar from "modify persistent settings" to "send a single POST request."

**Validation gap scope:** Zero schema validation libraries (Zod/Joi/Ajv) found anywhere in either backend codebase. All 24+ routes use TypeScript type casts (`req.body as T`) which provide zero runtime protection.

---

## Deployment and Supply Chain Findings (Phase 9)

| ID | Severity | Category | Finding |
|---|---|---|---|
| PA-042 | Medium | Supply Chain | Docker base images use floating tags instead of SHA digest pins |
| PA-043 | Medium | Docker | Backend/frontend ports bound to 0.0.0.0 |
| PA-044 | Medium | Supply Chain | Unpinned pip install in es-seed container |
| PA-045 | Medium | CI/CD | GitHub Actions use mutable tag refs instead of SHA pins |
| PA-046 | Medium | Config | .gitignore missing *.pfx, *.key, *.pem, *.db patterns |
| PA-047 | Medium | Config | Frontend .dockerignore does not exclude .env |
| PA-048 | Low | Dependency | nodemailer < 8.0.4 SMTP command injection |
| PA-049 | Low | Docker | Frontend Dockerfile runs nginx as root |

---

## Methodology

### Tools Used
- **Trail of Bits `/audit-context`** — Deep architectural analysis (Phase 1)
- **Trail of Bits `/semgrep`** — Parallel SAST scanning (Phase 2)
- **Trail of Bits `/insecure-defaults`** — Fail-open pattern detection (Phase 3)
- **Trail of Bits `/sharp-edges`** — Dangerous API pattern analysis (Phase 4)
- **Trail of Bits `/variants`** — Variant hunting from seed findings (Phase 8)
- **Trail of Bits `/semgrep-rule`** — Custom rule development (Phase 7)
- **Semgrep OSS 1.156.0** — 15 community rulesets + 11 custom rules
- **Go 1.21** — Agent code analysis

### Phases Executed
| Phase | Duration | Findings |
|---|---|---|
| 0: Infrastructure Setup | 15 min | 15 pre-identified |
| 1: Architectural Context | 45 min | 4 new |
| 2: SAST Sweep | 30 min | 0 new (triage only) |
| 3: Insecure Defaults | 45 min | 6 new |
| 4: Sharp Edges | 45 min | 3 new |
| 5: Agent Deep Dive | 45 min | 6 new |
| 6: Crypto Review | 45 min | 7 new |
| 7: Semgrep Rules | 45 min | 6 rules created (11 total, 11/11 tests pass) |
| 8: Variant Analysis | 60 min | 48+ locations confirmed, 2 SSRF elevated |
| 9: Deployment Review | 45 min | 9 new findings (supply chain, CI/CD, Docker) |
| 10: Report | 30 min | This document (47 total findings) |

---

## Deliverables

| File | Description |
|---|---|
| `docs/security/audit-2026-03-26/REPORT.md` | This report |
| `docs/security/audit-2026-03-26/AUDIT-PLAN.md` | 11-phase audit methodology |
| `docs/security/audit-2026-03-26/FINDINGS-INDEX.md` | All findings with CVSS/CWE/OWASP |
| `docs/security/audit-2026-03-26/sarif/` | SAST scan artifacts and triage |
| `.semgrep/rules/` | 11 custom Semgrep rules (5 existing + 6 new) |
| `.semgrep/rules/tests/` | Rule test cases |

---

*Report generated 2026-03-26. Findings are based on code review of the main branch at commit `7bb04b7`.*
