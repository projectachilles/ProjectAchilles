---
sidebar_position: 1
title: "Security Policy"
description: "ProjectAchilles security policy — vulnerability reporting, response timelines, and severity classification."
---

# Security Policy

## Reporting a Vulnerability

**Please DO NOT report security vulnerabilities through public GitHub issues.**

### Preferred Method

Report via [GitHub Security Advisories](https://github.com/projectachilles/ProjectAchilles/security/advisories):
1. Navigate to the Security tab
2. Click "Report a vulnerability"
3. Provide detailed information

### What to Include

- **Type of vulnerability** (XSS, SQL injection, auth bypass, etc.)
- **Affected component** (frontend, backend, agent, specific module)
- **Steps to reproduce**
- **Proof of concept** (if applicable)
- **Potential impact**
- **Suggested fix** (if available)

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
| Critical | Full system compromise | RCE, auth bypass |
| High | Significant data exposure | SQL injection, data leak |
| Medium | Limited impact, user interaction | Stored XSS, CSRF |
| Low | Minimal impact | Info disclosure |

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.x.x (latest) | Yes |
