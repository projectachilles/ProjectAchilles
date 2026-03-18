---
sidebar_position: 4
title: "Code Signing"
description: "Sign agent and test binaries — Windows Authenticode via osslsigncode, macOS ad-hoc via rcodesign."
---

# Code Signing

## Windows (Authenticode)

```bash
make sign-windows
```

Uses `osslsigncode` with the active PFX certificate. The certificate password is passed via a temporary file (not CLI argument) for security:

1. Password written to temp file (mode 0600)
2. `osslsigncode sign -pkcs12 <cert.pfx> -readpass <temp-file> ...`
3. Temp file deleted in `finally` block

## macOS (Ad-Hoc)

```bash
make sign-darwin
```

Uses `rcodesign sign --code-signature-flags adhoc` — no certificate needed. Prevents Gatekeeper from quarantining the binary.

## Linux

No code signing for Linux binaries.

## Signing Failures

Signing failures are **non-fatal** — builds continue and produce unsigned binaries. The UI shows a warning but allows download.
