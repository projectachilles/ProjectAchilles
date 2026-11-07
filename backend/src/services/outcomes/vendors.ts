/**
 * The EDR vendor registry: the one place an EDR integration is listed.
 *
 * Every vendor here has an enrichment pass that writes `f0rtika.<key>_*`
 * flags on result docs (`_detected`, `_stage_detected`, `_prevented`,
 * `_prevention_action`, `_stage_prevented`). Stage verdicts, Analytics queries, reports,
 * campaigns and notices all read their vendor lists from this registry, so a
 * new vendor is one entry here (plus its mirror in
 * `frontend/src/lib/edrVendors.ts`, which a parity test keeps in step).
 * Keyed `Record<EdrVendorKey, …>` maps elsewhere turn a forgotten vendor into
 * a compile error.
 *
 * Display names are copied verbatim from where each was used before the
 * registry existed; don't "harmonize" them, they appear in emails and
 * regulator exports:
 * - `name`: verdict copy ("Detected by CrowdStrike").
 * - `label`: execution report, notices.
 * - `productName`: SB export `preventedBy`/`detectedBy`, report Method.
 * - `abbrev`: compact stage badges.
 * - `reportName`: report diagrams.
 */

import type { QueryDslQueryContainer } from '@elastic/elasticsearch/lib/api/types.js';
export interface EdrVendor {
  key: string;
  name: string;
  label: string;
  productName: string;
  abbrev: string;
  reportName: string;
}

export const EDR_VENDORS = [
  {
    key: 'defender',
    name: 'Defender',
    label: 'Microsoft Defender',
    productName: 'Microsoft Defender for Endpoint',
    abbrev: 'MDE',
    reportName: 'Defender',
  },
  {
    key: 'crowdstrike',
    name: 'CrowdStrike',
    label: 'CrowdStrike Falcon',
    productName: 'CrowdStrike Falcon',
    abbrev: 'CS',
    reportName: 'Falcon',
  },
  {
    key: 'sentinelone',
    name: 'SentinelOne',
    label: 'SentinelOne Singularity',
    productName: 'SentinelOne Singularity',
    abbrev: 'S1',
    reportName: 'SentinelOne',
  },
  {
    key: 'sophos',
    name: 'Sophos',
    label: 'Sophos Intercept X',
    productName: 'Sophos Intercept X',
    abbrev: 'SX',
    reportName: 'Sophos',
  },
] as const satisfies readonly EdrVendor[];

export type EdrVendorKey = (typeof EDR_VENDORS)[number]['key'];

export const EDR_VENDOR_KEYS: readonly EdrVendorKey[] = EDR_VENDORS.map((v) => v.key);

/**
 * Whose prevention action names a stage when several vendors report one
 * (Executions panel copy). Not registry order: CrowdStrike's disposition is
 * the most specific, Defender's remediation status the least.
 */
export const PREVENTION_ACTION_PRECEDENCE: readonly EdrVendorKey[] = ['crowdstrike', 'sentinelone', 'sophos', 'defender'];

export function edrVendor(key: EdrVendorKey): EdrVendor {
  const vendor = EDR_VENDORS.find((v) => v.key === key);
  if (!vendor) throw new Error(`Unknown EDR vendor: ${key}`);
  return vendor;
}

export type EdrFlagKind = 'detected' | 'stage_detected' | 'prevented' | 'prevention_action' | 'stage_prevented';

/** The result-doc field an enrichment pass writes, e.g. `f0rtika.crowdstrike_prevented`. */
export function edrFlagField(key: EdrVendorKey, kind: EdrFlagKind): `f0rtika.${EdrVendorKey}_${EdrFlagKind}` {
  return `f0rtika.${key}_${kind}`;
}

const ALL_FLAG_KINDS: readonly EdrFlagKind[] = ['detected', 'stage_detected', 'prevented', 'prevention_action', 'stage_prevented'];

/** `_source` includes for the vendor flags, vendor by vendor (all four kinds by default). */
export function edrFlagSourceFields(kinds: readonly EdrFlagKind[] = ALL_FLAG_KINDS): string[] {
  return EDR_VENDOR_KEYS.flatMap((v) => kinds.map((k) => edrFlagField(v, k)));
}

/** One `<key>_detected: true` term per vendor: the "an EDR saw it" half of the combined score. */
export function edrDetectedTerms(): Array<{ term: Record<string, true> }> {
  return EDR_VENDOR_KEYS.map((v) => ({ term: { [edrFlagField(v, 'detected')]: true } }));
}

/**
 * "An EDR saw THIS result" — the per-document rule for views that score each
 * stage on its own (technique views, per-doc counts). On a bundle control the
 * wide `<key>_detected` only means some alert named the bundle (another stage
 * or the orchestrator), so a stage needs its own `<key>_stage_detected`; a
 * standalone doc's wide flag is its own detection. A vendor prevention on a
 * conclusive stage always comes with `_stage_detected` (the enrichment passes
 * only take a prevention from a stage match there), so `_prevented` needs no
 * term of its own, and a prevention without a detection stays silent, as in
 * the score. Chain-level verdicts keep `edrDetectedTerms()`.
 */
export function edrOwnDetectedClause(): QueryDslQueryContainer {
  return {
    bool: {
      should: EDR_VENDOR_KEYS.flatMap((v) => [
        { term: { [edrFlagField(v, 'stage_detected')]: true } },
        {
          bool: {
            filter: [{ term: { [edrFlagField(v, 'detected')]: true } }],
            must_not: [{ term: { 'f0rtika.is_bundle_control': true } }],
          },
        },
      ]),
      minimum_should_match: 1,
    },
  };
}

/** The `_source` / top_metrics fields `hasOwnEdrDetection` reads. */
export function edrOwnDetectionFields(): string[] {
  return ['f0rtika.is_bundle_control', ...edrFlagSourceFields(['detected', 'stage_detected'])];
}

/** `edrOwnDetectedClause` evaluated in code, over fields read with `flag` (e.g. top_metrics values). */
export function hasOwnEdrDetection(flag: (field: string) => boolean): boolean {
  const bundleControl = flag('f0rtika.is_bundle_control');
  return EDR_VENDOR_KEYS.some((v) =>
    flag(edrFlagField(v, 'stage_detected'))
    || (!bundleControl && flag(edrFlagField(v, 'detected'))));
}

/** One `<key>_prevented: true` term per vendor: an EDR stopped it itself (see classifyPairOutcome). */
export function edrPreventedTerms(): Array<{ term: Record<string, true> }> {
  return EDR_VENDOR_KEYS.map((v) => ({ term: { [edrFlagField(v, 'prevented')]: true } }));
}

/**
 * The per-vendor enrichment flags on a result row (API field names).
 * `<key>_stage_prevented` stays absent (not false) on docs enriched before it
 * existed, so readers can fall back to the older rule.
 */
export type EdrResultFlags =
  { [K in EdrVendorKey as `${K}_detected` | `${K}_stage_detected` | `${K}_prevented` | `${K}_stage_prevented`]?: boolean }
  & { [K in EdrVendorKey as `${K}_prevention_action`]?: string };

/** Bundle-group rollups of the vendor flags (API field names, e.g. `crowdstrikePrevented`). */
export type EdrGroupRollup = { [K in EdrVendorKey as `${K}Detected` | `${K}Prevented`]?: boolean };

/** Compile-time type equality, for lists that can't import the registry (see vendor-assertions.ts). */
export type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
export type Assert<T extends true> = T;
