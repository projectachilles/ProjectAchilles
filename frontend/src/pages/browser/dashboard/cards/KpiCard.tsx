import type { ReactNode } from 'react';
import { Icon, Sparkline } from '@/components/layout/AchillesShell';

interface KpiCardProps {
  icon: ReactNode;
  label: string;
  value: string | number;
  trend?: string;
  foot?: string;
  sparkData: number[];
  sparkColor?: string;
}

export function KpiCard({
  icon,
  label,
  value,
  trend,
  foot,
  sparkData,
  sparkColor = 'var(--accent)',
}: KpiCardProps) {
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
      <div className="v1-kpi-foot">
        <span>{foot}</span>
        <Sparkline data={sparkData} color={sparkColor} width={80} height={22} />
      </div>
    </div>
  );
}
