---
sidebar_position: 1
title: Introduction
description: ProjectAchilles is an open-source continuous security validation platform — turn threat intelligence into executable tests, deploy agents, and measure defense readiness.
---

# Introduction

**ProjectAchilles** is a continuous security validation platform that turns threat intelligence into measurable defense readiness. Deploy lightweight agents to your endpoints, execute security tests on demand or on schedule, and quantify whether your defenses detect, prevent, or miss each technique — all from one unified interface.

You don't need a red team certification to use it. You don't need to write exploit code. You need to know what threats matter to your organization, and whether you're defended against them.

:::tip[See it in motion]

The **[interactive explainer](pathname:///how-it-works/)** walks through the whole loop with live animations: tests running against endpoints, EDR verdicts, the Defense Score, and how EDR alerts are matched back to the test that caused them.

:::

## Why ProjectAchilles?

Most organizations invest heavily in security tools but struggle to answer a simple question: *are our defenses actually working?*

Threat intelligence reports pile up unread. Compliance checklists are checked once and forgotten. Security teams deploy EDR, SIEM, and endpoint hardening — then hope for the best. When a breach happens, the post-mortem reveals gaps that were always there but never measured.

**ProjectAchilles exists to close this loop.** The platform operationalizes threat intelligence through three core components:

1. **AI-Powered Test Development** — An agentic pipeline transforms threat intelligence articles into complete, deployable security test packages — source code, detection rules, hardening scripts, and documentation — without manual test development.

2. **Execution Framework** — A lightweight Go agent deployed to endpoints (Windows, Linux, macOS) executes security tests on demand or on schedule, reports results with cryptographic integrity, and self-updates without downtime.

3. **Analytics & Measurement** — An Elasticsearch-backed dashboard quantifies defense readiness with scores, outcome and stage breakdowns, trend analysis, and a MITRE ATT&CK coverage matrix — turning raw test results into actionable intelligence for security teams and leadership.

## What It Measures

- **Defense Readiness** — For each threat technique, did your endpoint defenses detect it, block it, or miss it entirely?
- **Controls Compliance** — Are your security configurations (endpoint hardening, identity policies, cloud settings) actually in place?
- **Security ROI** — Which investments are driving measurable protection, and where are the gaps that still need funding?

## Two Modes of Operation

| Mode | Purpose | Input | Output |
|------|---------|-------|--------|
| **Threat-Informed Validation** | Test defenses against real-world attack techniques | Threat intel mapped to MITRE ATT&CK | Per-technique defense score with detection/prevention evidence |
| **Controls Compliance** | Verify security baselines across your fleet | Standards-based control frameworks | Per-control compliance status with remediation guidance |

## Who Is This For?

| Role | How You Use ProjectAchilles |
|------|----------------------------|
| **Security Team Leads** | Schedule validation campaigns, track defense scores over time, identify where to focus hardening efforts |
| **Security Engineers** | Browse and execute tests, review detection gaps, integrate with Elasticsearch and your EDR (Microsoft Defender, CrowdStrike, SentinelOne, Sophos) |
| **GRC / Compliance** | Verify controls compliance across the fleet, track risk acceptance decisions, generate evidence for audits |
| **CISOs / Security Managers** | Review trend analytics, measure security ROI, make data-driven investment decisions |

## Platform Highlights

- **AI-Generated Test Packages** — ~19 artifacts per test including binaries, detection rules (KQL, YARA, Sigma, Elastic EQL, LimaCharlie), hardening scripts, and kill chain diagrams
- **Cross-Platform Agent** — Lightweight Go agent with enrollment, heartbeat monitoring, self-updating, and encrypted credentials across Windows, Linux, and macOS
- **30+ Analytics Endpoints** — Defense scores, outcome breakdown, stage coverage, chain depth, error rate trends, and MITRE ATT&CK coverage
- **Build & Sign From UI** — Cross-compile test binaries and sign with Authenticode (Windows) or ad-hoc signing (macOS)
- **Microsoft Defender Integration** — Sync Secure Score, alerts, and control profiles with cross-correlation analytics
- **CrowdStrike Falcon Integration** — Sync alerts and Zero Trust Assessment scores, correlate them with tests, and optionally auto-resolve test alerts
- **SentinelOne and Sophos Central Integrations** — Sync threats, alerts and posture data, correlate them with tests, and optionally auto-resolve test alerts. See [SentinelOne](../user-guide/integrations/sentinelone) and [Sophos](../user-guide/integrations/sophos)
- **EDR Evidence in Every Verdict** — A result is Protected, Prevented, Detected or Unprotected based on the test's exit code and on the EDR alerts matched to that run, stage by stage
- **Security Test Campaigns** — Save a set of tests × hosts, run it with one click from the Tasks page, and export an evidence matrix (CSV or print) for audits. See [Campaigns](../user-guide/agent-management/campaigns)
- **Pre-execution Notices** — Email the security engineers before every test run and hold the tests until the notice is accepted, so the SOC knows it's a test. See [Pre-execution Notices](../user-guide/integrations/pre-execution-notices)
- **Trend Alerting** — Threshold-based Slack and email notifications with in-app notification bell
- **Many Ways to Deploy** — Docker Compose, a public or on-prem server (script or the `achilles-installer` wizard), a ready-made Windows Hyper-V appliance, Render, Fly.io, and Vercel (serverless, with a reduced feature set)
- **Console Identity** — Give each console a code, name and colour, shown on every page, so you always know which environment you are in
- **Risk Acceptance** — Accept risk for individual controls with audit tracking
- **Unified Security Dashboard** — One landing page for posture across tests, endpoints, and analytics, with a time range selector shared with Analytics and attention chips that link straight to whatever needs a human

![Security Dashboard — attention chips, KPI strip, trend overview, testing cadence, threat actor readiness and ATT&CK outcome matrix](/img/screenshots/security-dashboard.png)

## What's Next?

- **[Features Overview](./features)** — Detailed walkthrough of every platform capability
- **[Architecture](./architecture)** — System design, tech stack, and data flow
- **[Quick Start — Local Dev](./quick-start-local)** — Get running in under 5 minutes
- **[Quick Start — Docker](./quick-start-docker)** — One-command deployment with Docker Compose
