# Excerpt

## Expected Outcomes

- **Protected:** positive quarantine or prevention evidence in any stage produces overall exit **126**. Per-stage 105/126/127 results identify the blocked objective; later independent stages are still attempted.
- **Unprotected:** all five objectives complete without prevention, producing overall exit **101**. Successful stage exit 0 is normalized to 101 in `bundle_results.json`.
- **Test error:** extraction failures, inconclusive OS denials, missing prerequisites, or non-protection failures produce **999** unless another stage has positive block evidence, in which case the orchestrator's any-blocked rule takes precedence.
- **Watchdog timeout:** a stage timeout is logged as stage exit **102** and handled as an error by the orchestrator; it is not represented as an overall 102 result.
- **Observed outcome:** the final Sophos lab run produced stage exits 0/0/126/126/0 and overall **126**, matching the per-stage evidence above.

## Safety and Fidelity Boundaries

- All test-created files are confined to `C:\F0` or `c:\Users\fortika-test`; production enumeration and LSASS access are read-only or handle-only.
- Service creation/deletion applies only to unique `qilin_rwdrv_f0` and `qilin_hlpdrv_f0` entries backed by nonfunctional test-owned files. Privilege changes apply only to the current process token.
- Callback removal is represented by a sandbox JSON registry, not kernel modification. EDR process names are used only for test-owned executables.
- Normal stage returns use deferred cleanup. The orchestrator also deletes both test driver services, terminates only exact test-owned descendant paths, removes the Qilin sandbox, and deletes stand-in/driver files after stages 2 and 3 and during finalization, covering forced watchdog exits.
- The malicious `msimg32.dll` forwarding/loader logic, SEH/VEH obfuscation, user-mode hook and ETW bypasses, patched `pwndll.dll`, LSASS dump, and real encryption/recovery impact are intentionally not reproduced.

## Operational Notes

- **Orchestrator size:** 11,043,664 bytes (10.5 MiB), Yellow tier and below the v2.1 25 MB threshold.
- **Stage sizes:** all signed stages are approximately 3.2–3.4 MB after ordinary Go symbol/debug stripping, satisfying the every-stage-below-5-MB criterion. Gzip remains mandatory; no packer is used.
- **Configured stage budgets:** 180s / 360s / 240s / 180s / 180s for stages 1–5, within a 1,200,000 ms orchestrator execution configuration. These are source-configured ceilings, not observed runtimes.
- **Watchdogs:** `exec.CommandContext` enforces every stage budget. Timeout output is captured and logged, and remaining stages continue.

