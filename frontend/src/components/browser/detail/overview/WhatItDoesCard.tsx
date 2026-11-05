import TechniqueBadge from '@/components/browser/TechniqueBadge';

export default function WhatItDoesCard({ techniques }: { techniques: string[] }) {
  if (techniques.length === 0) return null;
  return (
    <section>
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">What it does</h2>
      <div className="flex flex-wrap gap-1.5">
        {techniques.map((t) => <TechniqueBadge key={t} technique={t} size="sm" />)}
      </div>
    </section>
  );
}
