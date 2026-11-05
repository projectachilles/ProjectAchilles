import { useState } from 'react';

/**
 * Cyber-hygiene bundles: one collapsed group per validator. Control rows
 * arrive with fleet data (a later PR); for now a group shows its description.
 */
export default function ControlGrid({ validators }: { validators: Record<string, string> }) {
  const names = Object.keys(validators);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  if (names.length === 0) return null;
  return (
    <section>
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">Validators</h2>
      <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
        {names.map((name) => {
          const expanded = !!open[name];
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
              {expanded && <p className="px-3 pb-3 text-[13px] leading-snug text-muted">{validators[name]}</p>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
