# Security Policy

## Reporting a Vulnerability

The ProjectAchilles team takes security vulnerabilities seriously. We appreciate your efforts to responsibly disclose your findings.

### How to Report

**Please DO NOT report security vulnerabilities through public GitHub issues.**

Instead, please report them via one of the following methods:

1. **GitHub Security Advisories** (Preferred)
   - Navigate to the [Security tab](https://github.com/projectachilles/ProjectAchilles/security/advisories)
   - Click "Report a vulnerability"
   - Provide detailed information about the vulnerability

2. **Email**
   - Send an email to the repository maintainers
   - Use a descriptive subject line: `[SECURITY] Brief description`

### What to Include

Please include the following information in your report:

- **Type of vulnerability** (e.g., XSS, SQL injection, authentication bypass)
- **Affected component** (frontend, backend, agent, specific module)
- **Steps to reproduce** the vulnerability
- **Proof of concept** (if applicable)
- **Potential impact** of the vulnerability
- **Suggested fix** (if you have one)

### Response Timeline

| Action | Timeline |
|--------|----------|
| Initial acknowledgment | Within 48 hours |
| Initial assessment | Within 7 days |
| Status update | Every 14 days |
| Fix development | Dependent on severity |
| Public disclosure | After fix is released |

### Severity Classification

| Severity | Description | Example |
|----------|-------------|---------|
| Critical | Immediate threat, full system compromise | Remote code execution, authentication bypass |
| High | Significant impact, data exposure | SQL injection, sensitive data leak |
| Medium | Limited impact, requires user interaction | Stored XSS, CSRF |
| Low | Minimal impact | Information disclosure, minor issues |

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.x.x (latest) | Yes |

## Security Architecture

### Authentication Models

ProjectAchilles uses a multi-layer authentication model:

1. **Clerk (Web UI)** — All web routes require Clerk JWT authentication
   - Social login (Google, Microsoft, GitHub)
   - Short-lived tokens with automatic refresh
   - Session isolation per authenticated user
2. **Agent API Keys** — Agents authenticate with unique keys issued during enrollment
   - Separate from Clerk — agents do not require web UI credentials
   - Keys are bound to a specific agent ID and organization
   - Keys rotatable with zero downtime — new key delivered via heartbeat, old key valid for 5-minute grace period
   - Stored encrypted at rest (AES-256-GCM with machine-bound key derivation)
3. **Enrollment Tokens** — One-time or limited-use tokens for agent registration
   - Configurable TTL (time-to-live) and maximum usage count
   - Revocable through the admin interface

### Agent Security

The agent-server communication channel has been hardened through a dedicated internal security audit. See [Agent Security Findings](docs/agent-security-findings.md) for the full audit report covering 9 findings.

**Transport Security:**
- **TLS Enforcement** — `skip_tls_verify` blocked for non-localhost servers at config validation; explicit `--allow-insecure` CLI flag required for self-signed certificate scenarios
- **Replay Protection** — Agent sends `X-Request-Timestamp` (RFC3339 UTC) on every request; server rejects timestamps with >5 minute clock skew; heartbeat payloads include a second timestamp for defense-in-depth

**Authentication & Credential Management:**
- **API Key Rotation** — Zero-downtime key rotation via heartbeat delivery; 5-minute grace period where both old and new keys authenticate; agent auto-saves rotated key to encrypted config
- **Timing Oracle Prevention** — Constant-time bcrypt comparison on both enrollment and agent auth middleware; dummy hash comparison when no candidate matches to prevent distinguishing "no tokens exist" from "wrong token"
- **Encrypted Credential Storage** — Agent API key encrypted at rest with AES-256-GCM; encryption key derived via HMAC-SHA256 from machine ID (`/etc/machine-id`, `IOPlatformUUID`, or Windows `MachineGuid`); config is non-portable across machines

**Binary Integrity:**
- **SHA256 Verification** — Agents verify test binary integrity via checksum before execution
- **Ed25519 Update Signatures** — Server signs agent binary SHA256 hashes with an Ed25519 keypair; agents verify signatures before applying self-updates; public key distributed during enrollment
- **Isolated Execution** — Test binaries run in temporary directories (0700) that are cleaned up after execution

**Rate Limiting:**
- Enrollment: 5 requests / 15 minutes per IP
- Agent device endpoints: 100 requests / 15 minutes per agent
- Binary download: 10 requests / 15 minutes per IP
- Key rotation: 3 requests / 15 minutes per IP

**Platform Hardening:**
- **File Permissions** — Agent binary `0700` (owner-only), config `0600`, work directories `0700`, log files `0640`
- **Windows ACLs** — Binary and config restricted via `icacls` to `NT AUTHORITY\SYSTEM` and `BUILTIN\Administrators` only; inherited permissions stripped
- **Permission Enforcement** — Hardened at three points: install time, self-update time, and runtime file creation
- **Heartbeat Jitter** — ±5s randomization on poll intervals to prevent thundering herd
- **Graceful Shutdown** — Agents handle SIGINT/SIGTERM for clean termination

### Certificate & Code Signing Security

- **Encrypted Storage** — Certificate PFX passwords are encrypted at rest using a machine-derived or explicit encryption key (`ENCRYPTION_SECRET`)
- **Certificate Isolation** — Each certificate stored in its own timestamped subdirectory under `~/.projectachilles/certs/`
- **Certificate Limits** — Maximum 5 certificates (uploaded + generated combined)
- **Authenticode Signing** — Windows binaries signed using osslsigncode for tamper detection

### Data Protection

- **Settings Encryption** — Elasticsearch credentials and other sensitive settings encrypted at rest
- **No Credential Logging** — API responses mask sensitive fields (Cloud IDs, API keys)
- **Session Security** — HttpOnly cookies, secure flag in production, SameSite protection

## Security Best Practices for Users

### Deployment

- **Never expose** the backend API directly to the internet without proper authentication
- Use **HTTPS** in production environments
- Configure appropriate **CORS origins** for your deployment
- Set strong **session secrets** via environment variables
- Set `ENCRYPTION_SECRET` explicitly in Docker/PaaS deployments (do not rely on machine-derived keys)
- Implement **rate limiting** at the infrastructure level

### Agent Communication

- Use **HTTPS** for `AGENT_SERVER_URL` in production — the agent enforces TLS for non-localhost servers
- Use ngrok or a reverse proxy with TLS termination for agent-to-server communication
- Revoke enrollment tokens after use to prevent unauthorized agent registration
- **Rotate API keys** regularly via the admin UI — agents receive new keys automatically with zero downtime
- Monitor agent heartbeats for unexpected offline/online patterns
- Agent config files are encrypted with machine-bound keys — copying a config to another machine will not work

### Docker Deployment

- Do not expose Elasticsearch ports publicly when using the local ES profile
- Set `NODE_ENV=production` for production deployments
- Generate unique `SESSION_SECRET` and `ENCRYPTION_SECRET` values per deployment
- Use Docker secrets or environment variable injection — avoid hardcoding credentials

### Configuration

```bash
# Production environment variables (example)
SESSION_SECRET=<strong-random-secret>
ENCRYPTION_SECRET=<strong-random-secret>
CORS_ORIGIN=https://your-domain.com
NODE_ENV=production
AGENT_SERVER_URL=https://your-agent-endpoint.com
```

### Network Security

- Deploy behind a reverse proxy (nginx, Cloudflare, etc.)
- Implement Web Application Firewall (WAF) rules
- Monitor for suspicious activity
- Keep dependencies updated

## Security Features

### Built-in Protections

| Feature | Implementation |
|---------|----------------|
| Helmet.js | Security headers |
| Rate Limiting | Tiered per-endpoint limits: enrollment (5/15min), device (100/15min), download (10/15min), rotation (3/15min), auth (20/15min) |
| Session Security | HttpOnly cookies, secure in production |
| Input Validation | Zod schema validation |
| CORS | Configurable origin restrictions |
| TLS Enforcement | `skip_tls_verify` blocked for remote servers; `--allow-insecure` override with warning |
| Replay Protection | Timestamp validation (5-min window) on all agent requests + payload-level defense-in-depth |
| Binary Verification | SHA256 checksum + Ed25519 signature verification on agent-side |
| Code Signing | Windows Authenticode via osslsigncode, macOS ad-hoc via rcodesign |
| API Key Rotation | Zero-downtime dual-key rotation with heartbeat delivery |
| Credential Encryption | AES-256-GCM for agent config (machine-bound), AES for backend settings |
| Enrollment Tokens | TTL + max-use limits, revocable, timing-oracle-resistant |
| File Permission Hardening | Binary `0700`, config `0600`, Windows ACLs via icacls |
| Dependabot | Automated dependency vulnerability monitoring |
| Semgrep SAST | 11 community rulesets + 5 custom rules in CI |

## Vulnerability Disclosure Policy

We follow a coordinated disclosure process:

1. Reporter submits vulnerability
2. We acknowledge and assess the report
3. We develop and test a fix
4. We release the fix
5. We publicly disclose the vulnerability (with reporter credit, if desired)

### Credit

We believe in recognizing security researchers who help improve our project. With your permission, we will:

- Credit you in the security advisory
- Add you to our security acknowledgments
- Provide a letter of appreciation (upon request)

## Security Updates

Security updates are released as patch versions. We recommend:

- Watching this repository for releases
- Subscribing to GitHub security advisories
- Regularly updating to the latest version
- Keeping the Go agent updated (agents support self-updating)

## Contact

For security-related inquiries that don't fit the above categories, please open a GitHub issue with the `security` label (for non-sensitive matters only).

---

Thank you for helping keep ProjectAchilles and its users safe.
