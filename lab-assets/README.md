# lab-assets/

Static artifacts hosted from this repository for F0RT1KA (Project Achilles) security
tests that simulate externally-fetched payloads. The tests reference these files
via `raw.githubusercontent.com` to produce real TLS handshakes, DNS lookups,
SNI values, and HTTP fetch IOCs observable by EDR and NDR products.

## Do NOT remove

Files under this directory are referenced by specific tests in the F0RT1KA
library (`f0_library/tests_source/...`). Removing or renaming them will break
the corresponding tests — they will return exit code `999`
(`Endpoint.UnexpectedTestError`) instead of a meaningful protection result.

## Layout

```
lab-assets/
└── <test-slug>/
    └── <version>/
        ├── README.md       # per-test asset manifest (purpose, origin, SHA256)
        └── ...             # the hosted asset files
```

## Rotation

If an asset needs to be moved, coordinate with the f0_library test owner so
the URL constants in the Go source can be updated at the same time (a patch
version bump of the test is expected).

## Current manifests

| Path | Serves test | f0_library path |
|------|-------------|-----------------|
| `lab-assets/honestcue/v2/` | HONESTCUE v2 | `f0_library/tests_source/intel-driven/e5472cd5-c799-4b07-b455-8c02665ca4cf/` |
| `lab-assets/promptflux/v1/` | PROMPTFLUX v1 | `f0_library/tests_source/intel-driven/0a749b39-409e-46f5-9338-ee886b439cfa/` |
