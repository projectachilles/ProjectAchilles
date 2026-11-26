import { useState, useCallback, type ReactNode } from 'react';
import { Loader2, X, ShieldOff, ShieldAlert } from 'lucide-react';
import type { EnrichedTestExecution, RiskAcceptance } from '@/services/api/analytics';
import { Button } from '@/components/ui/button';
import { findAcceptanceForExec } from '../../utils/riskAcceptanceLookup';
import TestInfoModal from '../TestInfoModal';
import type { AcceptRiskItem, InfoModalRequest, RunDetailPanelProps } from './detailParts';

interface RunDetailDialogsOptions {
  riskAcceptances?: Map<string, RiskAcceptance[]>;
  onAcceptRisk?: (items: AcceptRiskItem[], justification: string) => Promise<void>;
  onRevokeRisk?: (acceptanceId: string, reason: string) => Promise<void>;
  onArchive?: (groupKeys: string[]) => Promise<void>;
  acceptingRisk?: boolean;
  archiving?: boolean;
  /** After an archive the user confirmed went through. */
  onArchived?: () => void;
}

export interface RunDetailDialogs {
  /** Spread into RunDetailPanel, next to `row` and useRunDetail's props. */
  panelProps: Pick<
    RunDetailPanelProps,
    | 'getAcceptanceForExec'
    | 'riskEnabled'
    | 'archiveEnabled'
    | 'onRequestAcceptRisk'
    | 'onRequestRevoke'
    | 'onRequestArchive'
    | 'onOpenInfo'
  >;
  /** Render once, anywhere under the page: the dialogs position themselves. */
  dialogs: ReactNode;
  /** Open the accept-risk dialog for these items (bulk action). */
  requestAcceptRisk: (items: AcceptRiskItem[]) => void;
  /** Open the archive confirmation for these group keys (bulk action). */
  requestArchive: (keys: string[]) => void;
}

/**
 * The dialogs a run's detail can open: accept a risk, revoke an acceptance,
 * confirm an archive, show the test's info card. One implementation for the
 * executions list and the coverage matrix's drawer.
 */
export function useRunDetailDialogs({
  riskAcceptances,
  onAcceptRisk,
  onRevokeRisk,
  onArchive,
  acceptingRisk,
  archiving,
  onArchived,
}: RunDetailDialogsOptions): RunDetailDialogs {
  const [confirmArchiveKeys, setConfirmArchiveKeys] = useState<string[] | null>(null);
  const [infoModal, setInfoModal] = useState<(InfoModalRequest & { open: boolean }) | null>(null);

  const archiveEnabled = !!onArchive;

  const handleArchiveConfirm = async () => {
    if (!confirmArchiveKeys || !onArchive) return;
    await onArchive(confirmArchiveKeys);
    setConfirmArchiveKeys(null);
    onArchived?.();
  };

  // ── Risk Acceptance state ────────────────────────────────────────
  const [riskAcceptItems, setRiskAcceptItems] = useState<AcceptRiskItem[] | null>(null);
  const [riskJustification, setRiskJustification] = useState('');
  const [riskScope, setRiskScope] = useState<'host' | 'global'>('global');
  const [revokeTarget, setRevokeTarget] = useState<{ id: string; testName: string } | null>(null);
  const [revokeReason, setRevokeReason] = useState('');

  const riskEnabled = !!onAcceptRisk;

  /** Look up active risk acceptance for a given execution. */
  const getAcceptanceForExec = useCallback(
    (exec: EnrichedTestExecution): RiskAcceptance | undefined =>
      findAcceptanceForExec(exec, riskAcceptances ?? null),
    [riskAcceptances],
  );

  const handleAcceptRiskConfirm = async () => {
    if (!riskAcceptItems || !onAcceptRisk || riskJustification.trim().length < 10) return;
    // When scope is 'global', drop hostname so the persisted record is unambiguously
    // org-wide. Storing both fields confused readers that didn't honor `scope`.
    const itemsWithScope = riskAcceptItems.map(item => ({
      ...item,
      scope: riskScope,
      hostname: riskScope === 'host' ? item.hostname : undefined,
    }));
    await onAcceptRisk(itemsWithScope, riskJustification.trim());
    setRiskAcceptItems(null);
    setRiskJustification('');
    setRiskScope('global');
  };

  const handleRevokeConfirm = async () => {
    if (!revokeTarget || !onRevokeRisk || revokeReason.trim().length < 10) return;
    await onRevokeRisk(revokeTarget.id, revokeReason.trim());
    setRevokeTarget(null);
    setRevokeReason('');
  };

  const dialogs = (
    <>
      {/* Confirmation Dialog (individual + bulk archive) */}
      {confirmArchiveKeys && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70" onClick={() => !archiving && setConfirmArchiveKeys(null)}>
          <div className="mx-4 w-full max-w-md rounded-[10px] border border-border-strong bg-surface p-6 shadow-[0_24px_60px_rgba(0,0,0,0.55)]" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold tracking-tight">Archive Executions</h3>
              <button onClick={() => !archiving && setConfirmArchiveKeys(null)} className="text-muted hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="mb-6 text-sm text-muted">
              This will move <span className="font-medium text-foreground">{confirmArchiveKeys.length}</span> execution group{confirmArchiveKeys.length !== 1 ? 's' : ''} to the archive. This is reversible.
            </p>
            <div className="flex justify-end gap-3">
              <Button variant="ghost" onClick={() => setConfirmArchiveKeys(null)} disabled={archiving}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={handleArchiveConfirm} disabled={archiving}>
                {archiving && <Loader2 className="animate-spin" />}
                Archive
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Risk Acceptance Dialog */}
      {riskAcceptItems && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70" onClick={() => !acceptingRisk && setRiskAcceptItems(null)}>
          <div className="mx-4 w-full max-w-md rounded-[10px] border border-border-strong bg-surface p-6 shadow-[0_24px_60px_rgba(0,0,0,0.55)]" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
                <ShieldOff className="h-5 w-5 text-warning" />
                Accept Risk
              </h3>
              <button onClick={() => !acceptingRisk && setRiskAcceptItems(null)} className="text-muted hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="mb-3 text-sm text-muted">
              Accepting risk for <span className="font-medium text-foreground">{riskAcceptItems.length}</span> control{riskAcceptItems.length !== 1 ? 's' : ''}.
              Accepted controls will be excluded from the Defense Score.
            </p>
            <div className="mb-4 max-h-32 overflow-y-auto rounded-md border border-border bg-raised p-2 font-mono text-xs">
              {riskAcceptItems.slice(0, 10).map((item, i) => (
                <div key={i} className="truncate text-muted">
                  {item.test_name}{item.control_id ? `::${item.control_id}` : ''}
                </div>
              ))}
              {riskAcceptItems.length > 10 && (
                <div className="text-muted">...and {riskAcceptItems.length - 10} more</div>
              )}
            </div>
            <div className="mb-4">
              <label className="mb-1.5 block text-[11px] uppercase tracking-wider text-faint">Scope</label>
              <div className="flex overflow-hidden rounded-md border border-border">
                <button
                  type="button"
                  onClick={() => setRiskScope('global')}
                  className={`flex-1 px-3 py-1.5 text-sm transition-colors ${riskScope === 'global' ? 'bg-warning-dim text-warning' : 'bg-transparent text-muted hover:bg-raised'}`}
                >
                  All Hosts
                </button>
                <button
                  type="button"
                  onClick={() => setRiskScope('host')}
                  className={`flex-1 border-l border-border px-3 py-1.5 text-sm transition-colors ${riskScope === 'host' ? 'bg-warning-dim text-warning' : 'bg-transparent text-muted hover:bg-raised'}`}
                >
                  This Host Only
                </button>
              </div>
              <p className="mt-1 text-xs text-faint">
                {riskScope === 'global'
                  ? 'Excluded from Defense Score across all hosts in the organization.'
                  : 'Excluded from Defense Score only for the specific host(s) where it was observed.'}
              </p>
            </div>
            <div className="mb-4">
              <label className="mb-1.5 block text-[11px] uppercase tracking-wider text-faint">
                Justification <span className="text-danger">*</span>
              </label>
              <textarea
                value={riskJustification}
                onChange={(e) => setRiskJustification(e.target.value)}
                placeholder="Describe why this risk is being accepted (min 10 characters)..."
                rows={3}
                className="w-full resize-none rounded-md border border-border bg-raised px-3 py-2 text-sm placeholder:text-faint outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
              />
              {riskJustification.length > 0 && riskJustification.trim().length < 10 && (
                <p className="mt-1 text-xs text-danger">Minimum 10 characters required</p>
              )}
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="ghost" onClick={() => { setRiskAcceptItems(null); setRiskJustification(''); }} disabled={acceptingRisk}>
                Cancel
              </Button>
              <Button
                variant="outline"
                className="border-warning/40 text-warning hover:bg-warning-dim"
                onClick={handleAcceptRiskConfirm}
                disabled={acceptingRisk || riskJustification.trim().length < 10}
              >
                {acceptingRisk && <Loader2 className="animate-spin" />}
                Accept Risk
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Revoke Risk Acceptance Dialog */}
      {revokeTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70" onClick={() => !acceptingRisk && setRevokeTarget(null)}>
          <div className="mx-4 w-full max-w-md rounded-[10px] border border-border-strong bg-surface p-6 shadow-[0_24px_60px_rgba(0,0,0,0.55)]" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
                <ShieldAlert className="h-5 w-5 text-warning" />
                Revoke Risk Acceptance
              </h3>
              <button onClick={() => !acceptingRisk && setRevokeTarget(null)} className="text-muted hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="mb-3 text-sm text-muted">
              Revoking acceptance for <span className="font-medium text-foreground">{revokeTarget.testName}</span>.
              This control will be included in the Defense Score again.
            </p>
            <div className="mb-4">
              <label className="mb-1.5 block text-[11px] uppercase tracking-wider text-faint">
                Reason <span className="text-danger">*</span>
              </label>
              <textarea
                value={revokeReason}
                onChange={(e) => setRevokeReason(e.target.value)}
                placeholder="Describe why this acceptance is being revoked (min 10 characters)..."
                rows={3}
                className="w-full resize-none rounded-md border border-border bg-raised px-3 py-2 text-sm placeholder:text-faint outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
              />
              {revokeReason.length > 0 && revokeReason.trim().length < 10 && (
                <p className="mt-1 text-xs text-danger">Minimum 10 characters required</p>
              )}
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="ghost" onClick={() => { setRevokeTarget(null); setRevokeReason(''); }} disabled={acceptingRisk}>
                Cancel
              </Button>
              <Button
                variant="outline"
                className="border-warning/40 text-warning hover:bg-warning-dim"
                onClick={handleRevokeConfirm}
                disabled={acceptingRisk || revokeReason.trim().length < 10}
              >
                {acceptingRisk && <Loader2 className="animate-spin" />}
                Revoke Acceptance
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Test Info Modal */}
      {infoModal && (
        <TestInfoModal
          open={infoModal.open}
          onClose={() => setInfoModal(null)}
          testUuid={infoModal.testUuid}
          testName={infoModal.testName}
          hasInfoCard={infoModal.hasInfoCard}
          hasReadme={infoModal.hasReadme}
          scrollToValidator={infoModal.scrollToValidator}
        />
      )}
    </>
  );

  return {
    panelProps: {
      getAcceptanceForExec,
      riskEnabled,
      archiveEnabled,
      onRequestAcceptRisk: setRiskAcceptItems,
      onRequestRevoke: setRevokeTarget,
      onRequestArchive: setConfirmArchiveKeys,
      onOpenInfo: (request) => setInfoModal({ ...request, open: true }),
    },
    dialogs,
    requestAcceptRisk: setRiskAcceptItems,
    requestArchive: setConfirmArchiveKeys,
  };
}
