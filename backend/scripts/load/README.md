# Agent fleet load test

`agent-fleet-sim.ts` simulates a fleet of enrolled agents against a real backend
and reports latency, errors, silent agents and restart recovery. It needs no
Elasticsearch, Clerk session or real agent.

```bash
cd backend
# 1. Seed a FRESH database file (never ~/.projectachilles). Each agent gets its
#    own key and a bcrypt (cost 12) hash, hashed on worker threads: roughly
#    2.5 min for 1 000 agents and 7 min for 3 000 on a 24-core machine.
npx tsx scripts/load/agent-fleet-sim.ts --base http://localhost:3000 \
  --db /tmp/sim/agents.db --agents 1000 --minutes 1 --seed-only [--legacy-bcrypt]
# 2. Start the backend on that data directory (see below), then run:
npx tsx scripts/load/agent-fleet-sim.ts --base http://localhost:3000 \
  --db /tmp/sim/agents.db --agents 1000 --minutes 15 [--single-ip] [--samples-out samples.csv]
```

- `--seed-only` inserts N active agents (`sim-<i>`, windows/amd64), each with its
  own key (`ak_` + 32 random bytes as hex), and writes `sim-keys.json` (mode 0600)
  next to the DB. **Never commit it** (it is gitignored).
  Without `--legacy-bcrypt` it also writes the `agent_key_digests` rows (a fleet
  after the digest fix has run once). With it, only bcrypt hashes exist (a fleet
  from before the fix: every agent's first request costs one bcrypt).
- Run mode: each agent polls `GET /api/agent/tasks` every 30 s +/- 5 s and sends
  `POST /api/agent/heartbeat` every 60 s +/- 5 s, from a random start offset.
  Output is one row per minute: requests, p50/p95/max latency (ms), non-2xx
  (in brackets: network errors, including the client's 60 s idle timeout),
  agents with no 2xx for 180 s, and `agent_key_digests` rows (a read-only query
  on `--db`, sampled every 5 s; the time at which every agent has a digest is printed).
- By default each agent sends its own `X-Forwarded-For` (10.x.y.z), like a fleet
  spread over many networks behind a reverse proxy with `TRUST_PROXY_HOPS=1`.
  `--single-ip` omits it: the fleet then shares one egress IP (see the finding below).

## Running the backend capped like a small hosted instance

CPU is capped with Docker's CFS quota (the same mechanism small hosted tiers use):

```bash
docker build -t achilles-sim-backend backend/
docker run -d --name sim-backend --cpus=0.5 --memory=512m \
  --user "$(id -u):$(id -g)" -e HOME=/home/sim --env-file sim.env \
  -v /tmp/sim:/home/sim/.projectachilles -p 3000:3000 achilles-sim-backend
docker restart sim-backend      # mid-run restart
```

Running as your own user (with `HOME` at the mounted directory) keeps the SQLite
files readable for the digest counter. Agent routes need no Elasticsearch, but
the server refuses to start without these in `sim.env` (dummy values are fine
for an agent-only test): `CLERK_PUBLISHABLE_KEY` (well-formed `pk_test_...`),
`CLERK_SECRET_KEY`, `ENCRYPTION_SECRET`, plus `NODE_ENV=production`, `PORT=3000`
and an empty `TESTS_REPO_URL` (skips the test library clone).

## Measured results

0.5 CPU, 512 MB container; simulator and container on one 24-core workstation.
Latencies are client-side, per minute, over all polls and heartbeats.

### N = 1 000, legacy fleet (bcrypt hashes only, no digests)

Backend started cold on the seeded DB; the whole fleet starts within 30 s.
Container restarted 180 s after the last digest appeared.

| Min | Requests | p50 ms | p95 ms | max ms | non-2xx (net err) | Silent > 180 s | Digest rows |
|----:|---------:|-------:|-------:|-------:|------------------:|---------------:|------------:|
| 1 | 146 | 25 220 | 46 687 | 55 657 | 0 | 0 | 140 |
| 2 | 634 | 60 002 | 86 770 | 94 379 | 476 (476) | 0 | 302 |
| 3 | 677 | 107 384 | 117 716 | 124 969 | 476 (476) | 571 | 461 |
| 4 | 826 | 145 914 | 154 993 | 155 067 | 476 (476) | 470 | 636 |
| 5 | 1 013 | 94 006 | 182 460 | 184 825 | 476 (476) | 323 | 792 |
| 6 | 1 540 | 41 080 | 148 515 | 150 022 | 476 (476) | 96 | 951 |
| 7 | 3 067 | 168 | 112 679 | 115 351 | 476 (476) | 0 | 1 000 |
| 8 | 3 068 | 2 | 3 | 49 | 0 | 0 | 1 000 |
| 9 | 3 037 | 2 | 3 | 57 | 0 | 0 | 1 000 |
| 10 (restart) | 3 044 | 2 | 4 | 84 | 79 (79) | 0 | 1 000 |
| 11 | 3 001 | 2 | 3 | 43 | 0 | 0 | 1 000 |
| 12 | 3 044 | 2 | 3 | 48 | 0 | 0 | 1 000 |
| 13 | 2 990 | 2 | 3 | 65 | 0 | 0 | 1 000 |

- **Time until every agent has a digest: 385 s (6.4 min)** (395 s in an earlier
  identical run), about 0.38 s of bcrypt per agent on 0.5 CPU. Up to 571 of 1 000
  agents were silent for more than 180 s at once (minute 3): this is the one-time
  migration storm of deploying the digest fix onto a large legacy fleet. At
  today's sizes (70 agents) it is about 30 s, so deploy the fix before fleets grow.
- **Restart with digests persisted:** only 79 connection-refused requests while
  the process was down (a few seconds), p95 4 ms in the same minute, 3 ms after,
  0 agents silent for 180 s.

### N = 3 000, digests seeded

Container restarted at 3:10 (inside minute 4).

| Min | Requests | p50 ms | p95 ms | max ms | non-2xx (net err) | Silent > 180 s | Digest rows |
|----:|---------:|-------:|-------:|-------:|------------------:|---------------:|------------:|
| 1 | 8 979 | 2 | 494 | 6 731 | 0 | 0 | 3 000 |
| 2 | 8 933 | 2 | 60 | 405 | 0 | 0 | 3 000 |
| 3 | 9 040 | 1 | 3 | 93 | 0 | 0 | 3 000 |
| 4 (restart) | 8 988 | 1 | 3 | 502 | 307 (307) | 0 | 3 000 |
| 5 | 8 984 | 1 | 3 | 86 | 0 | 0 | 3 000 |
| 6 | 9 020 | 2 | 3 | 94 | 0 | 0 | 3 000 |
| 7 | 9 015 | 2 | 3 | 87 | 0 | 0 | 3 000 |
| 8 | 8 969 | 2 | 3 | 88 | 0 | 0 | 3 000 |

3 000 agents (about 150 requests/s) fit in 0.5 CPU with p95 3 ms. Minute 1 is
the cold start (first poll of each agent). After the restart the only errors
are the 307 requests refused while the process was down; p95 was 3 ms again in
the very next minute and no agent went silent.

### Finding: one egress IP is capped at 60 agent requests per minute

A first attempt without per-agent `X-Forwarded-For` (equivalent to `--single-ip`)
got 2 757 non-2xx out of 2 817 requests in minute 1. They are HTTP 429
`Too many authentication attempts` from `cliBearerAuthLimiter` in `server.ts`
(60 requests/minute per IP). `cliBearerLimiterSkip` skips only `Bearer pa_...`
and Clerk-authenticated requests, so `Bearer ak_...` agent traffic is counted
against the per-IP budget before the per-agent limiter ever runs. At about 3
requests/minute per agent, more than about 20 agents behind one NAT or
reverse-proxy address exceed it. The runs above avoid it with per-agent
`X-Forwarded-For`.
