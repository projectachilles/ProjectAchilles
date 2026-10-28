// Compile-time checks for vendor lists that can't import the registry.
// analytics/technique-coverage.ts must stay byte-identical with its
// backend-serverless copy, so it keeps a literal `CoverageVendor` union; this
// backend-only file fails `tsc` when that union and the registry disagree.
import type { CoverageVendor } from '../analytics/technique-coverage.js';
import type { Assert, Equal, EdrVendorKey } from './vendors.js';

export type CoverageVendorMatchesRegistry = Assert<Equal<CoverageVendor, EdrVendorKey>>;

// @ts-expect-error proves Equal rejects a list that misses a vendor
export type EqualRejectsMissingVendor = Assert<Equal<'defender' | 'crowdstrike', EdrVendorKey>>;
