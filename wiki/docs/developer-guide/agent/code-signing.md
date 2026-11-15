---
sidebar_position: 4
title: "Code Signing"
description: "Sign agent and test binaries — Windows Authenticode via osslsigncode, macOS ad-hoc via rcodesign."
---

# Code Signing

Binaries are signed in three places: by the backend when it builds an agent or a test (the usual path), by the agent release workflow, and by the `agent/Makefile` targets for manual builds.

## Windows (Authenticode)

The backend build services (`agentBuild.service.ts` for the agent, `buildService.ts` for tests) sign with `osslsigncode` and the active PFX certificate. The certificate password is passed through a temporary file, not a CLI argument:

1. Password written to a temp file (mode 0600)
2. `osslsigncode sign -pkcs12 <cert.pfx> -readpass <temp-file> ...`
3. Temp file deleted in a `finally` block

```bash
make sign-windows
```

The Makefile target is for manual builds. It reads the certificate from `F0_SIGN_CERT_PATH` and `F0_SIGN_CERT_PASS`, or from the legacy `~/.projectachilles/certs/cert.pfx` + `cert-pass.txt` files. It cannot decrypt the password of a certificate created in the console; in that case it prints a hint and leaves the binary unsigned. Unlike the backend, it passes the password to `osslsigncode` on the command line (`-pass`), so use it only on a machine you trust.

The agent release workflow signs the Windows binary when the `WINDOWS_CERT_PFX` and `WINDOWS_CERT_PASSWORD` repository secrets are set, and checks afterwards that the binary carries a signature.

## macOS (Ad-Hoc)

```bash
make sign-darwin
```

The backend runs `rcodesign sign --code-signature-flags adhoc` and the Makefile runs `rcodesign sign`. No certificate is needed. The agent release workflow signs on a macOS runner with Apple's own tool instead: `codesign --force --sign -`, followed by `codesign --verify`. Apple Silicon Macs refuse to run a binary with no signature at all, which is why the darwin binaries are always signed ad-hoc.

## Linux

No code signing for Linux binaries.

## Signing Failures

In the backend, signing failures are **non-fatal**: the build continues and produces an unsigned binary, and the backend logs that the agent build is unsigned. The UI shows a warning but allows download. The Makefile targets skip signing when no certificate or no `rcodesign` is found.

The agent release workflow also publishes an unsigned Windows binary with a warning by default. Set the repository variable `REQUIRE_SIGNED_AGENT_RELEASE` to `true` to make an unsigned Windows binary fail the release.
