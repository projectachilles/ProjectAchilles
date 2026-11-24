---
sidebar_position: 6
title: "Build & Certificate Endpoints"
description: "REST API endpoints for triggering builds and managing code signing certificates."
---

# Build & Certificate Endpoints

All routes are under `/api/tests`. On Vercel deployments the Go build system is stubbed: Trigger Build and the embed-dependency routes return `503`, and a pre-built binary is uploaded instead.

## Build Platform

```
GET  /api/tests/platform
POST /api/tests/platform
```

The target platform builds compile for. Read needs `settings:platform:read`, write `settings:platform:write`.
Body: `{ "os": "windows", "arch": "amd64" }` (`os`: `windows`, `linux`, `darwin`; `arch`: `amd64`, `386`, `arm64`).

## Build Endpoints

### List Built Tests

```
GET /api/tests/builds
```

Returns the UUIDs of every test that currently has a compiled binary
available. Used by the **Has Binary** filter in the Test Browser. Needs `tests:builds:read`.

**Response:**
```json
{ "success": true, "data": ["uuid-1", "uuid-2", "..."] }
```

:::info[Serverless]
On Vercel deployments the Go build system is stubbed, so this endpoint is
unavailable and the Test Browser's "Has Binary" toggle has no effect.
:::

### Get Build Info

```
GET /api/tests/builds/:uuid
```

Returns build metadata for a single test: `exists`, `platform`, `detectedPlatform`, `signed`,
`fileSize`, `builtAt`, and `job` (`status` `running`, `succeeded` or `failed`, `startedAt`, `finishedAt`, `error`)
when a build was started. Needs `tests:builds:read`.

### Trigger Build

```
POST /api/tests/builds/:uuid
```

Triggers Go cross-compilation (and signing) for a test. Needs `tests:builds:create`. There is no body:
the build uses the saved [build platform](#build-platform) and the active certificate.

- Without a query, the request waits for the build and returns the build info. A failed build returns `422` with the build error. A build that another build of the same test took over (on any backend worker) returns `409 Build was superseded by another build of this test`.
- With `?async=true` it returns `202` with `{ "job": { "status": "running", ... } }` at once. Poll `GET /api/tests/builds/:uuid` and read `job`.

### Delete Build

```
DELETE /api/tests/builds/:uuid
```

Removes the cached binary for a test. Needs `tests:builds:delete`. `409 Build in progress for this test` while the test is building, or while an upload or another delete of the same test is in flight.

### Download Binary

```
GET /api/tests/builds/:uuid/download
```

Downloads the built (and optionally signed) binary, or `404` when the test has no build. Needs `tests:builds:create`.

### Embed Dependencies

```
GET  /api/tests/builds/:uuid/dependencies
POST /api/tests/builds/:uuid/upload
POST /api/tests/builds/:uuid/upload-binary
```

- **`/dependencies`** — lists the `//go:embed` dependencies a test requires,
  flagging which are source-built versus externally supplied.
- **`/upload`** — upload a required embed dependency file (multipart form: `file` and `filename`). Uploads for source-built dependencies are rejected (`400`).
- **`/upload-binary`** — upload a pre-built test binary instead of compiling (multipart form: `file`).

All three need `tests:builds:create`. The two uploads return `409 Build in progress for this test` while the test is building, or while another upload or a delete of the same test is in flight (on any backend worker).

## Certificate Endpoints

### List Certificates

```
GET /api/tests/certificates
```

Returns all certificates with metadata (subject, expiry, active status). Needs `settings:certificates:read`. At most 5 certificates are kept.

### Upload Certificate

```
POST /api/tests/certificates/upload
```

Upload a PFX/P12 certificate file (multipart form: `file`, `password`, optional `label`; 10 MB limit). Needs `settings:certificates:create`. A sixth certificate returns `400`.

### Generate Self-Signed Certificate

```
POST /api/tests/certificates/generate
```

**Body:**
```json
{
  "commonName": "ProjectAchilles Signing",
  "organization": "My Org",
  "country": "US",
  "label": "optional",
  "password": "optional"
}
```

`commonName`, `organization` and `country` (a 2-letter ISO code) are required. Needs `settings:certificates:create`.

### Manage Certificates

```
PUT    /api/tests/certificates/:id/active    : make this the certificate builds sign with
PATCH  /api/tests/certificates/:id           : change the label: { "label": "..." }
DELETE /api/tests/certificates/:id           : needs settings:certificates:delete
GET    /api/tests/certificates/:id/download  : download the PFX file (settings:certificates:read)
```

`:id` has the form `cert-<timestamp>`; anything else returns `400`. Setting the active certificate and changing a
label need `settings:certificates:create`.

The older single-certificate routes `GET`, `POST` and `DELETE /api/tests/certificate` still exist for compatibility.
