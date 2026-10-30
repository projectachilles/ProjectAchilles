import type { CSSProperties } from 'react';
import { cn } from '@/lib/utils';
import { useConsoleIdentity } from '@/hooks/useConsoleIdentity';
import { IDENTITY_CHIP_TEXT, identityHex } from '@/lib/identityColors';
import type { IdentityColor } from '@/types/consoleIdentity';

function identityVars(color: IdentityColor): CSSProperties {
  const hex = identityHex(color);
  return (hex ? { '--identity': hex } : {}) as CSSProperties;
}

const tint = (pct: number) => `color-mix(in srgb, var(--identity) ${pct}%, var(--color-surface))`;

export function IdentityChip({
  code,
  color,
  className,
}: {
  code: string;
  color: IdentityColor;
  className?: string;
}) {
  const hex = identityHex(color);
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded px-1.5 py-0.5 font-mono text-xs font-bold leading-none tracking-wide print:hidden',
        !hex && 'border border-border bg-raised text-foreground',
        className,
      )}
      style={hex ? { backgroundColor: hex, color: IDENTITY_CHIP_TEXT } : undefined}
    >
      {code}
    </span>
  );
}

export function IdentityPlate() {
  const { identity, active } = useConsoleIdentity();
  if (!active || !identity?.code) return null;
  const hex = identityHex(identity.color);
  const style = hex
    ? ({
        ...identityVars(identity.color),
        backgroundColor: tint(9),
        borderColor: tint(28),
        borderLeftColor: 'var(--identity)',
      } as CSSProperties)
    : undefined;
  return (
    <div className="border-b border-border px-3 py-3 print:hidden">
      <div
        className={cn(
          'flex min-w-0 flex-col gap-1.5 rounded-md border border-l-[3px] px-3 py-2',
          !hex && 'border-border bg-raised',
        )}
        style={style}
      >
        <IdentityChip code={identity.code} color={identity.color} className="self-start" />
        {identity.name && (
          <span className="line-clamp-2 break-words text-xs text-muted" title={identity.name}>
            {identity.name}
          </span>
        )}
      </div>
    </div>
  );
}

export function IdentityRibbon() {
  const { identity, active } = useConsoleIdentity();
  const hex = identity ? identityHex(identity.color) : null;
  if (!active || !hex) return null;
  return (
    <div
      aria-hidden="true"
      className="fixed inset-x-0 top-0 z-50 h-[3px] print:hidden"
      style={{ backgroundColor: hex }}
    />
  );
}

export function IdentityPill() {
  const { identity, active } = useConsoleIdentity();
  if (!active || !identity?.code) return null;
  const hex = identityHex(identity.color);
  const style = hex
    ? ({
        ...identityVars(identity.color),
        borderColor: tint(35),
        backgroundColor: tint(8),
      } as CSSProperties)
    : undefined;
  return (
    <span
      className={cn(
        'inline-flex min-w-0 max-w-full items-center gap-2 rounded-full border py-1 pl-1 pr-3 print:hidden',
        !hex && 'border-border bg-raised',
      )}
      style={style}
    >
      <IdentityChip code={identity.code} color={identity.color} />
      {identity.name && (
        <span className="truncate text-xs text-muted" title={identity.name}>
          {identity.name}
        </span>
      )}
    </span>
  );
}

export function IdentityChipFromContext({ className }: { className?: string }) {
  const { identity, active } = useConsoleIdentity();
  if (!active || !identity?.code) return null;
  return <IdentityChip code={identity.code} color={identity.color} className={className} />;
}
