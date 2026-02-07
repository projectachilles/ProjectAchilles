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
3. **Enrollment Tokens** — One-time or limited-use tokens for agent registration
   - Configurable TTL (time-to-live) and maximum usage count
   - Revocable through the admin interface

### Agent Security

- **Binary Verification** — Agents verify test binary integrity via SHA256 checksum before execution
- **Isolated Execution** — Test binaries run in temporary directories that are cleaned up after execution
- **Rate Limiting** — Public binary download endpoint limited to 10 requests per 15 minutes
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

- Use **HTTPS** for `AGENT_SERVER_URL` in production
- Use ngrok or a reverse proxy with TLS termination for agent-to-server communication
- Revoke enrollment tokens after use to prevent unauthorized agent registration
- Monitor agent heartbeats for unexpected offline/online patterns

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
| Rate Limiting | Auth endpoints (20 req/15 min), binary download (10 req/15 min) |
| Session Security | HttpOnly cookies, secure in production |
| Input Validation | Zod schema validation |
| CORS | Configurable origin restrictions |
| Binary Verification | SHA256 checksum on agent-side |
| Code Signing | Windows Authenticode via osslsigncode |
| Credential Encryption | AES encryption for settings at rest |
| Enrollment Tokens | TTL + max-use limits, revocable |
| Dependabot | Automated dependency vulnerability monitoring |

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
