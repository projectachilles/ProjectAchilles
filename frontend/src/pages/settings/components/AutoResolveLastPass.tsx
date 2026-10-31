import { Alert } from '@/components/shared/ui/Alert';

/** The last auto-resolve pass as each EDR's status endpoint returns it (`lastAutoResolve`). */
export interface AutoResolveLastPassResult {
  mode: string;
  candidates: number;
  patched?: number;
  wouldPatch?: number;
  errors: string[];
}

/**
 * Shown on an auto-resolve card when the last pass reported errors, so a
 * refusal (for example the EDR answering 403 because the API user's role
 * can't change alert status) is visible here instead of only as a count in
 * the backend log. Renders nothing when the last pass was clean.
 */
export function AutoResolveLastPass({ last }: { last: AutoResolveLastPassResult | null | undefined }) {
  if (!last || last.errors.length === 0) return null;
  const n = last.errors.length;
  const outcome = last.mode === 'dry_run'
    ? `${last.wouldPatch ?? 0} would be resolved`
    : `${last.patched ?? 0} resolved`;
  return (
    <Alert variant="warning" title={`Last pass: ${n} error${n === 1 ? '' : 's'}`}>
      <p className="text-sm">
        {last.candidates} matched alert{last.candidates === 1 ? '' : 's'}, {outcome}.
      </p>
      <p className="mt-1 break-words font-mono text-xs">{last.errors[0]}</p>
      {n > 1 && <p className="mt-1 text-xs">+{n - 1} more in the backend log.</p>}
    </Alert>
  );
}
