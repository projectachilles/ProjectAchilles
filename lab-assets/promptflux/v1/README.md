## PROMPTFLUX v1 — Static Stage Artifacts

These files are **static lab assets** for the PROMPTFLUX v1 F0RT1KA / Project
Achilles security test. The test fetches them over HTTPS from
`raw.githubusercontent.com` to produce real network-layer IOCs (TLS handshake,
DNS lookup, SNI, URL path, file-on-disk hash) that EDR and NDR products can
observe and rule against.

## Safety — all payloads are benign

Both artefacts here are **structurally obfuscated but semantically benign**:

- No shell, registry, WMI, network, persistence, or destructive API calls.
- The only observable side-effect is a marker file written under
  `c:\F0\` and a single `WScript.Echo` to console.
- They exist to model the **shape** of a PROMPTFLUX-generated VBS (Chr-based
  string assembly, randomized variable names, stripped comments, inline
  concatenation) so blue-team detection engineers can tune string and
  behavioural rules without handling a live sample.

## Served test

- **UUID:** `0a749b39-409e-46f5-9338-ee886b439cfa`
- **Name:** PROMPTFLUX v1 — LLM-Assisted VBScript Dropper
- **f0_library source:** [`tests_source/intel-driven/0a749b39-409e-46f5-9338-ee886b439cfa/`](https://github.com/ubercylon8/f0_library/tree/main/tests_source/intel-driven/0a749b39-409e-46f5-9338-ee886b439cfa)

## Attribution

Simulation is based on publicly-reported GTIG (Google Threat Intelligence
Group) research on **PROMPTFLUX** (VBScript dropper, disclosed November 2025),
which reportedly uses the Google Gemini API at runtime via a "Thinging"
module to metamorphically rewrite its own body on an hourly cadence, persists
via the user Startup folder, and enumerates removable and network drives via
WMI for propagation. This test reproduces the **shape** of those behaviours —
network fetch, on-disk drop, wscript execution, Startup folder drop, WMI
enumeration — while substituting a benign VBS body and stubbing the
propagation step to enumeration only (no copy).

## Files

| File | Purpose | Fetched by stage |
|------|---------|------------------|
| `gemini_response.json` | Pre-staged Google Gemini API response envelope. `candidates[0].content.parts[0].text` holds a Chr-obfuscated benign VBS body. Stage 1 parses this envelope identically to a real Gemini `generateContent` response. | Stage 1 (T1071.001) |
| `variant_thinging.vbs` | Second benign obfuscated VBS, modelling the "Thinging" hourly rewrite. Different variable names, different Chr offsets, different concatenation order from `gemini_response.json`'s embedded body — same semantic outcome. | Stage 2 (T1027.001) |

## Integrity (SHA256)

| File | SHA256 |
|------|--------|
| `gemini_response.json` | `d26c8b1c23aae42f711e7b3b474e5925f5be30a068ae0bd9d2d33671cce83ff5` |
| `variant_thinging.vbs` | `c254774bf0e050e154ccaa9eb39a191b2855e12669e14088f07a1624eb9a8969` |

Verify locally:

```bash
sha256sum gemini_response.json variant_thinging.vbs
```

## Raw URLs (as consumed by the test)

```
https://raw.githubusercontent.com/projectachilles/ProjectAchilles/main/lab-assets/promptflux/v1/gemini_response.json
https://raw.githubusercontent.com/projectachilles/ProjectAchilles/main/lab-assets/promptflux/v1/variant_thinging.vbs
```

## Do NOT remove

Removing or renaming these files will break the corresponding PROMPTFLUX
test — stages 1 and 2 will return exit code **999**
(`Endpoint.UnexpectedTestError`) instead of a meaningful protection result.
Lab-asset outages must never be confused with EDR protection (exit **126**).

## Rotation

If an asset needs to be moved, coordinate with the f0_library test owner so
the URL constants in the Go source (`stage-T1071.001.go`,
`stage-T1027.001.go`) can be updated at the same time. A patch version bump
(`v1 → v1.1` directory, or updated SHA256 in this README) is expected.

## Why this repo?

- Real TLS handshake against GitHub's fleet certificate — genuine JA3/JA4 IOC
- Real DNS query (`raw.githubusercontent.com`) observable via Sysmon EID 22
- Real SNI observable by NDR / SSL inspection
- No hosts-file mutation required on the lab endpoint
- GitHub raw is commonly allow-listed for developer productivity — mirrors
  real TA tradecraft where the attacker reaches real `generativelanguage.googleapis.com`
