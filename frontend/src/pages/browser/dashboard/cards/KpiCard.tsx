import type { ReactNode } from 'react';
import { Icon } from '@/components/layout/AchillesShell';

interface KpiCardProps {
  icon: ReactNode;
  label: string;
  value: string | number;
  /** Right-aligned tag in the head row — e.g. a unit, "+5", or a delta. */
  trend?: string;
  /** Foot text under the big number — short caption explaining the value. */
  foot?: string;
}

export function KpiCard({ icon, label, value, trend, foot }: KpiCardProps) {
  return (
    <div className="v1-kpi">
      <div className="v1-kpi-head">
        <div className="v1-kpi-label">
          <span className="iconbox">
            <Icon size={12}>{icon}</Icon>
          </span>
          <span>{label}</span>
        </div>
        {trend && <div className="v1-kpi-trend">{trend}</div>}
      </div>
      <div className="v1-kpi-value">{value}</div>
      {foot && <div className="v1-kpi-foot">{foot}</div>}
    </div>
  );
}
