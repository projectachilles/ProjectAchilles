/**
 * The EDR vendor registry: the one place an EDR integration is listed.
 *
 * Every vendor here has an enrichment pass that writes `f0rtika.<key>_*`
 * flags on result docs (`_detected`, `_stage_detected`, `_prevented`,
 * `_prevention_action`). Stage verdicts, Analytics queries, reports,
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
] as const satisfies readonly EdrVendor[];

export type EdrVendorKey = (typeof EDR_VENDORS)[number]['key'];

export const EDR_VENDOR_KEYS: readonly EdrVendorKey[] = EDR_VENDORS.map((v) => v.key);

/**
 * Whose prevention action names a stage when several vendors report one
 * (Executions panel copy). Not registry order: CrowdStrike's disposition is
 * the most specific, Defender's remediation status the least.
 */
export const PREVENTION_ACTION_PRECEDENCE: readonly EdrVendorKey[] = ['crowdstrike', 'sentinelone', 'defender'];

export function edrVendor(key: EdrVendorKey): EdrVendor {
  const vendor = EDR_VENDORS.find((v) => v.key === key);
  if (!vendor) throw new Error(`Unknown EDR vendor: ${key}`);
  return vendor;
}

export type EdrFlagKind = 'detected' | 'stage_detected' | 'prevented' | 'prevention_action';

/** The result-doc field an enrichment pass writes, e.g. `f0rtika.crowdstrike_prevented`. */
export function edrFlagField(key: EdrVendorKey, kind: EdrFlagKind): `f0rtika.${EdrVendorKey}_${EdrFlagKind}` {
  return `f0rtika.${key}_${kind}`;
}

/** Compile-time type equality, for lists that can't import the registry (see vendor-assertions.ts). */
export type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
export type Assert<T extends true> = T;
