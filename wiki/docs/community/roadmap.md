---
sidebar_position: 3
title: "Roadmap"
description: "ProjectAchilles product roadmap — planned features and development direction."
---

# Roadmap

## Q1 2026 (Completed)

- Agent system (enrollment, heartbeat, task execution, self-update)
- Code signing (Windows Authenticode, macOS ad-hoc)
- Task scheduling (daily/weekly/monthly, randomized timing)
- 30+ analytics endpoints (Defense Score, heatmaps, treemaps, trends)
- Microsoft Defender integration (Secure Score, alerts, cross-correlation)
- Trend alerting (Slack Block Kit, email via Nodemailer)
- MITRE ATT&CK coverage matrix
- 5 deployment targets (Docker, Railway, Render, Fly.io, Vercel)
- macOS agent support (launchd, sysctl, rcodesign)
- Remote agent uninstall
- Risk acceptance tracking
- 3 visual themes

## Q2 2026 (Shipped)

- CLI tool for headless operations (`achilles`, with AI chat agent and unified `deploy` TUI)
- Documentation wiki (this site)
- API keys for programmatic access (`pa_` bearer tokens with scoped permissions)
- Write-index rollover (dated `achilles-results-<date>` write indices)
- Public + on-prem single-server deployment targets (Caddy TLS)
- Azure/Entra certificate authentication for the Defender integration
- Defender tab redesign (alert drill-down, correlation timeline, detection rate)
- Per-machine schedule randomization
- Blog at [blog.projectachilles.io](https://blog.projectachilles.io) with Spanish/English auto-translation

Carried over to Q3: agent groups and tagging, custom dashboard builder, enhanced reporting (PDF/CSV export).

## Q3–Q4 2026 (Shipped)

- EDR integrations: CrowdStrike Falcon, SentinelOne and Sophos Central, next to Microsoft Defender, each with alert correlation and auto-resolve
- Verdicts from the EDR's own evidence per stage (Protected, Prevented, Detected), and EDR-killed runs and launch blocks counted as protection
- Defense Score on the latest result per test and endpoint; chain depth and stage coverage for multi-stage tests
- Test campaigns (tests x endpoints, one-click runs, evidence matrix)
- Pre-execution notices and a daily advance digest for the security team
- Print-ready execution report (PDF) and CSV/JSON exports
- Server installer (`achilles-installer`) for on-prem LAN and cloud servers, with a name-constrained CA
- Windows Hyper-V appliance and an offline kit for workshops
- Console identity (code, name and colour per install)
- Agent update safety checks, per-OS test binaries, and capacity work for fleets of thousands of agents
- Console rebuilt on the f0 design language (single dark theme)

## Planned

Not yet scheduled. The quarters these were first listed under have passed.

- SIEM connectors (Splunk, Sentinel)
- Compliance reporting templates (DORA, TIBER-EU)
- Advanced scheduling (event-triggered execution)
- Agent groups, custom dashboard builder
- AI-powered test recommendations
- Automated gap analysis
- Threat actor emulation profiles
- Community test marketplace

*Deferred:* multi-tenancy. One install per organization is the supported separation model; what shared installs would need is tracked in [#715](https://github.com/projectachilles/ProjectAchilles/issues/715).

## Built on request

These are designed but not scheduled. Each one is built when an organization needs it, so tell us if you do.

### Sign-in without Clerk (generic OIDC) \{#sign-in-without-clerk}

ProjectAchilles signs people in with [Clerk](https://clerk.com). Today, organizations that use Microsoft Entra ID can keep their own accounts, MFA and Conditional Access through a Clerk enterprise connection: see [Microsoft Entra ID SSO](../user-guide/authentication/entra-id-sso).

What that doesn't cover is an install that can't depend on a hosted sign-in service, such as an air-gapped network. For those, the plan is an alternative sign-in for self-hosted installs:

- **Generic OpenID Connect**, so it works with Entra ID, AD FS, Keycloak and other providers. ProjectAchilles never handles passwords and does not connect to Active Directory over LDAP.
- **Chosen per install.** Clerk stays the default, and the only option for Vercel and hosted installs.
- **Roles from a claim** your identity provider sends, mapped to the existing `admin`, `operator`, `analyst` and `explorer` roles.

It gets built when one of these happens:

- an organization tells us Clerk prevents them from adopting ProjectAchilles;
- someone needs an install with no internet access;
- Clerk's pricing or terms change in a way that hurts self-hosted installs.

If one of these is you, open a [GitHub Discussion](https://github.com/projectachilles/ProjectAchilles/discussions) with the "feature-request" label and say which identity provider you use.

## Contributing to the Roadmap

Have ideas for features? Open a [GitHub Discussion](https://github.com/projectachilles/ProjectAchilles/discussions) with the "feature-request" label.
