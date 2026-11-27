import { useCallback, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAddressWriter } from '@/hooks/useAddressWriter';
import type { BucketRef } from '@/components/shared/activity/activityModel';

const KEYS = ['bucketFrom', 'bucketTo'] as const;

/**
 * The bucket of the activity strip that All Executions is narrowed to, kept in
 * the address as its two instants so a link narrows the same way in any time
 * zone. It is not a filter of the filter bar: it is applied on top of the date
 * range, and the strip keeps showing the whole range.
 *
 * A bucket that cannot be read (one instant missing, not a date, an end not
 * after its start) is no bucket, and is taken out of the address.
 */
export function useActivityBucket(): { bucket: BucketRef | null; setBucket: (next: BucketRef | null) => void } {
  const [params] = useSearchParams();
  const address = useAddressWriter();
  const from = params.get('bucketFrom');
  const to = params.get('bucketTo');
  // A missing or unreadable instant parses to NaN, and no comparison with NaN holds.
  const valid = Date.parse(from ?? '') < Date.parse(to ?? '');
  const bucket = useMemo<BucketRef | null>(() => (valid ? { from: from as string, to: to as string } : null), [valid, from, to]);

  const stray = !valid && (from !== null || to !== null);
  useEffect(() => {
    if (!stray) return;
    address.update((next) => {
      for (const key of KEYS) next.delete(key);
    }, { replace: true });
  }, [stray, address]);

  const setBucket = useCallback(
    (next: BucketRef | null) => {
      // Through the page's writer (see useAddressWriter): it starts from what is pending, not from the last render.
      address.update((p) => {
        if (next) {
          p.set('bucketFrom', next.from);
          p.set('bucketTo', next.to);
        } else {
          for (const key of KEYS) p.delete(key);
        }
        // The open pair and its run were read for another stretch of time and may not be in this one.
        // `expanded` (the list's selected run) stays: a link to a run forces the list, and dropping it
        // here would turn the page to the matrix under the user. The list copes with a run not on its page.
        for (const key of ['pairTest', 'pairHost', 'run']) p.delete(key);
      }, { replace: true });
    },
    [address],
  );

  return { bucket, setBucket };
}
