/**
 * Reading a latest-basis pair key. ElasticsearchService builds them:
 * plain `oid|<uuid>|host`, any-stage bundle `oid|bundle:<id>|host`,
 * per-stage or cyber-hygiene control `oid|<bundle>::<control>|host`.
 * Pure, so modules that only read keys need not load the service.
 */

/** Test (or bundle) UUID behind a pair key. */
export function pairTestUuid(pairKey: string): string {
  const id = pairKey.split('|')[1] ?? '';
  return (id.startsWith('bundle:') ? id.slice('bundle:'.length) : id).split('::')[0];
}

/** Control (or stage) id of a per-stage pair `oid|<bundle>::<control>|host`; undefined for plain and `bundle:` keys. */
export function pairControlId(pairKey: string): string | undefined {
  return (pairKey.split('|')[1] ?? '').split('::')[1];
}

/** True for an any-stage bundle pair `oid|bundle:<id>|host`. */
export function pairIsBundle(pairKey: string): boolean {
  return (pairKey.split('|')[1] ?? '').startsWith('bundle:');
}

/** Organization id of a pair key; '' when the result has none. */
export function pairOrg(pairKey: string): string {
  return pairKey.split('|')[0] ?? '';
}
