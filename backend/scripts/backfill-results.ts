// Backfill ES from durable SQLite — one-shot recovery for tasks whose
// results never made it into Elasticsearch.
//
// Loads backend/.env (via dotenv) so the SettingsService can decrypt
// ~/.projectachilles/analytics.json with ENCRYPTION_SECRET and the
// ES client gets its credentials. Without this, the script process
// would error with "Elasticsearch is not configured".

import 'dotenv/config';
//
// Use cases:
//   1. Recover data lost to the bundle_id::control_id collision bug
//      (every overwritten run is still in tasks.result; new code uses
//      task_id::control_id so backfilled docs do not collide).
//   2. Drain a backlog after an ES outage, faster than waiting for the
//      5-min retry worker tick.
//
// Usage:
//   cd backend && npx tsx scripts/backfill-results.ts
//
// Behavior:
//   - Loops retryPendingIngestions() until no work remains or until 100
//     iterations (safety cap, ~5000 tasks per run).
//   - Idempotent: tasks already at es_ingested=1 are skipped naturally.
//   - Tasks that have hit MAX_INGEST_ATTEMPTS=10 are NOT replayed; they
//     stay in the backlog for manual investigation. Reset with:
//       UPDATE tasks SET ingest_attempts = 0
//        WHERE es_ingested = 0 AND ingest_attempts >= 10;

import { retryPendingIngestions } from '../src/services/agent/ingestionWorker.service.js';
import { closeDatabase, getDatabase } from '../src/services/agent/database.js';

async function main() {
  const db = getDatabase();

  const before = db.prepare(`
    SELECT
      COUNT(*) FILTER (WHERE es_ingested = 1) AS ingested,
      COUNT(*) FILTER (WHERE es_ingested = 0) AS pending,
      COUNT(*) FILTER (WHERE es_ingested = 0 AND ingest_attempts >= 10) AS permanent
    FROM tasks
    WHERE status = 'completed' AND type = 'execute_test' AND result IS NOT NULL
  `).get() as { ingested: number; pending: number; permanent: number };

  console.log('=== Backfill: starting state ===');
  console.log(`  Already ingested: ${before.ingested}`);
  console.log(`  Pending replay  : ${before.pending - before.permanent}`);
  console.log(`  Permanent fail  : ${before.permanent} (skipped — exceeded retry cap)`);
  console.log();

  let iter = 0;
  let totalSucceeded = 0;
  let totalFailed = 0;

  while (iter < 100) {
    iter++;
    const report = await retryPendingIngestions();
    if (report.attempted === 0) {
      console.log(`Iteration ${iter}: nothing to do — stopping.`);
      break;
    }
    totalSucceeded += report.succeeded;
    totalFailed += report.failed;
    console.log(
      `Iteration ${iter}: attempted=${report.attempted} succeeded=${report.succeeded} failed=${report.failed}`,
    );
  }

  const after = db.prepare(`
    SELECT
      COUNT(*) FILTER (WHERE es_ingested = 1) AS ingested,
      COUNT(*) FILTER (WHERE es_ingested = 0) AS pending,
      COUNT(*) FILTER (WHERE es_ingested = 0 AND ingest_attempts >= 10) AS permanent
    FROM tasks
    WHERE status = 'completed' AND type = 'execute_test' AND result IS NOT NULL
  `).get() as { ingested: number; pending: number; permanent: number };

  console.log();
  console.log('=== Backfill: ending state ===');
  console.log(`  Now ingested    : ${after.ingested} (+${after.ingested - before.ingested})`);
  console.log(`  Still pending   : ${after.pending - after.permanent}`);
  console.log(`  Permanent fail  : ${after.permanent}`);
  console.log();
  console.log(`Total this run: succeeded=${totalSucceeded} failed=${totalFailed}`);

  closeDatabase();
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
