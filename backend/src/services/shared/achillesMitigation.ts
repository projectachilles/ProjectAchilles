// Alerts whose prevention action came from Achilles itself: SentinelOne
// automatic mitigation writes an enabled, error-free `f0rtika.auto_mitigated`
// receipt on the alert doc before it kills / quarantines. Our own action is
// not the EDR preventing the test, so every place that turns
// `prevention_action` into "prevented" (enrichment, the analytics facet and
// rows, the execution report) must treat these as detected only.

/** True when the alert doc's `_source` carries an Achilles mitigation receipt. */
export function isAchillesMitigated(source: unknown): boolean {
  const f = (source as { f0rtika?: Record<string, unknown> } | null | undefined)?.f0rtika;
  return f?.auto_mitigated === true && f.auto_mitigation_mode === 'enabled' && !f.auto_mitigation_error;
}

/** `_source` fields isAchillesMitigated() reads. */
export const ACHILLES_MITIGATION_FIELDS = ['f0rtika.auto_mitigated', 'f0rtika.auto_mitigation_mode', 'f0rtika.auto_mitigation_error'];

/** The same test as an Elasticsearch query clause. */
export const ACHILLES_MITIGATED_QUERY = {
  bool: {
    filter: [
      { term: { 'f0rtika.auto_mitigated': true } },
      { term: { 'f0rtika.auto_mitigation_mode': 'enabled' } },
    ],
    must_not: [{ exists: { field: 'f0rtika.auto_mitigation_error' } }],
  },
};
