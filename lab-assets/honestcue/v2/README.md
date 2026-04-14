# HONESTCUE v2 — Static Stage Artifacts

These files are **static lab assets** for the HONESTCUE v2 F0RT1KA security
test. The test fetches them over HTTPS from `raw.githubusercontent.com` to
produce real network-layer IOCs (TLS handshake, DNS lookup, SNI, URL path,
file-on-disk hash) that EDR and NDR products can observe and rule against.

## Served test

- **UUID:** `e5472cd5-c799-4b07-b455-8c02665ca4cf`
- **Name:** HONESTCUE v2
- **f0_library source:** [`tests_source/intel-driven/e5472cd5-c799-4b07-b455-8c02665ca4cf/`](https://github.com/ubercylon8/f0_library/tree/main/tests_source/intel-driven/e5472cd5-c799-4b07-b455-8c02665ca4cf)

## Files

| File | Purpose | Fetched by stage |
|------|---------|------------------|
| `gemini_response.json` | Pre-staged Google Gemini API response envelope containing the C# source code that stage 2 compiles in memory | Stage 1 (T1071.001) |
| `stage2_payload.exe` | F0RT1KA-signed benign marker PE that stage 3 drops to `%TEMP%` and executes | Stage 3 (T1105) |

## Integrity (SHA256)

| File | SHA256 |
|------|--------|
| `gemini_response.json` | see `sha256sum` at runtime |
| `stage2_payload.exe` | `2af6291f6e741d8b5687e027a9b3318ebccb6a23f7262642443ea70a1e15d21c` |

Verify locally:

```bash
sha256sum gemini_response.json stage2_payload.exe
```

## Raw URLs (as consumed by the test)

```
https://raw.githubusercontent.com/projectachilles/ProjectAchilles/main/lab-assets/honestcue/v2/gemini_response.json
https://raw.githubusercontent.com/projectachilles/ProjectAchilles/main/lab-assets/honestcue/v2/stage2_payload.exe
```

## Rebuilding `stage2_payload.exe`

Source lives in the f0_library repo, **not here**, to keep the asset repo
purely artifact-hosting. To rebuild and re-sign:

```bash
cd f0_library/tests_source/intel-driven/e5472cd5-c799-4b07-b455-8c02665ca4cf/lab_assets/stage2_payload_src
dotnet publish -c Release -r win-x64 --self-contained true \
    -p:PublishSingleFile=true -o ./publish

# Sign with F0RT1KA cert
PASSWORD=$(tr -d '\n\r' < ../../../../../signing-certs/.F0RT1KA.pfx.txt)
osslsigncode sign \
    -pkcs12 ../../../../../signing-certs/F0RT1KA.pfx \
    -pass  "$PASSWORD" \
    -in    ./publish/stage2_payload.exe \
    -out   ../stage2_payload.exe
```

Then copy the updated `stage2_payload.exe` here and commit. A patch version
bump (e.g. `v2 → v2.1` directory, or updated SHA256 in this README) is expected.

## Why this repo?

- Real TLS handshake against GitHub's fleet certificate — genuine JA3/JA4 IOC
- Real DNS query (`raw.githubusercontent.com`) observable via Sysmon EID 22
- Real SNI observable by NDR / SSL inspection
- No hosts-file mutation required on the lab endpoint
- GitHub raw is commonly allow-listed for developer productivity — mirrors real TA tradecraft

## Graceful-failure behavior

If either file becomes unreachable (404, DNS failure, TLS failure), the
corresponding stage exits **999 (UnexpectedTestError)** — never 126 (blocked).
Lab-asset outages are never confused with EDR protection.
