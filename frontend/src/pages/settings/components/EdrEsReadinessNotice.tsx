import { Alert } from '@/components/shared/ui/Alert';
import type { EdrEsPrivilegeGap, EdrEsReadiness } from '@/services/api/edrReadiness';

function Gap({ gap }: { gap: EdrEsPrivilegeGap }) {
  return (
    <li>
      {gap.privileges.map((p, i) => (
        <span key={p}>{i > 0 && ', '}<code>{p}</code></span>
      ))}
      {' on '}<code>{gap.index}</code>
    </li>
  );
}

interface Props {
  readiness: EdrEsReadiness | null;
  /** The integration is saved: a not-ready result means it isn't syncing. */
  configured: boolean;
  /** The result came from Test: a ready result is confirmed too. */
  fromTest: boolean;
}

/** Elasticsearch readiness of an EDR integration, for its Settings card. */
export function EdrEsReadinessNotice({ readiness, configured, fromTest }: Props) {
  if (!readiness) return null;

  if (readiness.status === 'not_ready') {
    return (
      <Alert variant="destructive" title={configured ? 'Saved, but not syncing' : "Elasticsearch isn't ready for this integration"}>
        {readiness.error ? (
          <p>{readiness.error}</p>
        ) : (
          <>
            <p>The Elasticsearch API key used for Analytics is missing:</p>
            <ul className="list-disc pl-5">
              {readiness.missing.map((g) => <Gap key={g.index} gap={g} />)}
            </ul>
          </>
        )}
        {configured && <p className="mt-1">This notice clears on its own once that is fixed.</p>}
      </Alert>
    );
  }

  if (!fromTest) return null;
  return (
    <Alert variant="success">
      <p>Elasticsearch: ready</p>
      {!readiness.privileges_checked && (
        <p className="mt-1"><span>This cluster can't report API key privileges; it is reachable.</span></p>
      )}
      {readiness.recommended.length > 0 && (
        <>
          <p className="mt-1">Also recommended, so later releases can update the index mapping:</p>
          <ul className="list-disc pl-5">
            {readiness.recommended.map((g) => <Gap key={g.index} gap={g} />)}
          </ul>
        </>
      )}
    </Alert>
  );
}
