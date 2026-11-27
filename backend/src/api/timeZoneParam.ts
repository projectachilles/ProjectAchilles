import { AppError } from '../middleware/error.middleware.js';
import { assertTimeZone } from '../services/analytics/activityBuckets.js';

/** The `tz` of the activity endpoints: an IANA zone the runtime knows; UTC when absent. */
export function parseTimeZone(value: unknown): string {
  if (value === undefined) return 'UTC';
  // Length first: the value never reaches Intl unless it could be a zone's name.
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) throw new AppError('Invalid tz', 400);
  try {
    assertTimeZone(value);
  } catch {
    throw new AppError('Invalid tz', 400);
  }
  return value;
}
