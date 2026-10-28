import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { noticesApi, type NoticeListItem } from '@/services/api/notices';
import { Button } from '@/components/shared/ui/Button';
import { Alert } from '@/components/shared/ui/Alert';
import { fieldTextareaClass } from '@/components/shared/ui/formStyles';

const SOURCE_LABEL: Record<NoticeListItem['source_type'], string> = {
  run_now: 'Run Now',
  schedule: 'Schedule',
  manual_retry: 'Retry',
};

/**
 * Notices whose tests are still held because the email has not been accepted,
 * with a way to let a run start anyway (e.g. during a mail outage). Renders
 * nothing when no tests are held.
 */
export function HeldNoticesPanel() {
  const [items, setItems] = useState<NoticeListItem[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [released, setReleased] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await noticesApi.listPending();
      // A day notice with nothing linked yet holds no test, so it isn't actionable.
      setItems(list.filter((n) => n.held_tasks > 0));
    } catch {
      /* the settings card still works without this list */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function release(n: NoticeListItem) {
    if (!reason.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await noticesApi.release(n.id, reason.trim());
      setReleased(`${n.run_tag} released: its tests can start now.`);
      setOpenId(null);
      setReason('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Release failed');
    } finally {
      setBusy(false);
    }
  }

  if (items.length === 0 && !released) return null;

  return (
    <section aria-labelledby="held-notices-heading" className="space-y-3 rounded-md border border-warning/40 bg-warning-dim p-3">
      {released && <Alert variant="success">{released}</Alert>}
      {items.length > 0 && (
        <>
          <h3 id="held-notices-heading" className="flex items-center gap-2 text-sm font-medium text-warning">
            <AlertTriangle className="h-4 w-4" />
            {items.length === 1 ? '1 run is waiting for its notice email' : `${items.length} runs are waiting for their notice email`}
          </h3>
          <ul className="space-y-2">
            {items.map((n) => (
              <li key={n.id} data-testid={`held-${n.id}`} className="rounded border border-border bg-background p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="font-medium">{n.run_tag}</span>
                    <span className="text-muted">
                      {` · ${SOURCE_LABEL[n.source_type]} · waiting since ${new Date(n.created_at).toLocaleString()} · `}
                      {n.held_tasks === 1 ? '1 test held' : `${n.held_tasks} tests held`}
                      {n.attempts > 0 ? ` · ${n.attempts} send attempt${n.attempts === 1 ? '' : 's'}` : ''}
                    </span>
                    {n.last_error && <p className="mt-1 text-xs text-danger">{`Last error: ${n.last_error}`}</p>}
                  </div>
                  {openId !== n.id && (
                    <Button variant="outline" size="sm" onClick={() => { setOpenId(n.id); setReason(''); setError(null); }}>
                      Release without notice
                    </Button>
                  )}
                </div>
                {openId === n.id && (
                  <div className="mt-3 space-y-2">
                    <p className="text-xs text-muted">
                      The held tests start now and the recipients are not emailed. Your name and this reason are recorded
                      on the notice and shown on campaign evidence.
                    </p>
                    <label htmlFor={`release-reason-${n.id}`} className="block text-xs font-medium">Reason</label>
                    <textarea
                      id={`release-reason-${n.id}`}
                      rows={2}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="e.g. Mail server down; SOC informed by phone (ticket CHG-1234)"
                      className={fieldTextareaClass}
                    />
                    {error && <Alert variant="destructive">{error}</Alert>}
                    <div className="flex gap-2">
                      <Button variant="destructive" size="sm" disabled={!reason.trim() || busy} onClick={() => void release(n)}>
                        {busy ? 'Releasing…' : 'Release now'}
                      </Button>
                      <Button variant="ghost" size="sm" disabled={busy} onClick={() => setOpenId(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

export default HeldNoticesPanel;
