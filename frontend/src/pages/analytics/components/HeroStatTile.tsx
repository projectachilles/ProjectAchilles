import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
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
  /**
   * Custom visualization rendered in place of the sparkline. When provided
   * the sparkline is skipped — used for tiles whose data is naturally
   * categorical (e.g., per-technique coverage pips) rather than a time series.
   */
  chartSlot?: ReactNode;
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
    chartSlot,
    loading,
    error,
    href,
    onClick,
    emptyState,
  } = props;

  if (loading) {
    return (
      <Card className="h-full flex flex-col p-0 overflow-hidden">
        <div className="flex items-center gap-2 px-4 pt-4 pb-1 min-w-0">
          {icon}
          <span className="text-sm font-medium truncate text-muted-foreground">{title}</span>
        </div>
        <div className="flex flex-col px-4 pt-2 pb-2 gap-2">
          <Skeleton className="h-14 w-32" />
          <Skeleton className="h-3 w-32" />
        </div>
        <div className="flex-1" />
        <div className="px-4 pt-1 min-h-[36px] flex items-center">
          <Skeleton className="h-4 w-full" />
        </div>
        <div className="px-4 pb-3 pt-1 min-h-[28px]">
          <Skeleton className="h-3 w-20" />
        </div>
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

      {/* Value section — top-anchored so the main number sits at the same
          Y-position regardless of whether the tile has a sparkline, pip
          chart, or delta row below it. */}
      <div className="flex flex-col px-4 pt-2 pb-2 gap-1">
        {emptyState ? (
          <div className="text-sm text-muted-foreground">{emptyState}</div>
        ) : (
          <>
            <div className="flex items-baseline gap-1">
              <span className="text-[3.1875rem] leading-tight font-bold tabular-nums">{value}</span>
              {valueSuffix && (
                <span className="text-3xl text-muted-foreground">{valueSuffix}</span>
              )}
            </div>
            {subValue && (
              <div className="text-xs text-muted-foreground leading-relaxed">{subValue}</div>
            )}
          </>
        )}
      </div>

      {/* Spacer — absorbs any extra height from the equal-height grid
          stretching so chart + delta hug the bottom edge. */}
      <div className="flex-1" />

      {/* Chart area — min-h reserved so a short pip row and a 32px-tall
          sparkline occupy the same vertical real estate. Color class only
          applied for sparklines (chartSlot consumers carry their own colors). */}
      <div
        className={`px-4 pt-1 flex items-center min-h-[36px] ${
          !chartSlot && sparklineData && sparklineData.length >= 2 ? sparklineClass : ''
        }`}
      >
        {chartSlot ? (
          chartSlot
        ) : sparklineData && sparklineData.length >= 2 ? (
          <Sparkline data={sparklineData} width={240} height={32} ariaLabel={`${title} trend`} />
        ) : null}
      </div>

      {/* Delta row — always reserves its height even when no delta is shown,
          so the chart area lands at the same Y-position across all tiles. */}
      <div className="px-4 pb-3 pt-1 flex items-center gap-1 text-xs min-h-[28px]">
        {typeof delta === 'number' && (
          <>
            <span
              className={`inline-flex items-center gap-0.5 font-medium ${deltaToneClass(deltaTone, delta)}`}
            >
              <DeltaIcon delta={delta} />
              {formatDelta(delta)}
            </span>
            {deltaLabel && <span className="text-muted-foreground">{deltaLabel}</span>}
          </>
        )}
      </div>
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
