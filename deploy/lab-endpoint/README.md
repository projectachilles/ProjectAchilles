# Lab endpoint

A throwaway Linux endpoint that runs the ProjectAchilles agent next to a
Docker Compose install, so you can enroll an endpoint and run Linux tests
without touching your own machine. Built for demos and workshops. It is not
a pattern for production endpoints.

## Start

```bash
docker compose -f docker-compose.yml -f docker-compose.lab.yml up -d
# server install (installer / deploy-server.sh):
docker compose -f docker-compose.server.yml -f docker-compose.lab.yml up -d
```

Until it is enrolled, the container waits and prints how to enroll it:

```bash
docker logs achilles-lab-endpoint
```

## Enroll

Create an enrollment token in ProjectAchilles, then:

```bash
docker exec achilles-lab-endpoint enroll <TOKEN>
```

The agent shows up as `lab-endpoint` (linux / amd64). Enrollment survives
restarts and re-creates; it lives in the `lab-endpoint-data` volume.

## Reset

```bash
docker compose -f docker-compose.yml -f docker-compose.lab.yml rm -sf lab-endpoint
docker volume rm <project>_lab-endpoint-data   # e.g. projectachilles_lab-endpoint-data
```

## How it works

- **Image:** `linux/amd64` Debian, with the agent built from `./agent` and
  stamped with the version in `agent/Makefile`. Agent and library tests ship
  amd64 only; on Apple Silicon Docker runs it emulated.
- **Forwarder:** the agent sends its key over plain HTTP only to localhost
  (`agent/internal/config/config.go`, `ValidateServerURL`). A `socat`
  forwarder inside the container passes `127.0.0.1:3000` to `backend:3000`, so
  the agent talks to `http://localhost:3000` and keeps its own hostname and
  `/etc/hosts`.
- **Backend URL:** while the overlay is on, the backend tells newly enrolled
  agents to use `http://localhost:3000`. Agents on other hosts need an
  `https://` URL: set `LAB_AGENT_SERVER_URL` (root `.env` or shell) to it.
- **Machine ID:** the agent encrypts its key with the machine ID. The
  entrypoint keeps one in the volume (`/opt/f0/lab-machine-id`) and copies it
  to `/etc/machine-id` on every start.
- **Deliberately unhardened:** `/etc/ssh/sshd_config` allows root login and 6
  authentication tries, and no kernel modules are blacklisted, so the CIS
  Linux bundle has something to find. No SSH server runs.

## Two demo scenarios

**Shadow AI exfiltration** (`6d33cc62-d59d-4661-a76d-715aa4abddfd`, needs
internet). Run it: Unprotected (101), all four AI vendors answered. Sinkhole
the vendor hosts, the way a protective-DNS service would:

```bash
docker exec achilles-lab-endpoint sh -c 'echo "127.0.0.1 api.openai.com api.anthropic.com generativelanguage.googleapis.com api.githubcopilot.com" >> /etc/hosts'
```

Run it again: Protected (126). Stages 1 and 2 (find keys, collect canary
PII) still succeed; stage 3 is blocked at egress. A firewall *drop* rule
would give Error (999), not Protected: the test treats a silent timeout as
inconclusive.

**CIS Linux Level 1 bundle** (`7f0d43e7-8a7b-48f3-9aff-cfa9703a51e8`,
offline). Run it: 22 of 35 controls fail. Fix four of them:

```bash
docker exec achilles-lab-endpoint sh -c "sed -i 's/^PermitRootLogin yes/PermitRootLogin no/; s/^MaxAuthTries 6/MaxAuthTries 4/' /etc/ssh/sshd_config"
docker exec achilles-lab-endpoint sh -c "printf 'install cramfs /bin/false\nblacklist cramfs\ninstall usb-storage /bin/false\nblacklist usb-storage\n' > /etc/modprobe.d/cis.conf"
```

Run it again: `CH-CL1-001`, `-002`, `-020` and `-021` pass, 18 still fail
(auditd, firewall, time sync and others a container can't pass), and the
bundle stays non-compliant. One fix closes one finding; the rest is a
backlog to triage.

These edits are lost when the container is re-created; reset it to start
the demo over.

## Verified

2026-11-08, Linux host, Docker 29.9, agent 0.7.3, both tests built with
`build_all.sh` (Linux) and run inside the container: Shadow AI 101 → 126;
CIS 22 → 18 failing controls, the four above flipped 101 → 126, bundle 101.
Not yet verified end to end through the UI (build service, task dispatch,
Analytics), on Windows/WSL2 or on Apple Silicon.

## Tests

```bash
bash deploy/lab-endpoint/tests/image.test.sh          # image only
bash deploy/lab-endpoint/tests/stack.test.sh          # backend + endpoint (needs backend/.env)
bash deploy/lab-endpoint/tests/server-config.test.sh  # merges with docker-compose.server.yml
```

`stack.test.sh` runs as compose project `achilles-labtest`; clean it up with
`docker compose -p achilles-labtest down -v`.
