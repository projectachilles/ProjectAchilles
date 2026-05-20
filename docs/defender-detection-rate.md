# Defender Detection Rate

The **Detection Rate** is the headline metric on the Analytics → Defender tab. It
answers one operational question:

> Of the attack simulations we launched, what share did Microsoft Defender catch?

This document defines the metric precisely, explains the reasoning behind its
design, and records the known approximations so the number is interpreted
correctly.

## Objective

ProjectAchilles is a purple-team platform: it launches attack simulations on
endpoints and measures whether the defensive stack reacts. The Detection Rate
is the cross-correlation between **what we attacked** (test executions in
Elasticsearch) and **what Defender saw** (alerts synced from the Microsoft Graph
API into the `achilles-defender` index).

It is meant to be an *operational* KPI for a single organisation tracking its
own posture over time — not a benchmark for comparing organisations.

## Definition

The Detection Rate is **per-execution**:

```
detectionRate = correlatedExecutions / totalExecutions × 100
```

- **totalExecutions** — the number of attack-simulation test executions in the
  window, counted per technique. A test that exercises N MITRE techniques
  contributes N observations (see "Unit" below).
- **correlatedExecutions** — the subset of those executions that have a
  temporally-correlated Defender alert for the same technique (or its parent —
  see "MITRE roll-up").

A test execution is **correlated** when a Defender alert for the matching
technique was raised within ±`windowMinutes` of the execution (default 60).

### Unit: technique-executions

The test-execution aggregation is bucketed by `f0rtika.techniques`, a
multi-valued field. A test tagged with both `T1059.001` and `T1574.002` is
counted once in each technique bucket. The metric's unit is therefore
**(execution × technique) observations**, not raw test count. This is
intentional: a multi-technique test represents more attack surface, so it is
weighted more heavily. The per-technique breakdown sums consistently to the
overall total.

## MITRE roll-up

Defender tags alerts with MITRE techniques inconsistently — frequently at
**parent** granularity only (`T1574`) even when the simulated behaviour is a
specific sub-technique (`T1574.002`, DLL Side-Loading). Earlier, the metric
matched the test technique against the alert technique by exact string, so a
`T1574.002` test was scored as *missed* even when Defender demonstrably raised a
`T1574` alert for it.

The correlation is now **roll-up aware**:

- A **sub-technique** test (`T1574.002`) is satisfied by an alert tagged with
  its **parent** (`T1574`). The sub-technique is a specialisation of the parent,
  so a parent-level detection legitimately covers it.
- Roll-up is **one-directional**. A **parent** test (`T1574`) is *not* credited
  by a **sibling** sub-technique's alert (`T1574.002`). Crediting it would
  attribute detection of one specific behaviour to a different, unrelated one.

## Exclusions

The test-execution query excludes two kinds of document, because neither
launched an attack that Defender could meaningfully detect:

- **Cyber-hygiene controls** (`f0rtika.category == "cyber-hygiene"`) are
  configuration checks, not attack simulations. The absence of a Defender alert
  for a config check is expected and must not count as a detection miss.
- **Skipped bundle stages** (`f0rtika.is_bundle_control == true` *and* exit code
  `event.ERROR == 0`) never executed — the bundle orchestrator chose not to run
  them. A stage that launched no attack cannot be detected, so counting it would
  depress the rate with misses that never had a chance to succeed. This mirrors
  the rule the Executions table uses to render a stage as "Skipped".

## Approximations

The metric is an analytics rollup, not a per-event join. Two deliberate
approximations:

1. **Hour-bucket granularity.** Test executions and Defender alerts are both
   bucketed into 1-hour intervals. An execution is correlated if *any* alert
   bucket for its technique falls within ±`windowMinutes` of its own bucket.
   With the default 60-minute window this means an alert in hour *H* correlates
   with executions in hours *H−1*, *H*, and *H+1*. All executions sharing a
   correlated hour bucket are counted as correlated together.
2. **Technique-string matching.** Correlation keys on the MITRE technique
   string (with roll-up). Defender alerts that carry an empty `mitre_techniques`
   array — common for malware-family detections such as AV "Wacatac" alerts —
   cannot be correlated by this metric even though they may represent a genuine
   detection. Per-test evidence-based correlation (the drawer drill-down) is the
   tool for those cases; the Detection Rate is a technique-level aggregate.

## Why per-execution, and not per-technique

The metric was previously **per-technique**:
`detectedTechniques / testedTechniques`.

That denominator is a property of the **shared test library**, not of any one
organisation. Every deployment runs the same git-synced `f0_library`, whose
attack bundles cover a fixed set of distinct techniques. Any organisation that
exercises the whole catalogue lands on the same denominator. The numerator was
similarly near-constant: the same technique families trip Defender alerts
regardless of tenant. The result was that two unrelated organisations — with
different endpoints, different alert volumes, and different Secure Scores — both
displayed an identical detection rate, because the metric was structurally
measuring *the library*, not *their defences*.

The per-execution rate is genuinely organisation-specific. It is driven by:

- how many simulations the organisation actually ran,
- and how many of those were caught,

both of which differ per tenant. It also varies meaningfully over time as the
organisation's Defender configuration changes.

### Trade-off

A per-execution rate is sensitive to **test cadence**. An organisation that runs
a large volume of evasion-focused tests will show a lower rate than one running
mostly noisy tests, even with an identical Defender configuration. For a single
organisation trending itself over time with a stable test schedule this is fine
and informative. It does mean the absolute number should **not** be used to rank
organisations against each other.

The per-technique view is retained as **drill-down context** — the
`testedTechniques` / `detectedTechniques` counts and the per-technique
breakdown — but it is no longer the headline.

## API

`GET /api/analytics/defender/correlation/detection-rate?days=<n>&windowMinutes=<n>`

Response shape:

```jsonc
{
  "overall": {
    "detectionRate": 23.1,        // per-execution %, the headline
    "totalExecutions": 87,
    "correlatedExecutions": 20,
    "testedTechniques": 13,       // drill-down context
    "detectedTechniques": 3
  },
  "byTechnique": [
    {
      "technique": "T1574.002",
      "testExecutions": 5,
      "correlatedExecutions": 5,
      "detected": true
    }
    // ...
  ]
}
```

## Code

- `backend/src/services/defender/analytics.service.ts` — `getDetectionRate()`
- `backend-serverless/src/services/defender/analytics.service.ts` — serverless mirror
- `backend/src/api/defender.routes.ts` — route handler
- `frontend/src/pages/analytics/components/DefenderTab.tsx` — headline hero tile
- `frontend/src/pages/analytics/components/DetectionAnalysisCard.tsx` — drill-down card
