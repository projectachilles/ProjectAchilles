---
sidebar_position: 6
title: "Build & Certificate Endpoints"
description: "REST API endpoints for triggering builds and managing code signing certificates."
---

# Build & Certificate Endpoints

## Build Endpoints

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

### Download Binary

```
GET /api/tests/builds/:uuid/download?platform=windows&arch=amd64
```

Downloads the built (and optionally signed) binary.

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
