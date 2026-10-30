import { useEffect, useRef, useState } from 'react';
import { FingerprintPattern } from 'lucide-react';
import { Alert } from '@/components/shared/ui/Alert';
import { Button } from '@/components/shared/ui/Button';
import { Card } from '@/components/shared/ui/Card';
import { fieldControlClass, fieldHelpClass, fieldLabelClass } from '@/components/shared/ui/formStyles';
import { IdentityChip } from '@/components/layout/ConsoleIdentity';
import { WORDMARK } from '@/lib/brand';
import { cn } from '@/lib/utils';
import { useConsoleIdentity } from '@/hooks/useConsoleIdentity';
import { consoleIdentityApi } from '@/services/api/consoleIdentity';
import { faviconDataUrl } from '@/lib/consoleIdentityDocument';
import { IDENTITY_PALETTE, identityHex } from '@/lib/identityColors';
import { IDENTITY_COLORS } from '@/types/consoleIdentity';
import type { IdentityColor } from '@/types/consoleIdentity';

const NAME_MAX = 80;
const CODE_MAX = 6;

const sanitizeCode = (value: string) =>
  value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_MAX);

const SWATCHES: Array<{ key: IdentityColor; label: string; hex: string | null }> = [
  { key: 'none', label: 'None', hex: null },
  ...IDENTITY_COLORS.map((key) => ({ key, label: IDENTITY_PALETTE[key].label, hex: IDENTITY_PALETTE[key].hex })),
];

export function ConsoleIdentityCard() {
  const { identity, setIdentity } = useConsoleIdentity();
  const [code, setCode] = useState(identity?.code ?? '');
  const [name, setName] = useState(identity?.name ?? '');
  const [color, setColor] = useState<IdentityColor>(identity?.color ?? 'none');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Last values loaded from or saved to the server. A background refresh only
  // re-prefills the form while it still equals this baseline (no unsaved edits).
  const baseline = useRef({ code: code, name: name, color: color });
  const form = useRef({ code, name, color });
  form.current = { code, name, color };

  const applyServer = (next: { code: string | null; name: string | null; color: IdentityColor } | null) => {
    const values = { code: next?.code ?? '', name: next?.name ?? '', color: next?.color ?? 'none' };
    baseline.current = values;
    setCode(values.code);
    setName(values.name);
    setColor(values.color);
  };

  useEffect(() => {
    const prev = baseline.current;
    const cur = form.current;
    const clean = cur.code === prev.code && cur.name === prev.name && cur.color === prev.color;
    if (clean) applyServer(identity);
    else
      baseline.current = {
        code: identity?.code ?? '',
        name: identity?.name ?? '',
        color: identity?.color ?? 'none',
      };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity?.code, identity?.name, identity?.color]);

  const source = identity?.source ?? 'none';
  const fromEnv = source === 'env' && identity?.code != null;
  const canSave = code.length >= 2 && !busy;
  const hex = identityHex(color);

  const run = async (action: () => Promise<Parameters<typeof setIdentity>[0]>, done: string) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const next = await action();
      setIdentity(next);
      applyServer(next);
      setMessage(done);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save console identity');
    } finally {
      setBusy(false);
    }
  };

  const handleSave = () =>
    run(
      () => consoleIdentityApi.save({ code, name: name.trim() === '' ? null : name.trim(), color }),
      'Console identity saved',
    );
  const handleReset = () => run(() => consoleIdentityApi.reset(), 'Restored the environment values');

  return (
    <Card className="p-5">
      <div className="flex items-start gap-3">
        <FingerprintPattern className="mt-0.5 h-5 w-5 text-accent" />
        <div>
          <h3 className="text-sm font-semibold text-foreground">Console identity</h3>
          <p className="mt-1 text-xs text-muted">
            Tells you, and anyone else, which organization this console belongs to. Shown in the sidebar, page
            headers and the browser tab.
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-5">
        <div>
          <label htmlFor="identity-code" className={fieldLabelClass}>
            Code *
          </label>
          <div className="flex items-center gap-3">
            <input
              id="identity-code"
              className={cn(fieldControlClass, 'w-28 font-mono uppercase')}
              value={code}
              maxLength={CODE_MAX}
              autoComplete="off"
              onChange={(e) => setCode(sanitizeCode(e.target.value))}
            />
            {fromEnv && (
              <span className="rounded border border-border bg-raised px-1.5 py-0.5 text-[10px] text-muted">
                From environment
              </span>
            )}
          </div>
          <p className={fieldHelpClass}>2–6 letters or digits. Used in the browser tab and favicon.</p>
        </div>

        <div>
          <label htmlFor="identity-name" className={fieldLabelClass}>
            Full name
          </label>
          <input
            id="identity-name"
            className={cn(fieldControlClass, 'max-w-sm')}
            value={name}
            maxLength={NAME_MAX}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div>
          <span id="identity-colour-label" className={fieldLabelClass}>
            Colour
          </span>
          <div role="radiogroup" aria-labelledby="identity-colour-label" className="flex flex-wrap gap-2">
            {SWATCHES.map((s) => (
              <button
                key={s.key}
                type="button"
                role="radio"
                aria-checked={color === s.key}
                aria-label={s.label}
                title={s.label}
                onClick={() => setColor(s.key)}
                className={cn(
                  'h-6 w-6 rounded-md border border-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                  s.hex == null && 'bg-[repeating-linear-gradient(45deg,var(--color-border)_0_4px,var(--color-raised)_4px_8px)]',
                  color === s.key && 'outline-2 outline-offset-2 outline-foreground',
                )}
                style={s.hex ? { backgroundColor: s.hex } : undefined}
              />
            ))}
          </div>
          <p className={fieldHelpClass}>
            Green, amber and red are left out: they mean Protected, warning and Unprotected elsewhere.
          </p>
        </div>

        <div>
          <span className={fieldLabelClass}>Preview</span>
          <div className="flex flex-wrap items-center gap-3">
            {code.length >= 2 ? (
              <>
                <img src={faviconDataUrl(code, hex)} alt="" className="h-[18px] w-[18px] rounded-[3px]" />
                <span className="font-mono text-xs text-muted">{`[${code}] Settings · ${WORDMARK}`}</span>
                <span
                  data-testid="identity-preview-pill"
                  className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-raised py-0.5 pl-0.5 pr-2.5 text-xs text-muted"
                >
                  <IdentityChip code={code} color={color} />
                  {name.trim() && <span className="truncate">{name.trim()}</span>}
                </span>
              </>
            ) : (
              <span className="text-xs text-faint">Enter a code to preview.</span>
            )}
          </div>
        </div>
      </div>

      {error && (
        <Alert variant="destructive" className="mt-4">
          {error}
        </Alert>
      )}
      {message && !error && (
        <Alert variant="success" className="mt-4">
          {message}
        </Alert>
      )}

      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" onClick={handleReset} disabled={source !== 'saved' || busy}>
          Reset to environment
        </Button>
        <Button onClick={handleSave} disabled={!canSave}>
          Save
        </Button>
      </div>
    </Card>
  );
}
