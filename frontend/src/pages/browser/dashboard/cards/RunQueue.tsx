import { Icon, I } from '@/components/layout/AchillesShell';

interface QueueItem { id: string; name: string; severity: string; progress: number | null; status: string }
interface RunQueueProps { items: QueueItem[] }

export function RunQueue({ items }: RunQueueProps) {
  const inProgress = items.filter((q) => q.progress != null && q.progress > 0).length;

  return (
    <div className="dash-card">
      <div className="dash-card-head">
        <div className="dash-card-title">
          <Icon size={12}>{I.play}</Icon>
          Run Queue
        </div>
        <div className="mono-label">{inProgress} in progress</div>
      </div>
      {items.length === 0 ? (
        <div className="v1-empty">Queue empty</div>
      ) : (
        items.map((q, i) => (
          <div key={q.id} className="v1-test-row" style={{ gap: 8, cursor: 'default' }}>
            <span className="v1-test-rank">{String(i + 1).padStart(2, '0')}</span>
            <span className="v1-test-name" title={q.name}>{q.name}</span>
            <div
              style={{
                width: 50,
                height: 4,
                background: 'rgba(255,255,255,.06)',
                borderRadius: 2,
                overflow: 'hidden',
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  width: `${q.progress ?? 0}%`,
                  height: '100%',
                  background: q.progress ? 'var(--accent)' : 'transparent',
                }}
              />
            </div>
            <span className="v1-test-when" style={{ minWidth: 36, textAlign: 'right' }}>
              {q.progress != null && q.progress > 0 ? `${Math.round(q.progress)}%` : q.status}
            </span>
          </div>
        ))
      )}
    </div>
  );
}
