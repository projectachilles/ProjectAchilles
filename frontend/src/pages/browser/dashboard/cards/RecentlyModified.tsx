import { Link } from 'react-router-dom';
import { Icon, I } from '@/components/layout/AchillesShell';

interface Item { uuid: string; name: string; severity: string; when: string }
interface RecentlyModifiedProps { items: Item[] }

export function RecentlyModified({ items }: RecentlyModifiedProps) {
  return (
    <div className="dash-card">
      <div className="dash-card-head">
        <div className="dash-card-title">
          <Icon size={12}>{I.clock}</Icon>
          Recently Modified
        </div>
        <div className="mono-label">last 7d</div>
      </div>
      {items.length === 0 ? (
        <div className="v1-empty">No modifications recorded</div>
      ) : (
        items.map((t) => (
          <Link key={t.uuid} to={`/browser/test/${t.uuid}`} className="v1-test-row">
            <span className="v1-test-rank">›</span>
            <span className="v1-test-name" title={t.name}>{t.name}</span>
            <span className={`sev-pill sev-bg-${t.severity}`}>{t.severity}</span>
            <span className="v1-test-when">{t.when}</span>
          </Link>
        ))
      )}
    </div>
  );
}
