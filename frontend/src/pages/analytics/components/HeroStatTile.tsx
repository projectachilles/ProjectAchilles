import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, AlertCircle, ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react';
import { Card } from '@/components/ui/card';
import Sparkline from './Sparkline';

export type DeltaTone = 'positive' | 'negative' | 'neutral';

interface HeroStatTileProps {
  title: string;
  icon?: ReactNode;
  value: string | number;
  valueSuffix?: string;
  subValue?: ReactNode;
  delta?: number;
  deltaLabel?: string;
  deltaTone?: DeltaTone;
  sparklineData?: number[];
  sparklineClass?: string;
  loading?: boolean;
  error?: string;
  href?: string;
  onClick?: () => void;
  emptyState?: ReactNode;
}

function formatDelta(delta: number): string {
  const abs = Math.abs(delta);
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : '';
  if (abs >= 100) return `${sign}${abs.toFixed(0)}`;
  if (abs >= 10) return `${sign}${abs.toFixed(1)}`;
  return `${sign}${abs.toFixed(2)}`;
}

function deltaToneClass(tone: DeltaTone | undefined, delta: number): string {
  if (tone === 'positive') return 'text-emerald-500';
  if (tone === 'negative') return 'text-red-500';
  if (tone === 'neutral') return 'text-muted-foreground';
  if (delta > 0) return 'text-emerald-500';
  if (delta < 0) return 'text-red-500';
  return 'text-muted-foreground';
}

function DeltaIcon({ delta }: { delta: number }) {
  if (delta > 0) return <ArrowUpRight className="w-3 h-3" />;
  if (delta < 0) return <ArrowDownRight className="w-3 h-3" />;
  return <Minus className="w-3 h-3" />;
}

export default function HeroStatTile(props: HeroStatTileProps) {
  const {
    title,
    icon,
    value,
    valueSuffix,
    subValue,
    delta,
    deltaLabel,
    deltaTone,
    sparklineData,
    sparklineClass = 'text-primary',
    loading,
    error,
    href,
    onClick,
    emptyState,
  } = props;

  if (loading) {
    return (
      <Card className="h-full flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="h-full flex flex-col items-center justify-center text-center p-4 gap-2">
        <AlertCircle className="w-6 h-6 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">{error}</span>
      </Card>
    );
  }

  const tile = (
    <Card className="h-full flex flex-col p-0 overflow-hidden hover:border-primary/50 transition-colors">
      <div className="flex items-center justify-between px-4 pt-4 pb-1">
        <div className="flex items-center gap-2 min-w-0">
          {icon}
          <span className="text-sm font-medium truncate">{title}</span>
        </div>
      </div>

      <div className="flex-1 flex flex-col justify-center px-4 py-2 gap-1">
        {emptyState ? (
          <div className="text-sm text-muted-foreground">{emptyState}</div>
        ) : (
          <>
            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-bold tabular-nums">{value}</span>
              {valueSuffix && (
                <span className="text-lg text-muted-foreground">{valueSuffix}</span>
              )}
            </div>
            {subValue && (
              <div className="text-xs text-muted-foreground leading-relaxed">{subValue}</div>
            )}
          </>
        )}
      </div>

      {sparklineData && sparklineData.length >= 2 && (
        <div className={`px-4 ${sparklineClass}`}>
          <Sparkline data={sparklineData} width={240} height={32} ariaLabel={`${title} trend`} />
        </div>
      )}

      {typeof delta === 'number' && (
        <div className="px-4 pb-3 pt-1 flex items-center gap-1 text-xs">
          <span className={`inline-flex items-center gap-0.5 font-medium ${deltaToneClass(deltaTone, delta)}`}>
            <DeltaIcon delta={delta} />
            {formatDelta(delta)}
          </span>
          {deltaLabel && <span className="text-muted-foreground">{deltaLabel}</span>}
        </div>
      )}
    </Card>
  );

  if (href) {
    return (
      <Link to={href} className="block h-full">
        {tile}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="block h-full w-full text-left appearance-none bg-transparent border-0 p-0 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-base"
      >
        {tile}
      </button>
    );
  }
  return tile;
}
