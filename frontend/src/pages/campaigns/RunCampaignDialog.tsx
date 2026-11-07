import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogHeader, DialogTitle, DialogContent, DialogFooter } from '@/components/shared/ui/Dialog';
import { Button } from '@/components/shared/ui/Button';
import { Alert } from '@/components/shared/ui/Alert';
import { Spinner } from '@/components/shared/ui/Spinner';
import { useCapabilities } from '@/hooks/useCapabilities';
import { campaignsApi, type Campaign, type PreflightResult } from '@/services/api/campaigns';
import { noticesApi } from '@/services/api/notices';

type Skipped = PreflightResult['skipped'];

interface Props {
  open: boolean;
  campaign: Campaign | null;
  onClose: () => void;
}

/** A partial run is rejected with 409 and `{ skipped }` in the body. */
function partialSkipped(err: unknown): Skipped | null {
  const res = (err as { response?: { status?: number; data?: { skipped?: Skipped } } })?.response;
  return res?.status === 409 && Array.isArray(res.data?.skipped) ? res.data.skipped : null;
}

function errorMessage(err: unknown): string {
  const res = (err as { response?: { data?: { error?: string } } })?.response;
  return res?.data?.error ?? (err instanceof Error ? err.message : 'Failed to start run');
}

function SkippedList({ skipped }: { skipped: Skipped }) {
  const groups = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of skipped) m.set(s.reason, (m.get(s.reason) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [skipped]);
  if (groups.length === 0) return null;
  return (
    <div className="mt-3">
      <p className="text-sm font-medium">{`${skipped.length} test × host ${skipped.length === 1 ? 'pair' : 'pairs'} will be skipped`}</p>
      <ul className="mt-1 space-y-1 text-sm text-muted">
        {groups.map(([reason, n]) => (
          <li key={reason}>{`${reason} — ${n}`}</li>
        ))}
      </ul>
    </div>
  );
}

export function RunCampaignDialog({ open, campaign, onClose }: Props) {
  const navigate = useNavigate();
  const { preExecutionNotices } = useCapabilities();
  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const [noticesEnabled, setNoticesEnabled] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [partial, setPartial] = useState<Skipped | null>(null);
  const [launching, setLaunching] = useState(false);
  // Only a launch's own completion clears this; closing/reopening the dialog must not.
  const inFlight = useRef(false);

  const campaignId = campaign?.id;
  useEffect(() => {
    if (!open || !campaignId) return;
    let cancelled = false;
    setPreflight(null);
    setLoadError(null);
    setRunError(null);
    setPartial(null);
    setLaunching(false);
    setNoticesEnabled(false);
    campaignsApi.preflight(campaignId)
      .then((p) => { if (!cancelled) setPreflight(p); })
      .catch((err) => { if (!cancelled) setLoadError(errorMessage(err)); });
    if (preExecutionNotices) {
      noticesApi.getSettings()
        .then((s) => { if (!cancelled) setNoticesEnabled(s.enabled); })
        .catch(() => { /* the line is informational; omit it on failure */ });
    }
    return () => { cancelled = true; };
  }, [open, campaignId, preExecutionNotices]);

  async function launch(confirmPartial: boolean) {
    if (!campaign || inFlight.current) return;
    inFlight.current = true;
    setLaunching(true);
    setRunError(null);
    try {
      const body = confirmPartial
        ? { org_id: campaign.org_id, confirm_partial: true }
        : { org_id: campaign.org_id };
      const result = await campaignsApi.startRun(campaign.id, body);
      inFlight.current = false;
      onClose();
      navigate(`/tasks/campaigns/runs/${result.run_id}`);
    } catch (err) {
      inFlight.current = false;
      const skipped = partialSkipped(err);
      if (skipped) setPartial(skipped);
      else setRunError(errorMessage(err));
      setLaunching(false);
    }
  }

  const requestClose = () => { if (!inFlight.current) onClose(); };

  const noTasks = preflight !== null && preflight.task_count === 0;

  return (
    <Dialog open={open} onClose={requestClose}>
      <DialogHeader onClose={launching ? undefined : requestClose}>
        <DialogTitle>{campaign ? `Run ${campaign.name}` : 'Run campaign'}</DialogTitle>
      </DialogHeader>
      <DialogContent>
        {loadError && <Alert variant="destructive">{loadError}</Alert>}
        {!preflight && !loadError && <div className="flex justify-center py-6"><Spinner /></div>}
        {preflight && (
          <>
            <p className="text-sm font-medium">{`Will create ${preflight.task_count} ${preflight.task_count === 1 ? 'task' : 'tasks'}`}</p>
            {noticesEnabled && (
              <p className="mt-2 text-sm text-muted">A pre-execution notice will be emailed first</p>
            )}
            <SkippedList skipped={partial ?? preflight.skipped} />
          </>
        )}
        {partial && (
          <Alert variant="warning" className="mt-3">
            Some tests cannot run on some hosts. Run the rest, or cancel and fix the plan.
          </Alert>
        )}
        {runError && <Alert variant="destructive" className="mt-3">{runError}</Alert>}
      </DialogContent>
      <DialogFooter>
        <Button variant="outline" onClick={requestClose} disabled={launching}>Cancel</Button>
        {partial ? (
          <Button onClick={() => void launch(true)} disabled={launching}>
            {launching ? 'Starting…' : 'Run the rest'}
          </Button>
        ) : (
          <Button onClick={() => void launch(false)} disabled={launching || !preflight || noTasks}>
            {launching ? 'Starting…' : 'Run'}
          </Button>
        )}
      </DialogFooter>
    </Dialog>
  );
}
