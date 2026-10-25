// ES filter clauses that keep a write pass inside the integration's configured
// scope (account / site / group). Docs carry the ids the sync read from the
// agent detection info. A configured level with a doc missing that id fails
// closed (the term query simply doesn't match).

import type { QueryDslQueryContainer } from '@elastic/elasticsearch/lib/api/types.js';
import type { SentinelOneScope } from '../../types/sentinelone.js';

export function scopeFilters(scope: SentinelOneScope | undefined): QueryDslQueryContainer[] {
  const out: QueryDslQueryContainer[] = [];
  if (scope?.account_ids?.length) out.push({ terms: { account_id: scope.account_ids } });
  if (scope?.site_ids?.length) out.push({ terms: { site_id: scope.site_ids } });
  if (scope?.group_ids?.length) out.push({ terms: { group_id: scope.group_ids } });
  return out;
}
