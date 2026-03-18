---
sidebar_position: 4
title: "Building & Signing Tests"
description: "Build and sign test binaries from the ProjectAchilles web UI — platform selection, embed dependencies, code signing."
---

# Building & Signing Tests

ProjectAchilles can cross-compile test binaries directly from the web UI using the backend's Go toolchain.

## Build Process

1. Navigate to a test's detail page
2. Click the **Build** button
3. Select the **target platform** (Windows, Linux, macOS) and **architecture** (amd64, arm64)
4. If the test has `//go:embed` directives, upload the required dependency files
5. Click **Build** to trigger cross-compilation
6. Once complete, click **Download** to get the signed binary

## Platform & Architecture Support

| Platform | Architecture | Code Signing |
|----------|-------------|--------------|
| Windows | amd64 | Authenticode (osslsigncode) |
| Linux | amd64 | None |
| macOS | amd64, arm64 | Ad-hoc (rcodesign) |

## Code Signing

### Windows (Authenticode)
Windows binaries are signed with Authenticode using `osslsigncode` and a PFX certificate. Manage certificates in [Settings → Certificates](../settings/certificates).

### macOS (Ad-Hoc)
macOS binaries receive ad-hoc signatures via `rcodesign`. No certificate is required — the signature prevents Gatekeeper from quarantining the binary.

### Linux
Linux binaries are not signed.

:::info Signing Failures Are Non-Fatal
If signing fails (missing certificate, tool error), the build continues and produces an unsigned binary.
:::

## Embed Dependencies

Some tests use Go's `//go:embed` directive to embed files into the binary. The UI detects these directives and shows upload fields for each required file.

- **Source-built dependencies** (compiled from Go source by `build_all.sh`) show a wrench icon and "Auto-built" label — no upload needed
- **External dependencies** (pre-compiled binaries) show an upload button — the Build button is disabled until all external deps are uploaded

## Build Caching

Built binaries are cached by platform and architecture. Subsequent requests for the same build return the cached binary instantly. The cache is cleared when the test source changes.

## Availability by Deployment Target

| Target | Build from Source | Upload Binaries |
|--------|:-----------------:|:---------------:|
| Docker Compose | Yes | Yes |
| Railway | No | Yes |
| Render | Yes | Yes |
| Fly.io | Yes | Yes |
| Vercel | No | Yes |
