---
sidebar_position: 1
title: Introduction
description: ProjectAchilles is an open-source purple team platform for continuous security validation — deploy agents, execute tests, and measure detection coverage.
---

# Introduction

**ProjectAchilles** is a purple team platform that bridges the gap between offensive testing and defensive measurement. Red teams deploy a lightweight Go agent to endpoints and execute security tests on demand or on schedule. Blue teams track detection coverage through an analytics dashboard backed by Elasticsearch, identifying which techniques are detected, which are missed, and where to focus hardening efforts.

The platform replaces the need for commercial endpoint management tools with a purpose-built, open-source agent system — complete with cross-compilation, code signing, task scheduling, and result ingestion.

## Why ProjectAchilles?

Most security teams struggle with a fundamental disconnect: red team tools are separate from blue team dashboards. Attack simulations happen in one tool, detection results are reviewed in another, and the gap between "did we test this technique?" and "did we detect it?" requires manual correlation.

ProjectAchilles unifies this workflow into a single platform:

1. **Browse** security tests mapped to MITRE ATT&CK techniques
2. **Build** test binaries for your target platforms directly from the UI
3. **Deploy** lightweight agents to your endpoints
4. **Execute** tests on demand or on a recurring schedule
5. **Measure** detection coverage with defense scores, heatmaps, and trend analysis
6. **Improve** by closing the gaps your analytics reveal

## Key Highlights

- **Custom Go Agent** — Lightweight agent with enrollment, heartbeat monitoring, task execution, and self-updating across Windows, Linux, and macOS
- **Build From Source** — Cross-compile test binaries for Windows/Linux/macOS (amd64/arm64) directly from the UI
- **Code Signing** — Sign Windows binaries with Authenticode, macOS with ad-hoc signing, multi-certificate management (up to 5 certs)
- **30+ Analytics Endpoints** — Defense scores, heatmaps, treemaps, error rate trends, and coverage breakdowns
- **MITRE ATT&CK Mapping** — Filter tests and results by technique, tactic, and threat actor
- **Task Scheduling** — Recurring execution (daily/weekly/monthly) with randomized timing
- **Git-Synced Test Library** — Tests pulled from a Git repository with automatic sync
- **Microsoft Defender Integration** — Sync Secure Score, alerts, and control profiles with MITRE cross-correlation
- **Trend Alerting** — Threshold-based Slack and email notifications
- **3 Visual Themes** — Default, Neobrutalism, and Hacker Terminal (with green/amber phosphor variants)
- **5 Deployment Targets** — Docker Compose, Railway, Render, Fly.io, and Vercel (serverless)
- **Risk Acceptance** — Accept risk for individual security controls with audit tracking

## Who Is This For?

| Role | How You Use ProjectAchilles |
|------|----------------------------|
| **Red Team** | Build and deploy tests, schedule attack simulations, track which techniques bypass defenses |
| **Blue Team** | Monitor defense scores, review detection gaps, measure improvement over time |
| **Purple Team** | Run collaborative exercises with real-time coverage feedback |
| **Security Engineers** | Integrate with Elasticsearch and Defender for unified security posture views |
| **Security Managers** | Review trend analytics, risk acceptance decisions, and compliance-oriented metrics |

## What's Next?

- **[Features Overview](./features)** — Detailed walkthrough of every platform capability
- **[Architecture](./architecture)** — System design, tech stack, and data flow
- **[Quick Start — Local Dev](./quick-start-local)** — Get running in under 5 minutes
- **[Quick Start — Docker](./quick-start-docker)** — One-command deployment with Docker Compose
