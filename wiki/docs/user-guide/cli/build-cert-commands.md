---
sidebar_position: 6
title: "Build & Certificate Commands"
description: "Triggering builds, managing certificates, and binary signing."
---

# Build & Certificate Commands

The `builds` and `certs` commands manage test binary compilation and code signing certificates. Builds compile Go security tests into signed binaries that agents download and execute. Certificates are used to sign those binaries so they are trusted on target endpoints.

## Build Commands

```bash
achilles builds <subcommand> [flags]
```

### Subcommands

| Subcommand | Description |
|------------|-------------|
| `show` | Show build info for a test |
| `create` | Build and sign a test binary |
| `download` | Download a built test binary |
| `delete` | Delete a build artifact |
| `deps` | List embed dependencies for a test |
| `upload-dep` | Upload an embed dependency |

### builds show

Display build information for a test, including binary metadata, signing status, and timestamps.

```bash
achilles builds show <uuid>
```

**Example:**

```bash
achilles builds show 7659eeba-f315-440e-9882-4aa015d68b27
```

### builds create

Trigger a build (cross-compilation and code signing) for a test binary.

```bash
achilles builds create <uuid>
```

The backend compiles the Go test source, cross-compiles for the target platform, and signs the binary with the active certificate.

**Example:**

```bash
achilles builds create 7659eeba-f315-440e-9882-4aa015d68b27
```

```
  Building 7659eeba-f315-440e-9882-4aa015d68b27...
  ✓ Built T1486-Ransomware — 2.4MB, signed: true
```

:::info
Builds require Go to be installed on the backend server. On serverless deployments (Vercel), the build system is unavailable and returns a 503 error.
:::

### builds download

Download a compiled test binary to your local machine.

```bash
achilles builds download <uuid> [flags]
```

**Flags:**

| Flag | Short | Type | Description |
|------|-------|------|-------------|
| `--output` | `-o` | string | Output file path (defaults to original filename) |

**Example:**

```bash
# Download with original filename
achilles builds download 7659eeba-f315-440e-9882-4aa015d68b27

# Download to a specific path
achilles builds download 7659eeba-f315-440e-9882-4aa015d68b27 -o ./test-binary.exe
```

### builds delete

Delete a build artifact from the server.

```bash
achilles builds delete <uuid>
```

### builds deps

List embed dependencies for a test. Some tests require additional binaries or data files to be embedded during build.

```bash
achilles builds deps <uuid>
```

**Example:**

```bash
achilles builds deps 7659eeba-f315-440e-9882-4aa015d68b27
```

```
  Name                        Required    Present    Source    Size
  ────────────────────────    ─────────   ────────   ────────  ──────────
  validator-defender.exe       yes         yes        auto      1.2MB
  mimikatz.exe                 yes         no         upload    —
  config.json                  no          yes        upload    4.1KB
```

The **Source** column indicates:
- `auto`: Source-built from Go during the build process
- `upload`: Must be manually uploaded before building

### builds upload-dep

Upload an embed dependency file for a test.

```bash
achilles builds upload-dep <uuid> --file <path>
```

**Flags:**

| Flag | Type | Required | Description |
|------|------|----------|-------------|
| `--file` | string | Yes | Path to the dependency file |

**Example:**

```bash
achilles builds upload-dep 7659eeba-f315-440e-9882-4aa015d68b27 \
  --file ./mimikatz.exe
```

:::warning
Only external (non-source-built) dependencies can be uploaded. Source-built dependencies are compiled automatically during the build process.
:::

---

## Certificate Commands

```bash
achilles certs <subcommand> [flags]
```

Certificates are used to code-sign test binaries. Signed binaries are less likely to be flagged by antivirus before they can execute their security test logic.

### Subcommands

| Subcommand | Description |
|------------|-------------|
| `list` | List all certificates |
| `upload` | Upload a PFX/P12 certificate |
| `generate` | Generate a self-signed certificate |
| `activate` | Set a certificate as the active signing cert |
| `rename` | Rename a certificate label |
| `download` | Download a certificate PFX file |
| `delete` | Delete a certificate |

### certs list

List all stored certificates with their status.

```bash
achilles certs list
```

**Example output:**

```
  ID                Label            CN                    Org               Active    Valid Until
  ────────────────  ───────────────  ────────────────────  ────────────────  ───────   ────────────
  cert-1710859200   Production       MyCompany Signing     MyCompany Ltd     ★         12/31/2026
  cert-1710945600   Dev Testing      Dev Signer            Dev Team          —         6/30/2026
```

The active certificate (marked with a star) is used for all build signing operations.

### certs upload

Upload an existing PFX/P12 certificate file.

```bash
achilles certs upload --file <path> --password <password> [flags]
```

**Flags:**

| Flag | Type | Required | Description |
|------|------|----------|-------------|
| `--file` | string | Yes | Path to PFX/P12 file |
| `--password` | string | Yes | Certificate password |
| `--label` | string | No | Display label |

**Example:**

```bash
achilles certs upload \
  --file ./signing-cert.pfx \
  --password "my-cert-password" \
  --label "Production Signing"
```

```
  ✓ Certificate uploaded: MyCompany Signing (cert-1710859200)
```

:::info
The system supports a maximum of 5 certificates (uploaded + generated combined).
:::

### certs generate

Generate a new self-signed certificate for code signing.

```bash
achilles certs generate \
  --cn <common-name> \
  --org <organization> \
  --country <country-code> \
  [flags]
```

**Flags:**

| Flag | Type | Required | Description |
|------|------|----------|-------------|
| `--cn` | string | Yes | Common Name (e.g., "MyCompany Code Signing") |
| `--org` | string | Yes | Organization name |
| `--country` | string | Yes | Two-letter country code (e.g., "US", "GB") |
| `--label` | string | No | Display label |
| `--password` | string | No | Certificate password |

**Example:**

```bash
achilles certs generate \
  --cn "ProjectAchilles Test Signing" \
  --org "Security Team" \
  --country US \
  --label "Dev Testing"
```

```
  Generating certificate...
  ✓ Certificate generated: ProjectAchilles Test Signing (cert-1710945600)
```

### certs activate

Set a certificate as the active signing certificate. All subsequent builds will use this certificate.

```bash
achilles certs activate <id>
```

**Example:**

```bash
achilles certs activate cert-1710859200
```

### certs rename

Change the display label of a certificate.

```bash
achilles certs rename <id> <label>
```

**Example:**

```bash
achilles certs rename cert-1710859200 "Production v2"
```

### certs download

Download a certificate's PFX file.

```bash
achilles certs download <id> [flags]
```

**Flags:**

| Flag | Short | Type | Description |
|------|-------|------|-------------|
| `--output` | `-o` | string | Output file path (defaults to `cert-<id>.pfx`) |

**Example:**

```bash
achilles certs download cert-1710859200 -o ./backup-cert.pfx
```

### certs delete

Delete a certificate from the server.

```bash
achilles certs delete <id>
```

:::warning
If you delete the active certificate, builds will proceed unsigned until you activate another certificate.
:::

## Signing Overview

The build system uses different signing strategies per platform:

| Platform | Signing Method | Certificate Required |
|----------|---------------|---------------------|
| Windows | Authenticode (`osslsigncode`) | Yes -- uses active PFX cert |
| macOS | Ad-hoc (`rcodesign`) | No -- signs without certificate |
| Linux | None | No |

Signing failures are **non-fatal** -- if signing fails, the build completes and the binary is delivered unsigned.
