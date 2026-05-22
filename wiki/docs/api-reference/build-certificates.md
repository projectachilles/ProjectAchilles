---
sidebar_position: 6
title: "Build & Certificate Endpoints"
description: "REST API endpoints for triggering builds and managing code signing certificates."
---

# Build & Certificate Endpoints

## Build Endpoints

### List Built Tests

```
GET /api/tests/builds
```

Returns the UUIDs of every test that currently has a compiled binary
available. Used by the **Has Binary** filter in the Test Browser.

**Response:**
```json
{ "success": true, "data": ["uuid-1", "uuid-2", "..."] }
```

:::info Serverless
On Vercel deployments the Go build system is stubbed, so this endpoint is
unavailable and the Test Browser's "Has Binary" toggle has no effect.
:::

### Get Build Info

```
GET /api/tests/builds/:uuid
```

Returns build metadata for a single test — platform, architecture, signing
status, and binary availability.

### Trigger Build

```
POST /api/tests/builds/:uuid
```

Triggers Go cross-compilation for a test.

**Body:**
```json
{
  "platform": "windows",
  "arch": "amd64"
}
```

### Delete Build

```
DELETE /api/tests/builds/:uuid
```

Removes the cached binary for a test.

### Download Binary

```
GET /api/tests/builds/:uuid/download?platform=windows&arch=amd64
```

Downloads the built (and optionally signed) binary.

### Embed Dependencies

```
GET  /api/tests/builds/:uuid/dependencies
POST /api/tests/builds/:uuid/upload
POST /api/tests/builds/:uuid/upload-binary
```

- **`/dependencies`** — lists the `//go:embed` dependencies a test requires,
  flagging which are source-built versus externally supplied.
- **`/upload`** — upload a required embed dependency file (multipart form).
- **`/upload-binary`** — upload a pre-built test binary instead of compiling.

## Certificate Endpoints

### List Certificates

```
GET /api/tests/certificates
```

Returns all certificates with metadata (subject, expiry, active status).

### Upload Certificate

```
POST /api/tests/certificates/upload
```

Upload a PFX/P12 certificate file (multipart form).

### Generate Self-Signed Certificate

```
POST /api/tests/certificates/generate
```

**Body:**
```json
{
  "commonName": "ProjectAchilles Signing",
  "organization": "My Org",
  "validityDays": 365
}
```
