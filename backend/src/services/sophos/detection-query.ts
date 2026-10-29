// Sophos XDR (Taegis) GraphQL detection queries, shared by the sync service
// and the PoC capture kit (backend/scripts/sophos-capture.ts) so the two can't
// drift. Selections follow det.graphql: every object-typed field (Timestamp,
// EntityRelationships, StructuredEntity, ...) has a sub-selection; enums
// (status, origin) and scalars don't. __tests__/detection-query.test.ts checks
// every query here against a verbatim excerpt of that schema.
//
// None of these documents is a mutation: the client treats any document that
// mentions mutation/subscription as a write.

const TS = '{ seconds nanos }';

/** What transformGraphqlDetection (normalize.ts) reads. */
const METADATA_SYNC = `title full_title description severity created_at ${TS} first_seen_at ${TS} updated_at ${TS}`;
/** The sync's metadata plus the extra context the PoC capture records. */
const METADATA_CAPTURE = `${METADATA_SYNC} confidence began_at ${TS} ended_at ${TS} inserted_at ${TS} origin`;

const ENTITY_PROPERTIES = `properties {
    ... on EntityHost { hostname hostname_fqdn computer_name host_id os }
    ... on EntityFile { file_name file_path hash_sha256 }
    ... on EntityFileHash { hash_type hash_value }
    ... on EntityProcess { process_name process_id }
    ... on EntityUser { user_name original_user_name domain_name auth_domain }
    ... on EntityIpAddress { ip_address }
  }`;

/** Fields the sync reads (normalize.transformGraphqlDetection). */
export const SOPHOS_DETECTION_SYNC_FIELDS =
  `id status attack_technique_ids metadata { ${METADATA_SYNC} } entities { entities } event_ids { id } `
  + 'enrichment_details { mitre_attack_info { technique_id } }';

/** A superset of the sync fields, for the owner-run PoC capture (decides the final parser). */
export const SOPHOS_DETECTION_CAPTURE_FIELDS = `
  id
  status
  resolution_reason
  attack_technique_ids
  tags
  sensor_types
  metadata { ${METADATA_CAPTURE} }
  entities { entities relationships { from_entity to_entity relationship type } }
  key_entities { entity label }
  source_entities { id display_name subtype identifiers ${ENTITY_PROPERTIES} }
  target_entities { id display_name subtype identifiers ${ENTITY_PROPERTIES} }
  event_ids { id }
  enrichment_details { mitre_attack_info { technique_id technique tactics } }
`;

const response = (fields: string) => `status reason search_id alerts { total_results total_parts part list { ${fields} } }`;

export const SOPHOS_DETECTION_SEARCH_QUERY =
  `query AchillesDetectionSync($in: SearchRequestInput) { detectionSearch(in: $in) { ${response(SOPHOS_DETECTION_SYNC_FIELDS)} } }`;
export const SOPHOS_DETECTION_POLL_QUERY =
  `query AchillesDetectionPoll($in: PollRequestInput) { detectionPoll(in: $in) { ${response(SOPHOS_DETECTION_SYNC_FIELDS)} } }`;

export const SOPHOS_CAPTURE_DETECTION_SEARCH_QUERY =
  `query AchillesDetectionSearch($in: SearchRequestInput) { detectionSearch(in: $in) { ${response(SOPHOS_DETECTION_CAPTURE_FIELDS)} } }`;
export const SOPHOS_CAPTURE_DETECTION_BY_ID_QUERY =
  `query AchillesDetectionById($in: GetByIDRequestInput) { detectionRetrieveById(in: $in) { status reason alerts { total_results list { ${SOPHOS_DETECTION_CAPTURE_FIELDS} } } } }`;

/** Relative CQL window, in minutes (both the sync and the capture use it). */
export function detectionCql(minutes: number): string {
  return `from alert earliest=-${Math.max(1, Math.ceil(minutes))}m`;
}

/** Variables for detectionSearch (SearchRequestInput). */
export function detectionSearchVariables(cql: string, offset: number, limit: number): { in: { cql_query: string; offset: number; limit: number } } {
  return { in: { cql_query: cql, offset, limit } };
}

/** Variables for detectionPoll (PollRequestInput). */
export function detectionPollVariables(searchId: string): { in: { search_id: string } } {
  return { in: { search_id: searchId } };
}

/** Variables for detectionRetrieveById (GetByIDRequestInput). */
export function detectionByIdVariables(ids: string[]): { in: { iDs: string[] } } {
  return { in: { iDs: ids } };
}
