/**
 * EDR vendor registry, mirrored from backend/src/services/outcomes/vendors.ts
 * (a parity test reads the backend file, so change both together). Every
 * vendor here has an enrichment pass writing `<key>_detected`,
 * `<key>_stage_detected`, `<key>_prevented` and `<key>_prevention_action` on
 * result rows; verdict copy, stage badges and the report iterate this list.
 *
 * Display names are verbatim from before the registry existed:
 * `name` verdict copy, `label` reports and emails, `productName` report
 * Method, `abbrev` compact stage badges, `reportName` report diagrams.
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
 * Whose prevention action names a stage when several vendors report one. Not
 * registry order: CrowdStrike's disposition is the most specific, Defender's
 * remediation status the least.
 */
export const PREVENTION_ACTION_PRECEDENCE: readonly EdrVendorKey[] = ['crowdstrike', 'sentinelone', 'defender'];

export function edrVendor(key: EdrVendorKey): EdrVendor {
  const vendor = EDR_VENDORS.find((v) => v.key === key);
  if (!vendor) throw new Error(`Unknown EDR vendor: ${key}`);
  return vendor;
}

/**
 * Lookup for vendor ids that come from the API. A newer backend can send a
 * vendor this build doesn't know (frontend and backend deploy separately), so
 * display paths fall back to the raw id instead of throwing.
 */
export function findEdrVendor(key: string): EdrVendor | undefined {
  return EDR_VENDORS.find((v) => v.key === key);
}

/** Display name for a vendor id from the API, falling back to the raw id for an unknown one. */
export function edrVendorName(key: string): string {
  return findEdrVendor(key)?.name ?? key;
}

/** The per-vendor enrichment flags on a result row. */
export type EdrResultFlags =
  { [K in EdrVendorKey as `${K}_detected` | `${K}_stage_detected` | `${K}_prevented`]?: boolean }
  & { [K in EdrVendorKey as `${K}_prevention_action`]?: string };

/** Bundle-group rollups of the vendor flags (e.g. `crowdstrikePrevented`). */
export type EdrGroupRollup = { [K in EdrVendorKey as `${K}Detected` | `${K}Prevented`]?: boolean };
