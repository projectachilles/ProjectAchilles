# ProjectAchilles: The Open-Source Platform for Continuous Security Validation

## The Problem Nobody Talks About

Every organization runs penetration tests. Once a year, maybe twice if they're diligent. A team of ethical hackers spends two weeks probing defenses, writes a report, and leaves. The security team scrambles to fix the findings. Then silence — until the next engagement.

But here's the uncomfortable truth: the threat landscape doesn't wait twelve months between attacks. Adversaries evolve daily. New techniques emerge weekly. The defenses you validated in January may have blind spots by March. And the only way to know is to test again — continuously, systematically, and with the precision to measure exactly what your defenses can and cannot detect.

This is the gap that ProjectAchilles was built to close.

## What Is ProjectAchilles?

ProjectAchilles is an open-source platform for continuous security validation. It unifies the offensive and defensive sides of cybersecurity into a single, cohesive system.

At its core, the platform does three things:

1. **Deploys a lightweight agent** to endpoints across an organization — Windows, Linux, and macOS machines.
2. **Executes security tests** on those endpoints — real attack techniques mapped to the MITRE ATT&CK framework — and captures the results.
3. **Measures detection coverage** through an analytics engine backed by Elasticsearch, showing exactly which attacks were detected, which were missed, and where the defensive gaps lie.

Think of it as a continuous feedback loop: attack, measure, improve, repeat.

## The Architecture: Four Pillars

### Pillar 1: The Test Browser

ProjectAchilles maintains a Git-synced library of security tests. Each test is a real attack simulation — a Go binary that executes a specific adversary technique on an endpoint. The library is browsable through a rich web interface where security teams can filter by MITRE ATT&CK technique, tactic, platform, severity, and threat actor.

Every test comes with full metadata: source code, documentation, detection rules written in KQL and YARA, and attack flow diagrams. There is a visual MITRE ATT&CK coverage matrix — a heatmap showing which techniques are covered and which still need tests. This isn't just a list of tools; it's a knowledge base that maps the entire adversary landscape to concrete, executable validations.

### Pillar 2: The Agent System

The Achilles Agent is a custom-built Go binary — lightweight, cross-platform, and designed for autonomous operation. It enrolls with the server using a token-based registration system, then maintains a persistent heartbeat, reporting CPU, memory, disk usage, and uptime metrics in real time.

When a task is assigned, the agent downloads the test binary, verifies its integrity using SHA-256 checksums and Ed25519 cryptographic signatures, executes it, and reports back the results — including stdout, stderr, and exit codes. The entire communication channel is hardened: TLS enforcement, replay protection, constant-time authentication, encrypted credentials at rest with AES-256-GCM, and zero-downtime API key rotation delivered silently through the heartbeat channel.

The agent runs as a native service on every platform: Windows Service Manager, Linux systemd, and macOS launchd. It can self-update with cryptographically signed binaries and can be remotely uninstalled in a clean two-phase process from the admin interface.

### Pillar 3: The Build System

Most security testing platforms ship pre-compiled binaries. ProjectAchilles compiles tests from source, on demand, directly from the web interface.

The build system cross-compiles Go source code for any target: Windows or Linux, AMD64 or ARM64. It handles embed dependencies — detecting Go embed directives and allowing operators to upload the required files. Built binaries are signed: Windows gets Authenticode signatures via osslsigncode with a multi-certificate management system supporting up to five certificates. macOS binaries receive ad-hoc code signatures via rcodesign. The system even handles multi-binary bundles where an orchestrator test embeds multiple validator binaries, each signed individually before embedding.

Building from source means full transparency. Every test binary can be audited, every build is reproducible, and there are no opaque pre-compiled blobs in the system.

### Pillar 4: The Analytics Engine

This is where offense meets defense.

Every test execution produces results that flow into Elasticsearch. The analytics engine provides over thirty query endpoints that slice this data in every dimension a security team needs:

- **Defense Score** — A single aggregate number that answers "how protected are we?" with breakdowns by test, technique, category, hostname, and severity.
- **Trend Analysis** — Rolling defense scores over time, showing whether your security posture is improving or degrading.
- **Host-Test Heatmaps** — A matrix showing which endpoints detected which attacks, revealing per-machine blind spots.
- **Treemaps** — Hierarchical visualizations of coverage by category and subcategory.
- **Execution Tables** — Paginated, filterable views of every test run with full detail.

For organizations using Microsoft 365 Defender, the platform pulls Secure Score, alerts, and control profiles through the Microsoft Graph API and cross-correlates them with test results. This creates a unified view: your Defender Secure Score trend overlaid with your Achilles Defense Score, MITRE technique overlap between real Defender alerts and simulated attacks, and gap analysis showing where Defender's coverage diverges from your testing results.

When defense scores drop below configured thresholds, the alerting system fires notifications through Slack (with rich Block Kit formatting) and email, with an in-app notification bell for real-time awareness.

## The Workflow: A Day in the Life

A security operator logs into ProjectAchilles and sees their Defense Score has dropped two points overnight. They click into the trend analysis and identify that a newly added test — simulating a credential access technique — is failing detection across three endpoints in the finance department.

They open the test in the Browser, review the attack flow diagram, and examine the detection rules. The KQL rule expects a specific event log pattern that the finance department's endpoints may not be forwarding. They schedule the test to run again across a broader set of endpoints using the task scheduling system, with randomized timing during business hours to simulate realistic adversary behavior.

The results come back within hours. The analytics engine confirms: 12 of 15 endpoints detect the technique correctly, but three are missing the event log forwarding configuration. The operator raises a ticket, the defensive team fixes the log forwarding, and the test is scheduled to run again next week as a recurring validation.

Defense Score: restored and climbing.

This is continuous security validation. Not a point-in-time report that gathers dust, but a living, breathing measurement of defensive capability.

## Bundle Results: Granular Compliance Tracking

Some security validations aren't single-point tests — they're comprehensive assessments of an entire security domain. ProjectAchilles handles these through its bundle results system.

A cyber-hygiene bundle, for example, might contain dozens of individual controls: Is Windows Defender enabled? Are firewall rules configured correctly? Is disk encryption active? Each control is a separate check, but they execute as a single coordinated bundle.

When the agent reports bundle results, the backend fans them out — each control becomes an independent Elasticsearch document with its own exit code, severity rating, MITRE technique mapping, and tactical classification. This means the analytics engine can track each individual control independently over time, while the execution table groups them under collapsible parent rows showing summary badges like "18 of 22 Controls Protected."

The same protocol handles multi-stage intel-driven tests where each stage simulates a different phase of an advanced persistent threat, from initial access through lateral movement to data exfiltration.

## Security by Design

ProjectAchilles is a security tool, and it takes its own security seriously. The platform underwent an internal security audit covering nine findings across the agent communication channel, with all HIGH and MEDIUM findings resolved.

The protections are layered: TLS enforcement that blocks insecure connections to non-localhost servers, constant-time authentication that prevents timing oracle attacks, replay protection with timestamp validation and skew windows, per-endpoint rate limiting, least-privilege file permissions, and encrypted credential storage using machine-bound keys that make stolen config files useless on other machines.

The CI/CD pipeline includes Semgrep static analysis with eleven community rulesets and five custom rules, automated security reviews on every pull request, and comprehensive test suites — over 1,600 tests across the backend, serverless backend, and frontend.

## Deployment Flexibility

ProjectAchilles deploys anywhere. Five deployment targets are supported out of the box:

- **Docker Compose** for local development and on-premise deployments, with optional local Elasticsearch seeded with synthetic data.
- **Railway** for quick cloud hosting with private networking.
- **Render** for persistent disk deployments with Blueprint-driven infrastructure-as-code.
- **Fly.io** for edge-distributed deployments with custom domains and persistent volumes.
- **Vercel** for fully serverless operation using Turso (distributed SQLite) and Vercel Blob storage.

The serverless deployment is a purpose-built fork — not a hacky adaptation — with async database operations, blob storage replacing the filesystem, pure-JavaScript certificate generation replacing OpenSSL CLI dependencies, and Vercel Cron replacing in-process timers. It's a first-class deployment target, not an afterthought.

## Visual Identity: Three Themes

The platform ships with three distinct visual themes:

- **Default** — Clean light and dark modes with a professional aesthetic.
- **Neobrutalism** — Bold borders, hot pink accents, and an intentionally raw, modernist design language.
- **Hacker Terminal** — A phosphor-green-on-black terminal aesthetic with scanline effects, available in both green and amber variants.

The themes aren't just color swaps. Each one is a complete design system driven by CSS custom properties through Tailwind CSS v4's theme blocks, ensuring every component — from charts to modals to loading spinners — transforms coherently.

## The Vision: Agentic Achilles

The roadmap points toward an ambitious evolution: Agentic Achilles — an AI-powered extension that uses autonomous agents to generate novel detection rules, create and improve security tests with human approval at critical decision points, and form closed-loop feedback systems where detection failures automatically drive improvement.

Imagine a system that detects a coverage gap in your MITRE ATT&CK matrix, generates a new test to validate the missing technique, creates detection rules tailored to your specific SIEM and EDR stack, runs the test, measures the result, and iterates — all with human oversight at every critical juncture. This is the future of continuous security validation: not replacing human expertise, but amplifying it with AI-powered automation.

## Open Source, Community-Driven

ProjectAchilles is licensed under Apache 2.0. The entire codebase — frontend, backend, agent, build system, deployment configurations, and documentation — is open source. The technology stack is modern and well-supported: React 19 with TypeScript, Express with ES modules, Go 1.24 for the agent, Elasticsearch 8.17 for analytics, and SQLite for agent state management.

The project welcomes contributions across every layer: frontend components, backend services, Go agent enhancements, deployment guides, and security test authoring. A comprehensive contributing guide, code of conduct, and security policy ensure a healthy open-source ecosystem.

## Why It Matters

Cybersecurity isn't a destination — it's a continuous journey. Static, point-in-time assessments create an illusion of security that erodes the moment the report is filed. Adversaries don't test your defenses once a year; they probe continuously, adapting and evolving.

ProjectAchilles brings that same relentless, continuous approach to the defenders' side. It turns security validation from a periodic event into an ongoing practice, transforms subjective confidence into measurable scores, and replaces the question "are we secure?" with the far more useful question "what exactly can we detect, and what are we missing?"

Every organization deserves to know their real defensive posture — not the one from last quarter's pentest report, but the one measured this morning, against this week's threat landscape, on today's infrastructure. That's what ProjectAchilles delivers.
