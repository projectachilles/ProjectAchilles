# Design: Deploy ProjectAchilles on Fly.io

**Date:** 2026-02-21
**Status:** Approved

## Context

ProjectAchilles deploys on Docker Compose (local), Railway, Render, and Vercel. This adds Fly.io as a fifth deployment target. Fly.io runs Docker containers natively, so we use the same `backend/` and `frontend/` directories as Railway and Render — no changes to `backend-serverless/`.

The deployment will use the existing Vercel Clerk production app (already configured for `rga.projectachilles.io` with GitHub + Google OAuth credentials). DNS records will be re-pointed from Vercel to Fly.io.

## Architecture

| Service | Fly App | Docker Image | Custom Domain |
|---------|---------|-------------|---------------|
| Backend | `achilles-backend` | `backend/Dockerfile` | `rga.agent.projectachilles.io` |
| Frontend | `achilles-frontend` | `frontend/Dockerfile` | `rga.projectachilles.io` |

Both services run as always-on Fly Machines (no auto-stop). The backend has a 1 GB persistent volume at `/root/.projectachilles` for SQLite, certificates, Go build cache, and agent binaries.

## Design Decisions

### 1. Same Docker images as Render/Railway
The existing Dockerfiles work unmodified on Fly.io. No adapter code, no conditional logic.

### 2. Always-on Machines
Agents send heartbeats every 60s. Auto-stop would add cold-start latency that confuses monitoring. Both machines run continuously on shared-2x (512 MB) for backend and shared-1x (256 MB) for frontend.

### 3. Direct CORS (no internal networking needed)
Frontend calls backend via public URL (`VITE_API_URL`), same pattern as Render Starter. Fly.io does support private networking (`.internal` DNS), but direct CORS is simpler and consistent with existing deployments.

### 4. Clerk app re-assignment
The Vercel Clerk app already has production keys for `rga.projectachilles.io` with `clerk.rga.projectachilles.io` DNS and configured GitHub + Google OAuth. We keep the same Clerk keys and OAuth credentials — only DNS targets change from Vercel to Fly.io.

### 5. Persistent volume
Fly volumes are tied to a single Machine in a single region. This is fine because SQLite doesn't support multi-machine concurrency. The volume stores the same data as Render's persistent disk.

## New Files

| File | Purpose |
|------|---------|
| `backend/fly.toml` | Fly Machine config (port, volume, health check, machine size) |
| `frontend/fly.toml` | Fly Machine config (port, machine size) |
| `FLY.md` | Deployment guide matching RENDER.md / VERCEL.md pattern |

## Unchanged

- `backend/Dockerfile`, `backend/src/` — no changes
- `frontend/Dockerfile`, `frontend/src/` — no changes
- `backend-serverless/` — untouched
- All existing deployment configs (render.yaml, railway.json/toml)

## Cost Estimate

| Service | Est. Monthly Cost |
|---------|------------------|
| Backend Machine (shared-2x-512mb) | ~$5 |
| Frontend Machine (shared-1x-256mb) | ~$3 |
| Volume (1 GB) | ~$0.15 |
| **Total** | **~$8** |

## Implementation Steps

1. Create `fly.toml` for backend and frontend
2. Create Fly.io apps via dashboard (Playwright)
3. Create persistent volume for backend
4. Set environment variables
5. Update DNS (re-point `rga.*` from Vercel to Fly.io)
6. Verify Clerk configuration still works
7. Deploy both services
8. Verify health + login end-to-end
9. Write `FLY.md` documentation
