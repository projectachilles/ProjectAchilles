# Security Policy

## Reporting a Vulnerability

The ProjectAchilles team takes security vulnerabilities seriously. We appreciate your efforts to responsibly disclose your findings.

### How to Report

**Please DO NOT report security vulnerabilities through public GitHub issues.**

Instead, please report them via one of the following methods:

1. **GitHub Security Advisories** (Preferred)
   - Navigate to the [Security tab](https://github.com/ubercylon8/ProjectAchilles/security/advisories)
   - Click "Report a vulnerability"
   - Provide detailed information about the vulnerability

2. **Email**
   - Send an email to the repository maintainers
   - Use a descriptive subject line: `[SECURITY] Brief description`

### What to Include

Please include the following information in your report:

- **Type of vulnerability** (e.g., XSS, SQL injection, authentication bypass)
- **Affected component** (frontend, backend, specific module)
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
| 1.x.x   | Yes       |

## Security Best Practices for Users

### Deployment

- **Never expose** the backend API directly to the internet without proper authentication
- Use **HTTPS** in production environments
- Configure appropriate **CORS origins** for your deployment
- Set strong **session secrets** via environment variables
- Implement **rate limiting** at the infrastructure level

### Configuration

```bash
# Production environment variables (example)
SESSION_SECRET=<strong-random-secret>
CORS_ORIGIN=https://your-domain.com
NODE_ENV=production
```

### Authentication

- **Analytics Module**: Elasticsearch credentials are stored in browser localStorage. Ensure users understand the implications.
- **Endpoints Module**: LimaCharlie authentication uses server-side sessions with secure cookies in production.

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
| Rate Limiting | Authentication endpoints (20 req/15 min) |
| Session Security | HttpOnly cookies, secure in production |
| Input Validation | Zod schema validation |
| CORS | Configurable origin restrictions |

### Authentication Models

1. **Browser Module**: Public access (no authentication)
2. **Analytics Module**: Settings-based (Elasticsearch credentials)
3. **Endpoints Module**: Session-based (LimaCharlie OAuth)

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

## Contact

For security-related inquiries that don't fit the above categories, please open a GitHub issue with the `security` label (for non-sensitive matters only).

---

Thank you for helping keep ProjectAchilles and its users safe.
