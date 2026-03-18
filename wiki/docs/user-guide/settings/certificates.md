---
sidebar_position: 1
title: "Certificates & Signing"
description: "Manage code signing certificates for Windows Authenticode signing of test and agent binaries."
---

# Certificates & Signing

## Overview

ProjectAchilles supports up to **5 certificates** (uploaded + generated combined) for code signing Windows binaries.

## Uploading a Certificate

1. Navigate to **Settings** → **Certificates**
2. Click **Upload Certificate**
3. Select a PFX/P12 file
4. Enter the certificate password
5. Click **Upload**

## Generating a Self-Signed Certificate

1. Navigate to **Settings** → **Certificates**
2. Click **Generate Certificate**
3. Fill in the subject fields (Common Name, Organization, etc.)
4. Click **Generate**

:::info Platform Differences
- **Docker/Railway/Render/Fly.io**: Uses OpenSSL CLI for generation and `osslsigncode` for signing
- **Vercel**: Uses `node-forge` (pure JS) for generation; signing is not available (no osslsigncode)
:::

## Active Certificate

One certificate is marked as "active" at a time. The build service uses the active certificate for all Authenticode signing operations.

Click **Set Active** on any certificate to make it the current signing certificate.

## Storage

| Target | Storage Location |
|--------|-----------------|
| Docker/PaaS | `~/.projectachilles/certs/cert-<timestamp>/` |
| Vercel | Vercel Blob (`certs/` prefix) |

## Legacy Migration

If you have flat certificate files (from an older version), they are automatically migrated to the subdirectory structure on first access.
