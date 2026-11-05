import { useState } from 'react';
import type { TestFleetStage } from '@/services/api/analytics';

interface ControlGridProps {
  validators: Record<string, string>;
  /** Fleet rows (controls defined at run time); absent = descriptions only. */
  fleet?: TestFleetStage[];
}

const NO_VALIDATOR = '';

function ControlRow({ row }: { row: TestFleetStage }) {
  const pass = row.blocked + row.detected;
  return (
    <li className="flex items-start justify-between gap-3 px-3 py-2">
      <div className="min-w-0">
        <p className="font-mono text-xs text-foreground">{row.controlId}</p>
        {row.description && <p className="mt-0.5 text-[13px] leading-snug text-muted">{row.description}</p>}
      </div>
      <span className="shrink-0 text-[13px] text-muted">{`${pass} / ${row.hosts} hosts`}</span>
    </li>
  );
}

/**
 * Cyber-hygiene bundles: one collapsed group per validator, with control rows
 * (pass share across hosts) once fleet data exists.
 */
export default function ControlGrid({ validators, fleet = [] }: ControlGridProps) {
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const byValidator = new Map<string, TestFleetStage[]>();
  for (const row of fleet) {
    const key = row.validator ?? NO_VALIDATOR;
    byValidator.set(key, [...(byValidator.get(key) ?? []), row]);
  }
  const flat = byValidator.get(NO_VALIDATOR) ?? [];
  const names = [...new Set([...Object.keys(validators), ...[...byValidator.keys()].filter((k) => k !== NO_VALIDATOR)])];
  if (names.length === 0 && flat.length === 0) return null;

  return (
    <section>
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">Validators</h2>
      {flat.length > 0 && (
        <ul className="mb-2 divide-y divide-border rounded-lg border border-border bg-surface">
          {flat.map((r) => <ControlRow key={r.controlId} row={r} />)}
        </ul>
      )}
      {names.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
          {names.map((name) => {
            const rows = byValidator.get(name) ?? [];
            const expanded = open[name] ?? rows.length > 0;
            return (
              <li key={name}>
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => setOpen((o) => ({ ...o, [name]: !expanded }))}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[13px] font-medium text-foreground hover:bg-raised"
                >
                  <span className="min-w-0 break-words">{name}</span>
                  <span aria-hidden className="text-faint">{expanded ? '−' : '+'}</span>
                </button>
                {expanded && validators[name] && (
                  <p className="px-3 pb-3 text-[13px] leading-snug text-muted">{validators[name]}</p>
                )}
                {expanded && rows.length > 0 && (
                  <ul className="divide-y divide-border border-t border-border">
                    {rows.map((r) => <ControlRow key={r.controlId} row={r} />)}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
