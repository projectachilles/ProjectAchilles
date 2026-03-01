# ProjectAchilles Security Remediation Plan

**Review Date:** December 16, 2025
**Status:** Awaiting Approval

---

## Executive Summary

A comprehensive security review of ProjectAchilles identified **15 vulnerabilities** across the codebase:
- **2 Critical** - Require immediate attention before production use
- **3 High** - Should be addressed in the short term
- **5 Medium** - Important security improvements
- **5 Low** - Best practice improvements

---

## Phase 1: Critical Issues (Must Fix Before Production)

### 1.1 Command Injection Vulnerability
**Severity:** CRITICAL | **File:** `backend/src/services/endpoints/tasks.service.ts`

**Problem:** User input is directly interpolated into shell commands without sanitization at lines 125, 179, 184, and 223.

```typescript
// VULNERABLE CODE (line 179)
command = `run --shell-command "${request.command}"`;
```

**Proposed Fix:**
- Implement a command sanitization utility function
- Use allowlisting for permitted commands
- Escape shell metacharacters in user inputs
- Add input validation with strict patterns

**Files to Modify:**
- `backend/src/services/endpoints/tasks.service.ts`
- Create: `backend/src/utils/command-sanitizer.ts`

---

### 1.2 Weak Encryption Key Derivation
**Severity:** CRITICAL | **File:** `backend/src/services/analytics/settings.ts`

**Problem:** Encryption key derived from predictable values (hostname + username) using SHA256 without salt.

```typescript
// VULNERABLE CODE (lines 23-26)
private getEncryptionKey(): Buffer {
  const machineId = os.hostname() + os.userInfo().username;
  return crypto.createHash('sha256').update(machineId).digest();
}
```

**Proposed Fix:**
- Generate and store a random encryption key on first run
- Use PBKDF2 with high iteration count for key derivation
- Store master key securely with restricted file permissions (0600)
- Implement key rotation capability
- Migration path for existing encrypted settings

**Files to Modify:**
- `backend/src/services/analytics/settings.ts`

---

## Phase 2: High Severity Issues

### 2.1 Information Disclosure via Stack Traces
**Severity:** HIGH | **Files:** Multiple

**Problem:** Stack traces exposed in development mode; raw API responses logged with potentially sensitive data.

**Locations:**
- `backend/src/middleware/error.middleware.ts` (lines 34-44)
- `backend/src/services/endpoints/payloads.service.ts` (lines 148, 156, 160, 173, 183)

**Proposed Fix:**
- Remove stack traces from all client responses
- Create structured logging with sensitive data filtering
- Replace console.log with proper logger that filters secrets

**Files to Modify:**
- `backend/src/middleware/error.middleware.ts`
- `backend/src/services/endpoints/payloads.service.ts`

---

### 2.2 Missing Content Security Policy
**Severity:** HIGH | **File:** `backend/src/server.ts`

**Problem:** CSP is explicitly disabled (line 37).

```typescript
// CURRENT CODE
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));
```

**Proposed Fix:**
- Enable CSP with strict configuration
- Configure allowed script sources
- Configure allowed style sources
- Configure allowed image/font sources
- Add report-uri for CSP violations

**Files to Modify:**
- `backend/src/server.ts`

---

### 2.3 Hardcoded Default Session Secret
**Severity:** HIGH | **File:** `backend/src/server.ts` (lines 58-64)

**Problem:** Fallback hardcoded session secret in development mode.

**Proposed Fix:**
- Remove hardcoded secret entirely
- Generate random session secret on startup for development
- Fail fast if SESSION_SECRET not set in any environment
- Update documentation for required environment variables

**Files to Modify:**
- `backend/src/server.ts`
- Update: `.env.example` (if exists)

---

## Phase 3: Medium Severity Issues

### 3.1 Insufficient Rate Limiting
**Severity:** MEDIUM | **File:** `backend/src/server.ts`

**Problem:** Rate limiting only on `/api/auth`, not on operational endpoints.

**Proposed Fix:**
- Add rate limiting to all API routes
- Implement tiered rate limits:
  - Authentication: 20/15min (existing)
  - Read operations: 100/min
  - Write operations: 30/min
  - File uploads: 10/min
- Add rate limit headers to responses

**Files to Modify:**
- `backend/src/server.ts`

---

### 3.2 Improper CORS Configuration
**Severity:** MEDIUM | **File:** `backend/src/server.ts` (lines 40-47, 71)

**Problem:** CORS with credentials and sameSite=none in production.

**Proposed Fix:**
- Validate CORS_ORIGIN is explicitly set in production
- Change sameSite to 'strict' unless cross-origin is required
- Add origin validation function
- Document CORS requirements

**Files to Modify:**
- `backend/src/server.ts`

---

### 3.3 JWT Token Caching Without Secure Invalidation
**Severity:** MEDIUM | **File:** `backend/src/services/endpoints/auth.service.ts`

**Problem:** In-memory token cache without secure cleanup or invalidation.

**Proposed Fix:**
- Implement cache entry limit (max entries)
- Add secure cache cleanup on logout
- Consider user-isolated token caching
- Add cache invalidation endpoint

**Files to Modify:**
- `backend/src/services/endpoints/auth.service.ts`

---

### 3.4 Missing CSRF Protection
**Severity:** MEDIUM | **Scope:** All state-changing endpoints

**Problem:** No CSRF tokens on POST/PUT/DELETE requests.

**Proposed Fix:**
- Implement CSRF token generation
- Add CSRF validation middleware
- Include CSRF token in responses
- Update frontend to include CSRF tokens

**Files to Modify:**
- `backend/src/server.ts`
- `backend/src/middleware/` (new csrf.middleware.ts)
- `frontend/src/services/api/` (all API modules)

---

### 3.5 Weak Settings File Permissions
**Severity:** MEDIUM | **File:** `backend/src/services/analytics/settings.ts`

**Problem:** Settings directory created without explicit permissions.

**Proposed Fix:**
- Set directory permissions to 0700
- Set file permissions to 0600
- Validate permissions on startup
- Warn if permissions are too permissive

**Files to Modify:**
- `backend/src/services/analytics/settings.ts`

---

## Phase 4: Low Severity Issues

### 4.1 Excessive File Upload Size Limit
**Severity:** LOW | **File:** `backend/src/api/endpoints/payloads.routes.ts`

**Problem:** 500MB upload limit is excessive.

**Proposed Fix:**
- Reduce limit to 50MB (configurable via environment)
- Add file type validation
- Implement upload progress tracking

**Files to Modify:**
- `backend/src/api/endpoints/payloads.routes.ts`

---

### 4.2 Temporary Files in World-Writable Directory
**Severity:** LOW | **Files:** Multiple in payloads handling

**Problem:** Using `/tmp` for uploads without proper isolation.

**Proposed Fix:**
- Create application-specific temp directory
- Set restrictive permissions on temp directory
- Generate cryptographically random file names
- Implement temp file cleanup on startup and shutdown

**Files to Modify:**
- `backend/src/api/endpoints/payloads.routes.ts`
- `backend/src/services/endpoints/payloads.service.ts`

---

### 4.3 Insufficient Input Validation on Analytics Queries
**Severity:** LOW | **File:** `backend/src/api/analytics.routes.ts`

**Problem:** Query parameters passed to Elasticsearch with minimal validation.

**Proposed Fix:**
- Add Zod validation schemas for all query parameters
- Validate date formats for from/to parameters
- Whitelist allowed interval values
- Sanitize organization identifiers

**Files to Modify:**
- `backend/src/api/analytics.routes.ts`

---

### 4.4 Path Traversal Risk in Upload-from-Path
**Severity:** LOW | **File:** `backend/src/api/endpoints/payloads.routes.ts`

**Problem:** File path accepted with minimal validation (line 83-107).

**Proposed Fix:**
- Implement path canonicalization
- Check for path traversal patterns (../)
- Restrict to allowed directories
- Reject symbolic links

**Files to Modify:**
- `backend/src/api/endpoints/payloads.routes.ts`

---

### 4.5 Missing Security Headers
**Severity:** LOW | **File:** `backend/src/server.ts`

**Problem:** Several security headers not configured.

**Proposed Fix:**
Add the following headers:
- `Strict-Transport-Security` (HSTS)
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`

**Files to Modify:**
- `backend/src/server.ts`

---

## Implementation Order

I recommend implementing fixes in this order:

| Order | Issue | Phase | Est. Complexity |
|-------|-------|-------|-----------------|
| 1 | Command Injection (1.1) | Critical | High |
| 2 | Weak Encryption (1.2) | Critical | Medium |
| 3 | Session Secret (2.3) | High | Low |
| 4 | CSP + Security Headers (2.2, 4.5) | High | Low |
| 5 | Information Disclosure (2.1) | High | Medium |
| 6 | Rate Limiting (3.1) | Medium | Low |
| 7 | CORS Configuration (3.2) | Medium | Low |
| 8 | CSRF Protection (3.4) | Medium | Medium |
| 9 | File Permissions (3.5) | Medium | Low |
| 10 | JWT Cache Security (3.3) | Medium | Low |
| 11 | Upload Size Limit (4.1) | Low | Low |
| 12 | Temp File Security (4.2) | Low | Medium |
| 13 | Input Validation (4.3) | Low | Low |
| 14 | Path Traversal (4.4) | Low | Low |

---

## Files Summary

**Files to be Modified:**
1. `backend/src/services/endpoints/tasks.service.ts`
2. `backend/src/services/analytics/settings.ts`
3. `backend/src/middleware/error.middleware.ts`
4. `backend/src/services/endpoints/payloads.service.ts`
5. `backend/src/server.ts`
6. `backend/src/services/endpoints/auth.service.ts`
7. `backend/src/api/endpoints/payloads.routes.ts`
8. `backend/src/api/analytics.routes.ts`
9. `frontend/src/services/api/*.ts` (for CSRF)

**New Files to Create:**
1. `backend/src/utils/command-sanitizer.ts`
2. `backend/src/middleware/csrf.middleware.ts`

---

## Approval Required

Please review this plan and let me know:

1. **Approve All** - Implement all fixes in the recommended order
2. **Approve Partial** - Specify which phases/issues to implement
3. **Request Changes** - If you want modifications to any proposed fixes
4. **Questions** - If you need clarification on any findings

Once approved, I will implement the changes, commit them with appropriate messages, and push to the feature branch.
