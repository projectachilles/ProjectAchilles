# SAST Triage Results — Phase 2

## Scan Summary

| Scan | Target | Rules | Findings | True Positives |
|---|---|---|---|---|
| TypeScript/JS | backend/, backend-serverless/, frontend/ | p/javascript, p/typescript, p/nodejs, p/react, p/owasp-top-ten, p/cwe-top-25, p/security-audit, p/secrets, custom rules | 22 | 4 (Low, already tracked) |
| Go | agent/ | p/golang, p/owasp-top-ten, p/cwe-top-25, p/security-audit | 14 | 3 (Low/Info) |
| Infrastructure | Dockerfiles, docker-compose, .github/ | p/dockerfile, p/docker, p/supply-chain, p/github-actions | 3 | 3 (Low, already tracked) |

## Go Findings Triage

### False Positives (11)
| Rule | File | Line | Reason |
|---|---|---|---|
| `use-of-unsafe-block` (x11) | `jobobject_windows.go`, `sysinfo_windows.go`, `sysinfo_darwin.go`, `network_windows.go` | Various | Required for Windows syscalls and macOS sysctl — standard Go pattern for OS-level APIs. No user input flows to unsafe operations. |

### True Positives — Low/Informational (3)
| Rule | File | Line | Severity | Action |
|---|---|---|---|---|
| `missing-ssl-minversion` | `httpclient/client.go` | 27 | Low | Add `MinVersion: tls.VersionTLS12` — Go 1.21 defaults to TLS 1.2 but explicit is better |
| `missing-ssl-minversion` | `status/status.go` | 49 | Low | Same — add explicit min version |
| `math-random-used` | `poller/poller.go` | 11 | Info | Used for polling jitter only, not crypto. Consider `crypto/rand` but low risk. |

## Infrastructure Findings Triage

### True Positives — Low (3, all part of PA-013)
| Rule | File | Line | Severity | Action |
|---|---|---|---|---|
| `missing-user` | `backend/Dockerfile` | — | Low | Add `USER node` directive. Already tracked as PA-013. |
| `missing-user` | `frontend/Dockerfile` | — | Low | Same. Part of PA-013. |
| `missing-user-entrypoint` | `backend/Dockerfile` | — | Low | Entrypoint runs as root. Part of PA-013. |

## Notes

- The `p/express` Semgrep ruleset returned HTTP 404 (removed or renamed in Semgrep OSS 1.156.0). TS scan re-run without it.
- Custom rules (5 projectachilles-* rules) ran successfully but produced 0 findings on current code — which is expected since they catch patterns that don't exist yet or were already remediated.
- The absence of TS findings from community rules is notable — the codebase appears clean for common patterns. The real vulnerabilities (PA-001 through PA-019) are logic-level issues that Semgrep community rules don't detect, which is exactly why Phase 7 (custom rule development) is important.

## TypeScript/JS Findings Triage (Re-run)

### False Positives (18)
| Rule | Count | Reason |
|---|---|---|
| `projectachilles-clerk-auth-missing` | 15 | Agent device endpoints intentionally use `requireAgentAuth` not `requireClerkAuth`. CLI auth endpoints are public by design. Rule needs tuning to exclude agent-device routes. |
| `gcm-no-tag-length` | 2 | `enrollment.service.ts` — auth tag IS correctly set via `setAuthTag()` (line 245). The `authTagLength` option is optional when tag is set explicitly. |
| `raw-html-format` | 1 | `integrations.routes.ts:225` — error message from Azure OAuth returned via `res.json()` (auto-escaped), not HTML rendering. |

### True Positives — Low (4, already tracked)
| Rule | File | Line | Severity | Action |
|---|---|---|---|---|
| `projectachilles-env-fallback-insecure` | `backend/src/services/analytics/settings.ts` | 34 | Low | ES API key with hardcoded fallback. Part of PA-005. |
| `projectachilles-env-fallback-insecure` | `backend/src/services/analytics/settings.ts` | 36 | Low | ES password with hardcoded fallback. Part of PA-005. |
| `projectachilles-env-fallback-insecure` | `backend-serverless/src/services/analytics/settings.ts` | 31 | Low | Same in serverless. Part of PA-005. |
| `projectachilles-env-fallback-insecure` | `backend-serverless/src/services/analytics/settings.ts` | 33 | Low | Same in serverless. Part of PA-005. |
