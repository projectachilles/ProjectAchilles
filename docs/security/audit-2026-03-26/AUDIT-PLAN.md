# ProjectAchilles — Comprehensive Security Audit Plan

> **Audit Target:** ProjectAchilles (purple team platform for continuous security validation)
> **Date:** 2026-03-26
> **Auditor:** Claude Code with Trail of Bits plugin suite
> **Methodology:** Manual code review + automated SAST + custom rule development + variant analysis
> **Standards:** OWASP Top 10 2021, CWE Top 25, CVSS 3.1, MITRE ATT&CK

---

## Table of Contents

- [Context and Motivation](#context-and-motivation)
- [Architecture Overview](#architecture-overview)
- [Pre-Identified Findings](#pre-identified-findings)
- [Findings Tracker Schema](#findings-tracker-schema)
- [Phase 0: Audit Infrastructure Setup](#phase-0-audit-infrastructure-setup)
- [Phase 1: Deep Architectural Context Building](#phase-1-deep-architectural-context-building)
- [Phase 2: Automated SAST Sweep (Semgrep)](#phase-2-automated-sast-sweep-semgrep)
- [Phase 3: Insecure Defaults and Fail-Open Analysis](#phase-3-insecure-defaults-and-fail-open-analysis)
- [Phase 4: Sharp Edges and Dangerous API Patterns](#phase-4-sharp-edges-and-dangerous-api-patterns)
- [Phase 5: Agent Security Deep Dive](#phase-5-agent-security-deep-dive)
- [Phase 6: Cryptographic and Secrets Review](#phase-6-cryptographic-and-secrets-review)
- [Phase 7: Custom Semgrep Rule Development](#phase-7-custom-semgrep-rule-development)
- [Phase 8: Variant Analysis](#phase-8-variant-analysis)
- [Phase 9: Docker and Deployment Security Review](#phase-9-docker-and-deployment-security-review)
- [Phase 10: Consolidated Report and Remediation Roadmap](#phase-10-consolidated-report-and-remediation-roadmap)
- [Phase Dependency Graph](#phase-dependency-graph)
- [Critical File Reference](#critical-file-reference)
- [Appendix A: Attack Surface Map](#appendix-a-attack-surface-map)
- [Appendix B: OWASP Coverage Matrix](#appendix-b-owasp-coverage-matrix)

---

## Context and Motivation

ProjectAchilles is a **purple team platform** that deploys custom Go agents to endpoints, executes security tests, and measures detection coverage via Elasticsearch analytics. It handles:

- **Agent enrollment and remote code execution** -- agents download and execute binaries from the server
- **Certificate management and code signing** -- PFX storage, OpenSSL operations, Authenticode signing
- **Credential encryption** -- AES-256-GCM for Elasticsearch, Azure/Defender, SMTP, Slack secrets
- **Multi-tenant isolation** -- Clerk Organizations with RBAC (4 roles, 54 permissions)

The platform's nature as a **security testing tool** means many of its features (command execution, binary distribution, credential storage) are inherently high-risk by design. This audit focuses on ensuring those features cannot be abused beyond their intended scope -- particularly through authentication bypass, privilege escalation, or supply chain compromise.

**Why now:** The platform has grown from a single-deployment tool to supporting 5 deployment targets (Docker, Railway, Render, Fly.io, Vercel) with two parallel backend codebases. This expansion increases the attack surface and the risk of security-relevant divergence between implementations.

---

## Architecture Overview

```
                    +---------------------------------------------+
                    |              Frontend (React 19)              |
                    |  Clerk Auth -> Redux -> Vite -> Tailwind      |
                    +----------------------+-----------------------+
                                           | /api/* (proxied)
                    +----------------------v-----------------------+
                    |           Backend (Express/TS)                |
                    |                                               |
                    |  +--- Clerk JWT ---+  +-- Agent API Key ---+ |
                    |  | /api/browser    |  | /api/agent/*       | |
                    |  | /api/analytics  |  | (heartbeat,tasks)  | |
                    |  | /api/tests      |  +--------------------+ |
                    |  | /api/admin      |  +-- Public ----------+ |
                    |  | /api/users      |  | /api/agent/enroll  | |
                    |  | /api/integr.    |  | /api/agent/config  | |
                    |  +-----------------+  | /api/cli/auth/*    | |
                    |                       +--------------------+ |
                    |  SQLite (WAL) | AES-256-GCM | execFile       |
                    +------+------------+----------+---------------+
                           |            |          |
                    +------v--+  +------v--+  +---v--------------+
                    | SQLite  |  |  Elastic |  | Go Agent         |
                    | agents  |  |  Search  |  | (endpoints)      |
                    | tokens  |  |  results |  | exec binaries    |
                    | tasks   |  |  defender|  | self-update      |
                    +---------+  +---------+  +------------------+
```

**Parallel codebases:** `backend/` (Docker/Railway/Render/Fly.io) and `backend-serverless/` (Vercel) -- independent codebases with shared API contracts but different storage and scheduling implementations.

---

## Pre-Identified Findings

Exploration already revealed **15 findings** before formal audit phases begin. These are confirmed via direct code review:

| ID | Title | Sev | CVSS | CWE | OWASP | Location | Verified |
|---|---|---|---|---|---|---|---|
| PA-001 | No-role users receive ALL 54 permissions (silent admin) | **CRIT** | 9.8 | CWE-276 | A01 | `roles.ts:164` | Yes |
| PA-002 | Org access silently bypassed when Clerk Orgs not configured | **CRIT** | 9.1 | CWE-862 | A01 | `clerk.middleware.ts:58-63` | Yes |
| PA-003 | RCE chain: no-role -> all perms -> command task -> `sh -c` on agents | **CRIT** | 9.8 | CWE-78 | A03 | `tasks.routes.ts:170` -> `executor.go:283` | Yes |
| PA-004 | Agent update signature verification skippable (both conditions) | **HIGH** | 8.1 | CWE-354 | A08 | `updater.go:56-69` | Yes |
| PA-005 | Weak machine-derived encryption key fallback (hostname+username) | **HIGH** | 7.5 | CWE-1188 | A02 | `settings.ts:36-48` | Yes |
| PA-006 | CLI JWT secret falls back to weak encryption key | **HIGH** | 7.5 | CWE-321 | A02 | `cliAuth.middleware.ts:22` | Yes |
| PA-007 | No runtime request body validation (type casts only) on most routes | **MED** | 6.5 | CWE-20 | A03 | All `*.routes.ts` | Yes |
| PA-008 | Missing rate limit on `/api/cli/auth/refresh` | **MED** | 5.3 | CWE-307 | A07 | `cli-auth.routes.ts` | Yes |
| PA-009 | Agent replay protection optional (missing timestamp allowed) | **MED** | 5.9 | CWE-294 | A07 | `agentAuth.middleware.ts:130-132` | Yes |
| PA-010 | Unbounded agent auth cache (memory exhaustion DoS) | **MED** | 5.3 | CWE-770 | A05 | `agentAuthCache.ts` | Yes |
| PA-011 | Slack webhook URL not validated (SSRF to internal services) | **MED** | 5.0 | CWE-918 | A10 | `integrations.routes.ts` | Needs confirm |
| PA-012 | CSP allows `unsafe-inline` for scripts and styles | **MED** | 4.7 | CWE-79 | A03 | `server.ts:62-63` | Yes |
| PA-013 | Dockerfile: no multi-stage build, root user, Go without checksum | **LOW** | 3.7 | CWE-1104 | A06 | `Dockerfile` | Yes |
| PA-014 | Three duplicated AES-256-GCM implementations (fix must be tripled) | **LOW** | 3.0 | CWE-710 | A04 | 3x `settings.ts` | Yes |
| PA-015 | CLI JWT missing `aud`/`iss` claims (cross-deployment replay) | **LOW** | 3.1 | CWE-345 | A07 | `cli-auth.routes.ts` | Yes |

> These will be deepened, re-scored, and supplemented with additional findings during the formal phases.

---

## Findings Tracker Schema

Every finding across all phases is tracked with this structure:

```yaml
id: PA-NNN              # Sequential, permanent
title: ""               # One-line summary
severity: Critical|High|Medium|Low|Informational
cvss_score: 0.0         # CVSS 3.1 base score
cvss_vector: ""         # e.g., AV:N/AC:L/PR:L/UI:N/S:C/C:H/I:H/A:H
cwe: CWE-NNN            # Primary CWE
owasp: "A0N:2021"       # OWASP Top 10 2021 category
component: backend|frontend|agent|serverless|docker|supply-chain
files:                   # Affected files with line numbers
  - path: ""
    lines: ""
description: ""          # Technical root cause
proof_of_concept: ""     # Reproduction steps or attack chain
impact: ""               # What an attacker achieves
remediation: ""          # Specific code changes
phase_found: N           # Which audit phase
status: Open|Confirmed|Fixed|WontFix|FalsePositive
```

**Output location:** `docs/security/audit-2026-03-26/` with individual finding files and a summary index.

---

## Phase 0: Audit Infrastructure Setup

**Objective:** Verify all tooling is operational and establish the findings workspace.

**Skill:** None (manual verification)

**Steps:**
1. Verify Semgrep installation: `~/.local/bin/semgrep --version`
2. Validate existing custom rules: `semgrep --validate --config .semgrep/rules/`
3. Run custom rule tests: `semgrep --test .semgrep/rules/tests/ --config .semgrep/rules/`
4. Verify Go toolchain: `go version` (needed for agent analysis)
5. Create findings directory: `docs/security/audit-2026-03-26/`
6. Create findings index file with tracker schema
7. Pre-populate with the 15 exploration findings

**Success Criteria:**
- [ ] Semgrep operational with all 5 custom rules passing
- [ ] Go toolchain available
- [ ] Findings directory created with index and 15 pre-populated findings

**Estimated effort:** ~15 minutes

---

## Phase 1: Deep Architectural Context Building

**Objective:** Build line-by-line understanding of all trust boundaries, auth enforcement points, and data flows -- the foundation for all subsequent phases.

**Skill:** `/audit-context`

**Scope:**

### 1.1 Authentication Boundary Completeness Audit
- Trace every route mount in `backend/src/server.ts` (lines 217-300) and `backend/src/api/agent/index.ts` (lines 31-60)
- For every route handler in all `*.routes.ts` files, verify `requireClerkAuth()` or `requireAgentAuth` is applied
- Map every `requirePermission('...')` call to its route -- identify any admin operations without permission checks
- **Deliverable:** Complete route-to-auth mapping table

### 1.2 Data Flow: Command Task Lifecycle (RCE Chain)
- Trace `POST /admin/tasks/command` -> `createCommandTasks()` -> SQLite INSERT -> agent poll -> `executor.go:283` (`sh -c`)
- Document every validation (or lack thereof) at each step
- Identify all entry points that can create tasks (admin API, schedules, CLI)
- **Deliverable:** End-to-end data flow diagram with trust boundary crossings

### 1.3 Serverless Parity Analysis
- Compare every middleware in `backend/src/middleware/` vs `backend-serverless/src/middleware/`
- Compare rate limiting configuration between both backends
- Check if any security fixes in `backend/` are missing in `backend-serverless/`
- **Deliverable:** Divergence report with severity assessment

### 1.4 Encryption Key Derivation Chain
- Map every call to `getEncryptionKey()` across all three settings services
- Trace the fallback path: missing env var -> hostname+username -> SHA256
- Document what each encrypted value protects (ES creds, Azure creds, cert passwords, etc.)
- **Deliverable:** Key derivation diagram with entropy analysis

**Success Criteria:**
- [ ] Every route mapped to auth requirement (no gaps)
- [ ] RCE chain fully documented with all entry points
- [ ] Serverless divergences cataloged
- [ ] Encryption key hierarchy documented

**Dependencies:** None -- this is the foundation phase.
**Estimated effort:** ~45-60 minutes

---

## Phase 2: Automated SAST Sweep (Semgrep)

**Objective:** Run comprehensive static analysis across all codebases using community and custom rules, then triage every finding.

**Skill:** `/semgrep`

**Scan Configuration:**

### 2.1 TypeScript/Node.js Scan
```bash
semgrep scan \
  --config p/javascript --config p/typescript --config p/nodejs \
  --config p/express --config p/react --config p/owasp-top-ten \
  --config p/cwe-top-25 --config p/security-audit --config p/secrets \
  --config p/jwt --config p/sql-injection --config p/xss \
  --config .semgrep/rules/ \
  --sarif -o audit-ts.sarif \
  backend/src/ backend-serverless/src/ frontend/src/
```

### 2.2 Go Scan
```bash
semgrep scan \
  --config p/golang --config p/owasp-top-ten \
  --config p/cwe-top-25 --config p/security-audit \
  --sarif -o audit-go.sarif \
  agent/
```

### 2.3 Infrastructure Scan
```bash
semgrep scan \
  --config p/dockerfile --config p/docker \
  --config p/supply-chain --config p/github-actions \
  --sarif -o audit-infra.sarif \
  backend/Dockerfile frontend/Dockerfile docker-compose.yml .github/
```

**Triage Process:**
1. Parse SARIF results (use `/sarif-parsing` if volume is high)
2. For each finding: classify as True Positive, False Positive, or Needs Investigation
3. True positives -> add to findings tracker with full metadata
4. False positives -> document justification (inform Phase 7 rule refinement)

**Success Criteria:**
- [ ] All three scans complete without errors
- [ ] Every finding triaged (zero unreviewed)
- [ ] True positives logged in findings tracker
- [ ] SARIF artifacts saved to `docs/security/audit-2026-03-26/sarif/`

**Dependencies:** Phase 1 context improves triage accuracy.
**Estimated effort:** ~30-45 minutes (mostly automated, triage is manual)

---

## Phase 3: Insecure Defaults and Fail-Open Analysis

**Objective:** Systematically identify every location where the application silently degrades security when configuration is missing or incomplete.

**Skill:** `/insecure-defaults`

**Investigation Targets:**

### 3.1 Critical Defaults (confirmed from exploration)
| Pattern | Location | Impact |
|---|---|---|
| `!role -> ALL_PERMISSIONS` | `roles.ts:164` | Silent admin elevation for unconfigured users |
| `!userOrgId -> next()` | `clerk.middleware.ts:58-63, 86-90` | Tenant isolation completely bypassed |
| `!ENCRYPTION_SECRET -> hostname+username` | `settings.ts:36-48` (3 copies) | Predictable encryption key in containers |
| `!UpdatePublicKey -> skip` | `updater.go:56-69` | Unsigned binary execution |
| `!CLI_AUTH_SECRET -> ENCRYPTION_SECRET` | `cliAuth.middleware.ts:22` | JWT signing with weak key |

### 3.2 Systematic Search
- Grep for `|| 'default'`, `?? 'fallback'`, `if (!config)` patterns across all backends
- Check every `process.env.X || Y` for security-sensitive values
- Check every `if (!x) { console.warn(...); next(); }` pattern for auth bypass
- Review `trust proxy` setting (value: 2) against actual deployment topologies
- Review CORS origin default (`http://localhost:5173`)
- Review ES security disabled in docker-compose

### 3.3 Go Agent Defaults
- Check `cfg.SkipTLSVerify` default and validation
- Check `cfg.UpdatePublicKey` default
- Check what happens when `achilles-agent.yaml` is missing or corrupt

**Expected Output:** Complete catalog of fail-open patterns, each with:
- Current behavior (what happens when config is missing)
- Fail-closed alternative (what should happen instead)
- CVSS score and remediation priority

**Success Criteria:**
- [ ] Every env var fallback evaluated for security impact
- [ ] Every "skip check if not configured" pattern cataloged
- [ ] Each finding has concrete fail-closed remediation

**Dependencies:** Phase 1 (trust boundary map).
**Estimated effort:** ~30-45 minutes

---

## Phase 4: Sharp Edges and Dangerous API Patterns

**Objective:** Identify API designs and code constructs that are error-prone, enable misuse, or create footgun scenarios -- even if not currently exploitable.

**Skill:** `/sharp-edges`

**Investigation Areas:**

### 4.1 Command Execution Pipeline (PA-003 deep dive)
- Full trace of the `execute_command` task type through all layers
- Document: who can create commands, what validation exists, how agents execute
- Assess: should this feature have an allowlist? Audit logging? Confirmation step?
- Cross-reference: the no-role elevation (PA-001) creates the complete RCE chain

### 4.2 Request Body Validation Gaps
- Catalog every route that uses `req.body as TypeName` without Zod/runtime validation
- Identify which unvalidated fields reach security-sensitive operations
- Priority: routes that create tasks, modify credentials, or control agent behavior

### 4.3 Error Information Leakage
- Review `error.middleware.ts` -- stack traces in dev mode, message content in prod
- Check for sensitive data in error messages (credentials, internal paths, SQL)
- Check all `catch` blocks for information passed to client responses

### 4.4 Cache and Memory Safety
- Review `agentAuthCache.ts` -- unbounded Map, no eviction
- Search for other in-memory caches or unbounded collections
- Assess memory exhaustion attack vectors

### 4.5 SSRF Vectors
- Slack webhook URL storage and usage (no URL validation)
- SMTP server configuration (user-provided hostname)
- Any other user-controlled URLs that trigger server-side requests

### 4.6 CSP and XSS Surface
- Review CSP configuration and `unsafe-inline` necessity
- Search for unsafe HTML rendering in frontend (innerHTML variants)
- Check DOMPurify integration completeness
- Review React Markdown rendering for XSS vectors

**Success Criteria:**
- [ ] Every external-input-to-execution flow traced end-to-end
- [ ] All routes without runtime validation cataloged
- [ ] SSRF vectors documented with remediation
- [ ] Each sharp edge has a "pit of success" redesign recommendation

**Dependencies:** Phase 1 (boundary map), Phase 2 (SAST cross-reference).
**Estimated effort:** ~45-60 minutes

---

## Phase 5: Agent Security Deep Dive

**Objective:** Comprehensive review of the Go agent -- transport security, credential handling, binary integrity, execution isolation, and self-update safety.

**Skill:** `/audit-context` (line-by-line on Go code)

**Focus Areas:**

### 5.1 Transport Security
- `httpclient/client.go` -- TLS config, `InsecureSkipVerify` behavior, redirect downgrade protection
- Verify all `client.Do()` callsites handle TLS errors correctly
- Check certificate pinning (or absence thereof)

### 5.2 Credential Storage
- `config/config.go` -- PBKDF2 encryption of agent API key, machine ID derivation
- What happens when `/etc/machine-id` is absent (Docker, WSL, fresh installs)?
- Auto-migration from legacy HMAC to v2 -- is the old format still readable?

### 5.3 Binary Update Safety (PA-004 deep dive)
- `updater/updater.go` -- two independent conditions skip signature verification
- `updater/verify.go` -- Ed25519 implementation correctness
- Attack scenario: compromised server + no `UpdatePublicKey` -> unsigned malicious binary pushed
- What prevents downgrade attacks (pushing an older vulnerable version)?

### 5.4 Test Binary Execution
- `executor/executor.go` -- temp directory isolation, SHA256 verification, env var injection
- `sh -c` (Linux) and `cmd.exe /C` (Windows) execution -- full shell access
- No sandboxing beyond temp directory and process privileges
- Environment variable injection from server-controlled task payload

### 5.5 Enrollment Flow
- `enrollment/enrollment.go` -- data sent during enrollment, token transmission
- Information leakage in enrollment response
- What prevents re-enrollment of an already-enrolled agent?

### 5.6 Service Management
- Platform-specific service files (`service_darwin.go`, etc.)
- Privilege levels: runs as SYSTEM (Windows), root (Linux/macOS launchd)
- What happens if the agent process is killed during an update?

**Success Criteria:**
- [ ] All crypto operations reviewed for correctness
- [ ] All trust assumptions between agent and server documented
- [ ] Update and execution flows verified for integrity
- [ ] Attack scenarios documented with mitigations

**Dependencies:** Phase 1 (agent-server protocol understanding).
**Estimated effort:** ~45-60 minutes

---

## Phase 6: Cryptographic and Secrets Review

**Objective:** Audit all cryptographic operations, key management, secret storage, and credential handling across the entire codebase.

**Skill:** `/insecure-defaults` + `/sharp-edges` (crypto focus)

**Scope:**

### 6.1 AES-256-GCM Review (3 implementations)
- `backend/src/services/tests/settings.ts` (cert passwords)
- `backend/src/services/integrations/settings.ts` (Azure/Defender/Slack/SMTP)
- `backend/src/services/analytics/settings.ts` (Elasticsearch credentials)
- Verify: random IV per operation, auth tag validation, no IV reuse
- Assess: code duplication risk (fix in one, miss the other two)

### 6.2 Key Derivation Analysis
- Production path: `ENCRYPTION_SECRET` -> SHA256 -> 256-bit key
- Fallback path: `hostname + username` -> SHA256 -> 256-bit key
- Assessment: SHA256 is adequate for high-entropy secrets but catastrophic for low-entropy machine IDs
- Recommendation: enforce minimum secret length, consider HKDF

### 6.3 JWT Security
- `cli-auth.routes.ts` -- HS256 symmetric JWT, 7-day lifetime
- Missing `aud`/`iss` claims -> cross-deployment token replay possible
- Refresh token rotation: old deleted, new issued (correct)
- Secret derivation chain: `CLI_AUTH_SECRET` -> `ENCRYPTION_SECRET` -> machine fallback

### 6.4 Agent Key Encryption (Go)
- PBKDF2 with machine ID as salt material
- Iteration count and hash function review
- Portability: what happens on machine ID change (VM migration, container restart)?

### 6.5 Bcrypt for API Keys
- `agentAuth.middleware.ts` -- bcrypt cost factor 12
- Dummy hash for timing safety -- implementation correctness
- Key rotation: dual-key grace period (300s) -- race condition analysis

### 6.6 Secrets Inventory
- Enumerate all secrets: where stored, how encrypted, who can access
- Check for secrets in: git history, environment, process memory, error logs
- Verify `.env` files in `.gitignore`

**Success Criteria:**
- [ ] Every crypto operation reviewed for algorithm correctness
- [ ] Key derivation paths documented with entropy ratings
- [ ] All JWT configurations reviewed for claim completeness
- [ ] Secrets inventory complete

**Dependencies:** Phase 3 (insecure defaults in key derivation).
**Estimated effort:** ~30-45 minutes

---

## Phase 7: Custom Semgrep Rule Development

**Objective:** Write new Semgrep rules to catch ProjectAchilles-specific vulnerability patterns that community rules miss. These rules go into CI for continuous protection.

**Skill:** `/semgrep-rule`

**Rules to Create:**

| Rule Name | Detects | Motivated By |
|---|---|---|
| `projectachilles-no-role-elevation` | `getPermissionsForRole` called where arg may be `undefined` with ALL_PERMISSIONS fallback | PA-001 |
| `projectachilles-optional-verification` | Go code where security verification is skipped via empty-string config check | PA-004 |
| `projectachilles-unbounded-cache` | `new Map()` used as cache without size limit or periodic cleanup | PA-010 |
| `projectachilles-unvalidated-command` | Request body `command` field flows to task creation without validation | PA-003 |
| `projectachilles-ssrf-webhook` | User-supplied URL stored then used in server-side HTTP request without validation | PA-011 |
| `projectachilles-missing-rate-limit` | Auth-related Express route handler without rate limiter middleware | PA-008 |

**Process (for each rule):**
1. Write test cases first (minimum 2 true positive + 2 true negative)
2. Write the Semgrep YAML rule
3. Run: `semgrep --test .semgrep/rules/tests/ --config .semgrep/rules/`
4. Validate against codebase: `semgrep --config .semgrep/rules/<rule>.yaml backend/src/`
5. Verify zero false positives beyond known true positives

**Success Criteria:**
- [ ] All 6 rules written with test cases
- [ ] All rules pass `semgrep --test`
- [ ] Zero false positives on current codebase
- [ ] Rules added to `.semgrep/rules/` ready for CI

**Dependencies:** Phases 2-6 (findings that motivate rule creation).
**Estimated effort:** ~45-60 minutes

---

## Phase 8: Variant Analysis

**Objective:** Starting from critical findings, systematically hunt for variants of the same vulnerability pattern across the entire codebase. If we found it once, it may exist elsewhere.

**Skill:** `/variants`

**Seed Findings and Variant Hunts:**

| Seed | Pattern to Search | Where to Look |
|---|---|---|
| PA-001 (no-role = admin) | Any function returning permissive default when input is undefined/null | All middleware, all service functions with optional params |
| PA-002 (org bypass) | Any access control check that `next()`s when a required claim is missing | All middleware in `backend/` and `backend-serverless/` |
| PA-003 (command injection) | Any route accepting freeform string -> database -> eventual execution | All `*.routes.ts` that write to `tasks` table |
| PA-004 (optional verification) | Any integrity/auth check guarded by `if (config == "") { skip }` | All Go code in `config/`, `updater/`, `executor/` |
| PA-005 (weak key fallback) | Any crypto key derived from predictable sources or with insecure fallback | All `getEncryptionKey()`, all `process.env.X` with fallbacks |
| PA-011 (SSRF) | Any user-controlled URL used in server-side HTTP request | All integration services, webhook handlers |

**Process:**
1. For each seed, formulate a search pattern (regex or AST query)
2. Run across entire codebase (both backends, frontend, agent)
3. Classify each match: variant (new finding), known (already tracked), or false positive
4. New variants get full finding tracker entries

**Success Criteria:**
- [ ] Each seed finding searched across entire codebase
- [ ] All variants logged as new findings or confirmed non-issues
- [ ] Cross-component variants identified (same bug in `backend/` and `backend-serverless/`)

**Dependencies:** Phases 3-6 (seed findings).
**Estimated effort:** ~30-45 minutes

---

## Phase 9: Docker and Deployment Security Review

**Objective:** Audit containerization, deployment configuration, and supply chain security across all 5 deployment targets.

**Skill:** `/insecure-defaults` + `/sharp-edges`

**Focus Areas:**

### 9.1 Dockerfile Hardening
- `backend/Dockerfile`: No multi-stage build, runs as root, dev tools in prod image
- `frontend/Dockerfile`: nginx configuration review, security headers
- Go binary download without checksum verification
- `npm ci --include=dev` then prune -- assess residual dev dependency risk

### 9.2 Docker Compose Security
- Elasticsearch `xpack.security.enabled=false` -- document risk, check if persistent
- Port exposure: backend on `0.0.0.0:3000`, ES on `127.0.0.1:9200`
- Volume mounts: agent source as read-only (correct)
- Seed container: `pip install` at runtime (supply chain)

### 9.3 Deployment Target Parity
- Compare security configuration across Docker, Fly.io, Render, Railway, Vercel
- Check: TLS enforcement, secret management, network isolation
- Verify: Vercel cron endpoints have authentication

### 9.4 Supply Chain
- `package-lock.json` integrity check
- `go.sum` dependency pinning verification
- `npm audit` on all three package directories
- Check critical deps: `better-sqlite3`, `jsonwebtoken`, `bcryptjs`, `simple-git`, `@clerk/express`

### 9.5 CI/CD Security
- `.github/workflows/` -- review for secret leakage, untrusted input in commands
- Check: can a PR from a fork access secrets?
- Review: Semgrep SAST integration, Claude review skipping logic

**Success Criteria:**
- [ ] Dockerfile hardening recommendations documented
- [ ] All deployment targets compared for security config
- [ ] Supply chain dependencies audited
- [ ] CI/CD pipeline reviewed for secret safety

**Dependencies:** Phase 1 (architecture), Phase 6 (secrets).
**Estimated effort:** ~30-45 minutes

---

## Phase 10: Consolidated Report and Remediation Roadmap

**Objective:** Synthesize all findings into a prioritized, actionable report with a phased remediation plan.

**Skill:** `/fix-review` (for verifying any fixes applied during the audit)

**Report Structure:**

### 10.1 Executive Summary
- Overall risk posture assessment
- Finding counts by severity
- Top 3 most critical attack chains
- Comparison to OWASP Top 10 coverage

### 10.2 Findings (CVSS-ordered within each tier)
- **Critical** (CVSS 9.0-10.0) -- must fix before next deployment
- **High** (CVSS 7.0-8.9) -- fix within 1-2 weeks
- **Medium** (CVSS 4.0-6.9) -- fix within 1 month
- **Low** (CVSS 0.1-3.9) -- fix as part of regular maintenance
- **Informational** -- document as accepted risk or future improvement

### 10.3 Remediation Roadmap

| Priority | Timeline | Findings | Key Changes |
|---|---|---|---|
| **P0 Immediate** | Week 1 | PA-001, PA-002, PA-003 | Default role to `explorer` or deny; enforce org access; add command validation |
| **P1 Short-term** | Week 2-3 | PA-004, PA-005, PA-006 | Mandate `ENCRYPTION_SECRET`; mandate update signatures; fix CLI JWT secret |
| **P2 Medium-term** | Month 1-2 | PA-007 through PA-012 | Zod schemas; rate limits; cache bounds; SSRF mitigation; CSP tightening |
| **P3 Hardening** | Ongoing | PA-013 through PA-015+ | Dockerfile multi-stage; deduplicate crypto; JWT claims; new Semgrep rules in CI |

### 10.4 Defense-in-Depth Recommendations
- Request body validation (Zod) on all routes
- Command allowlist/audit-log for `execute_command` tasks
- `ENCRYPTION_SECRET` mandatory (startup validation, refuse to start without)
- `aud`/`iss` claims in CLI JWTs
- LRU cache eviction with size limits
- Multi-stage Dockerfile with non-root user
- Update signature verification mandatory (remove skip conditions)

### 10.5 Deliverables
- `docs/security/audit-2026-03-26/REPORT.md` -- full report
- `docs/security/audit-2026-03-26/findings/` -- individual finding files
- `docs/security/audit-2026-03-26/sarif/` -- SAST scan results
- `.semgrep/rules/` -- new custom rules (6+)
- `.semgrep/rules/tests/` -- rule test cases

**Success Criteria:**
- [ ] Every finding from Phases 0-9 included with full metadata
- [ ] CVSS scores calculated for every finding
- [ ] Remediation guidance specific enough to implement
- [ ] Report exportable as reference template

**Dependencies:** All previous phases complete.
**Estimated effort:** ~30-45 minutes

---

## Phase Dependency Graph

```
Phase 0 (Setup) -----------------------------------------------+
    |                                                           |
Phase 1 (Context) ----------> Phase 2 (SAST)                   |
    |                              |                            |
    +------------+-----------+-----+                            |
    |            |           |     |                            |
Phase 3       Phase 4    Phase 5  Phase 9                       |
(Defaults)    (Sharp)    (Agent)  (Docker)                      |
    |            |           |     |                            |
    +------------+-----------+     |                            |
    |                              |                            |
Phase 6 (Crypto) ---------> Phase 7 (Rules)                     |
    |                           |                               |
    +---------------------------+                               |
    |                                                           |
Phase 8 (Variants) --------------------------------------------+
    |                                                           |
Phase 10 (Report) <---------------------------------------------+
```

**Parallelizable:** Phases 3, 4, 5, and 9 can run concurrently after Phase 1+2.
**Sequential gates:** Phase 6 needs 3+4+5. Phase 7 needs 2-6. Phase 8 needs 3-6. Phase 10 needs all.

---

## Critical File Reference

### Authentication and Authorization
| File | Key Lines | What to Review |
|---|---|---|
| `backend/src/types/roles.ts` | 162-172 | `getPermissionsForRole()` -- no-role fallback |
| `backend/src/middleware/clerk.middleware.ts` | 48-72, 78-107 | `requireOrgAccess`, `requireAgentOrgAccess` |
| `backend/src/middleware/agentAuth.middleware.ts` | 14, 80-83, 130-133 | Timing-safe bcrypt, timestamp skip |
| `backend/src/middleware/cliAuth.middleware.ts` | 22, 29-44 | CLI JWT validation, secret fallback |
| `backend/src/server.ts` | 92-111, 217-300 | Global middleware order, route mounting |
| `backend/src/api/agent/index.ts` | 31-60 | Agent router auth application |

### Command Execution and Build
| File | Key Lines | What to Review |
|---|---|---|
| `backend/src/api/agent/tasks.routes.ts` | 165-195 | Command task creation (no validation) |
| `backend/src/services/tests/buildService.ts` | 271-340, 448-452, 509-526 | File upload, build scripts, Go compilation |
| `backend/src/services/agent/agentBuild.service.ts` | 56-58, 103-120 | Version validation, Go build commands |
| `agent/internal/executor/executor.go` | 145, 275-283 | Binary execution, shell command execution |

### Cryptography and Secrets
| File | Key Lines | What to Review |
|---|---|---|
| `backend/src/services/tests/settings.ts` | 35-77 | Key derivation, AES-256-GCM encrypt/decrypt |
| `backend/src/services/integrations/settings.ts` | 34-54 | Duplicate encryption (same pattern) |
| `backend/src/services/analytics/settings.ts` | ~34-54 | Duplicate encryption (same pattern) |
| `backend/src/api/cli-auth.routes.ts` | 46-48 | JWT signing configuration |
| `agent/internal/updater/verify.go` | 1-36 | Ed25519 signature verification |
| `agent/internal/config/config.go` | -- | PBKDF2 key encryption, machine ID |

### Agent
| File | Key Lines | What to Review |
|---|---|---|
| `agent/internal/updater/updater.go` | 56-69 | Optional signature verification |
| `agent/internal/httpclient/client.go` | 27-29, 48-56 | TLS config, redirect protection |
| `agent/internal/enrollment/enrollment.go` | -- | Enrollment flow, data leakage |

### Infrastructure
| File | What to Review |
|---|---|
| `backend/Dockerfile` | Multi-stage, root user, Go checksum |
| `frontend/Dockerfile` | nginx config, security headers |
| `docker-compose.yml` | ES security, port exposure, volumes |
| `.github/workflows/ci.yml` | Secret safety, fork PR handling |
| `.github/workflows/security-review.yml` | Semgrep config, review skipping |

---

## Appendix A: Attack Surface Map

### Public Endpoints (No Authentication)
| Endpoint | Method | Rate Limit | Risk |
|---|---|---|---|
| `/api/health` | GET | Global only | Low -- info disclosure |
| `/api/capabilities` | GET | Global only | Low -- feature flags |
| `/api/agent/enroll` | POST | 5/15min | Medium -- requires valid token |
| `/api/agent/config` | GET | Global only | Low -- server URL |
| `/api/agent/download` | GET | 10/15min | Low -- public binary |
| `/api/cli/auth/device-code` | POST | 10/15min | Medium -- device flow init |
| `/api/cli/auth/poll` | POST | 60/60sec | Medium -- token polling |
| `/api/cli/auth/refresh` | POST | **NONE** | **HIGH -- no rate limit** |

### Clerk-Protected Endpoints
All `/api/browser/*`, `/api/analytics/*`, `/api/tests/*`, `/api/users/*`, `/api/integrations/*`, `/api/agent/admin/*`, `/api/risk-acceptance/*`

### Agent-Key-Protected Endpoints
All `/api/agent/{heartbeat,tasks,update,binary,catalog}`

---

## Appendix B: OWASP Coverage Matrix

| OWASP 2021 | Findings | Audit Phases |
|---|---|---|
| **A01: Broken Access Control** | PA-001 (no-role admin), PA-002 (org bypass) | 1, 3, 8 |
| **A02: Cryptographic Failures** | PA-005 (weak key), PA-006 (JWT secret) | 6 |
| **A03: Injection** | PA-003 (RCE chain), PA-007 (no validation), PA-012 (XSS/CSP) | 2, 4 |
| **A04: Insecure Design** | PA-014 (duplicated crypto) | 4, 6 |
| **A05: Security Misconfiguration** | PA-010 (unbounded cache) | 3, 9 |
| **A06: Vulnerable Components** | PA-013 (Dockerfile, supply chain) | 9 |
| **A07: Auth and Session** | PA-008 (rate limit), PA-009 (replay), PA-015 (JWT claims) | 3, 6 |
| **A08: Software Integrity** | PA-004 (optional signatures) | 5 |
| **A09: Logging and Monitoring** | (to be assessed in Phase 4) | 4 |
| **A10: SSRF** | PA-011 (webhook URL) | 4, 8 |

---

## Verification Plan

After the audit is complete, verify with:

1. **Findings completeness:** Every finding has ID, CVSS, CWE, OWASP mapping, file:line, PoC, remediation
2. **Rule validation:** `semgrep --test .semgrep/rules/tests/ --config .semgrep/rules/` passes
3. **No regressions:** `cd backend && npm test` and `cd frontend && npm test` still pass
4. **Report quality:** Report is self-contained -- someone unfamiliar with the codebase can understand each finding
5. **Remediation actionability:** Each P0 finding has a code-level fix that could be implemented immediately

---

> **Total estimated effort:** 5-7 hours across all phases
> **Session management:** Each phase is self-contained with clear entry/exit criteria. If the session is interrupted, resume from the last incomplete phase. The findings tracker persists progress across sessions.
