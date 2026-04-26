import { Link } from 'react-router-dom';
import { Icon, I } from '@/components/layout/AchillesShell';

interface Item { uuid: string; name: string; severity: string; score: number }
interface TopRatedProps { items: Item[] }

export function TopRated({ items }: TopRatedProps) {
  return (
    <div className="dash-card">
      <div className="dash-card-head">
        <div className="dash-card-title">
          <Icon size={12}>{I.star}</Icon>
          Top Rated
        </div>
        <div className="mono-label">last 30d</div>
      </div>
      {items.length === 0 ? (
        <div className="v1-empty">No scored tests yet</div>
      ) : (
        items.map((t, i) => (
          <Link key={t.uuid} to={`/browser/test/${t.uuid}`} className="v1-test-row">
            <span className="v1-test-rank">{String(i + 1).padStart(2, '0')}</span>
            <span className="v1-test-name" title={t.name}>{t.name}</span>
            <span className={`sev-pill sev-bg-${t.severity}`}>{t.severity}</span>
            <span className="v1-test-score">{t.score.toFixed(1)}</span>
          </Link>
        ))
      )}
    </div>
  );
}
