# Rate Limiting

ProjectAchilles applies **inbound** rate limiting (`express-rate-limit`) to protect
its API from abusive clients, and observes **outbound** backoff when calling
third-party APIs. This document covers the inbound limiters — their budgets, the
*key axis* each one throttles on, and the reasoning behind the current calibration.

> Outbound backoff (agent `httpclient`, Defender `graph-client`) is exponential
> backoff on 429/5xx with a max of 3 retries. It is not covered here.

## The guiding principle: throttle the principal, not the IP

A rate limiter's `keyGenerator` is a **threat-model statement**, not a config detail.
Keying on IP encodes the assumption *"one principal per IP"* — true on the public
internet, **false inside an enterprise**, where a whole agent fleet and every SOC
analyst egress through a single corporate NAT IP.

When that assumption breaks, an IP-keyed limiter silently becomes a
**per-customer** bucket: legitimate fleets and dashboards collide with each other
and trip the limit, with no abuse occurring. The fix is to key on the real
principal — the **agent id** for device traffic, the **Clerk user id** for
dashboard traffic — and keep IP (normalized) only as the abuse-resistant fallback
for unauthenticated requests.

The shared keyGenerators live in `middleware/rateLimitKeys.ts` (mirrored in
`backend/` and `backend-serverless/`) as pure, unit-tested functions:

| Helper | Key | Used by |
|--------|-----|---------|
| `agentDeviceKey(req)` | `<normalized-ip>:<x-agent-id \| "none">` | agent device limiter |
| `uiLimiterKey(req)` | `user:<clerkUserId>`, else `ip:<normalized-ip>` | global UI limiter |

`ipKeyGenerator` masks IPv6 to its `/56` block so an attacker can't mint fresh
buckets by rotating the low bits of an allocated range. IPv4 passes through
unchanged.

## Limiter inventory

| Limiter | Location | Window / Budget | Key | Purpose |
|---------|----------|-----------------|-----|---------|
| **Agent device** | `api/agent/index.ts` | 30 / 1 min | `IP:agentId` | All agent device calls (heartbeat, poll, results, update) |
| **Enrollment** | `agent/enrollment.routes.ts` | 300 / 15 min | IP | `POST /enroll` |
| **Download** | `agent/enrollment.routes.ts` | 300 / 15 min | IP | `GET /download` (binary) |
| **Global UI** | `server.ts` / `app.ts` | 1000 / 15 min | Clerk user (IP fallback) | All `/api/*` except agent device + cron |
| **CLI bearer auth** | `server.ts` | 60 / 1 min | IP | Unverified CLI bearer tokens (skips authed traffic) |
| **API key auth** | `server.ts` | 60 / 1 min | IP | `Bearer pa_…` keys (pre-hash brute-force guard) |
| **Key rotation** | `agent/heartbeat.routes.ts` | 3 / 15 min | IP | Agent API-key rotation |
| **CLI device flow** | `cli-auth.routes.ts` | 10·60·10 | IP | OAuth device-code / poll / refresh |

## Calibration rationale

### Agent device — 30 / 1 min, keyed `IP:agentId`

A healthy agent's **default idle cadence** is poll every 30 s (2/min) + heartbeat
every 60 s (1/min) = **3 req/min**, plus per-task result POSTs and hourly update
checks. The budget gives **~10× headroom** over idle so normal operation never
trips, and — critically — recovers within the **60 s window** if it ever does.

The hard floor is `HEARTBEAT_TIMEOUT_SECONDS = 180` (3 missed heartbeats → the
backend marks the agent **offline**). A limiter that locks an agent out long enough
to miss 3 heartbeats manufactures the exact disconnect cascade it sits next to. The
previous `100 / 15 min` budget (~6.6/min, barely 2× idle) combined with a 15-minute
lockout could do precisely that.

Keying on `IP:agentId` (not IP alone) gives each enrolled agent its own budget even
when a whole fleet shares one NAT IP. An unauthenticated probe with no `X-Agent-ID`
still can't escape its IP bucket.

### Enrollment & download — 300 / 15 min, keyed IP

These run **before** an agent has an identity, so they can only key on IP. The
budget is deliberately high because a real mass rollout (Intune / SCCM / GPO) pushes
a whole fleet from behind one corporate NAT IP in a tight window. The previous
`5` and `10 / 15 min` throttled any deployment past a handful of machines —
e.g. a 250-endpoint rollout would have taken hours just to enroll.

This is safe because **enrollment tokens are 256-bit** (`crypto.randomBytes(32)`):
brute-forcing one is computationally infeasible, so these limiters provide *zero*
real credential protection — they are pure abuse / DoS limits, and `300 / 15 min`
still stops a runaway enrollment loop while absorbing a few-hundred-endpoint
simultaneous deployment.

> **Sizing note:** 300 is sized for the current largest single-site fleet
> (~250 endpoints behind one NAT). If a customer site exceeds that, raise the
> enrollment/download budgets — they are the one number still tied to fleet size
> rather than to a per-principal key.

### Global UI — 1000 / 15 min, keyed per Clerk user

The dashboard polls hard (AgentsPage 15 s, TasksPage 10 s, NotificationBell,
Analytics widgets across 30+ ES endpoints). Keyed on IP, a handful of analysts
behind one corporate egress IP would collectively drain a single `1000 / 15 min`
bucket. Keyed on the **Clerk user id**, each analyst gets their own budget;
unauthenticated requests fall back to the normalized IP.

### Left intentionally tight

`cliBearerAuthLimiter`, `apiKeyAuthLimiter` (60/min), `keyRotationLimiter`
(3/15min), and the CLI device-flow limiters guard **auth-probe surfaces** at rates
legitimate clients never approach. The CLI bearer limiter additionally skips
already-authenticated dashboard traffic (`cliBearerLimiterSkip`). Loosening these
would weaken brute-force defense with no user benefit, so they are unchanged.

## Maintaining parity

`backend/` and `backend-serverless/` are independent codebases. Any change to a
limiter's window, budget, or key **must be applied to both**. The serverless
`rateLimitKeys.ts` is self-contained (it has no `safeClerkAuth` helper to import)
but produces identical keys.

## History

- **Jun 2026 (PR #330)** — re-keyed limiters from IP to principal; recalibrated the
  agent-device, enrollment, download, and global-UI budgets; re-synced the
  serverless agent-device key with the Docker IPv6 hardening (originally PR #285).
