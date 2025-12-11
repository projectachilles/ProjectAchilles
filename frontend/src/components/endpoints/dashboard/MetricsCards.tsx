/**
 * Dashboard Metrics Cards Component
 * Displays key metrics: Sleep Mode, Online Status, OS Distribution, Payloads
 */

import { Moon, Package, Zap } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { Card, CardContent } from '../../shared/ui/Card';

// Platform IDs from LimaCharlie
const PlatformID = {
  WINDOWS: 268435456,
  MACOS: 805306368,
  LINUX: 536870912,
};

// Platform colors matching the app design
const PLATFORM_COLORS = {
  Windows: '#3b82f6', // blue-500
  Linux: '#f97316', // orange-500
  macOS: '#6b7280', // gray-500
  Other: '#8b5cf6', // violet-500
};

interface MetricsCardsProps {
  totalSensors: number;
  onlineSensors: number;
  sleeperSensors: number;
  osPlatforms: { name: string; value: number }[];
  totalPayloads: number;
  loading?: boolean;
}

interface MetricCardProps {
  title: string;
  value: number | string;
  subtitle?: string;
  icon: React.ReactNode;
  iconColor?: string;
  loading?: boolean;
}

// Skeleton loader for cards
function MetricSkeleton() {
  return (
    <Card className="h-[140px]">
      <CardContent className="pt-5">
        <div className="animate-pulse">
          <div className="h-4 bg-muted rounded w-24 mb-3" />
          <div className="h-8 bg-muted rounded w-16 mb-2" />
          <div className="h-3 bg-muted rounded w-20" />
        </div>
      </CardContent>
    </Card>
  );
}

// Generic metric card
function MetricCard({ title, value, subtitle, icon, iconColor = 'text-primary', loading }: MetricCardProps) {
  if (loading) return <MetricSkeleton />;

  return (
    <Card className="h-[140px] hover:border-primary/20 transition-colors">
      <CardContent className="pt-5">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <p className="text-sm font-medium text-muted-foreground mb-1">{title}</p>
            <p className="text-3xl font-bold tracking-tight">{value.toLocaleString()}</p>
            {subtitle && (
              <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
            )}
          </div>
          <div className={`p-2.5 rounded-lg bg-muted/50 ${iconColor}`}>
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// Sleep mode card with ring gauge
function SleepModeCard({ sleepers, total, loading }: { sleepers: number; total: number; loading?: boolean }) {
  if (loading) return <MetricSkeleton />;

  const percentage = total > 0 ? Math.round((sleepers / total) * 100) : 0;
  const awake = total - sleepers;

  // Ring gauge data
  const gaugeData = [
    { name: 'sleeping', value: sleepers },
    { name: 'awake', value: awake },
  ];

  return (
    <Card className="h-[140px] hover:border-primary/20 transition-colors">
      <CardContent className="pt-5">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <p className="text-sm font-medium text-muted-foreground mb-1">Sleep Mode</p>
            <p className="text-3xl font-bold tracking-tight">
              <span className="text-amber-500">{sleepers.toLocaleString()}</span>
              <span className="text-muted-foreground text-xl font-normal">/{total.toLocaleString()}</span>
            </p>
            <p className="text-xs text-muted-foreground mt-1">{percentage}% sleeping</p>
          </div>
          <div className="w-14 h-14 relative">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={gaugeData}
                  cx="50%"
                  cy="50%"
                  innerRadius={18}
                  outerRadius={26}
                  startAngle={90}
                  endAngle={-270}
                  paddingAngle={0}
                  dataKey="value"
                  stroke="none"
                >
                  <Cell fill="#f59e0b" />
                  <Cell fill="var(--color-muted)" opacity={0.3} />
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex items-center justify-center">
              <Moon className="w-4 h-4 text-amber-500" />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// Online status card with ring gauge
function OnlineStatusCard({ online, total, loading }: { online: number; total: number; loading?: boolean }) {
  if (loading) return <MetricSkeleton />;

  const percentage = total > 0 ? Math.round((online / total) * 100) : 0;

  // Ring gauge data
  const gaugeData = [
    { name: 'online', value: online },
    { name: 'offline', value: total - online },
  ];

  return (
    <Card className="h-[140px] hover:border-primary/20 transition-colors">
      <CardContent className="pt-5">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <p className="text-sm font-medium text-muted-foreground mb-1">Online Status</p>
            <p className="text-3xl font-bold tracking-tight">
              <span className="text-success">{online.toLocaleString()}</span>
              <span className="text-muted-foreground text-xl font-normal">/{total.toLocaleString()}</span>
            </p>
            <p className="text-xs text-muted-foreground mt-1">{percentage}% online</p>
          </div>
          <div className="w-14 h-14 relative">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={gaugeData}
                  cx="50%"
                  cy="50%"
                  innerRadius={18}
                  outerRadius={26}
                  startAngle={90}
                  endAngle={-270}
                  paddingAngle={0}
                  dataKey="value"
                  stroke="none"
                >
                  <Cell fill="var(--color-success)" />
                  <Cell fill="var(--color-muted)" opacity={0.3} />
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex items-center justify-center">
              <Zap className="w-4 h-4 text-success" />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// OS Distribution card with donut chart
function OSDistributionCard({ platforms, loading }: { platforms: { name: string; value: number }[]; loading?: boolean }) {
  if (loading) return <MetricSkeleton />;

  // Sort platforms by count and take top 3
  const sortedPlatforms = [...platforms].sort((a, b) => b.value - a.value);
  const displayPlatforms = sortedPlatforms.slice(0, 3);

  return (
    <Card className="h-[140px] hover:border-primary/20 transition-colors">
      <CardContent className="pt-5">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <p className="text-sm font-medium text-muted-foreground mb-2">OS Distribution</p>
            <div className="space-y-1">
              {displayPlatforms.map((platform) => (
                <div key={platform.name} className="flex items-center gap-2 text-xs">
                  <div
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: PLATFORM_COLORS[platform.name as keyof typeof PLATFORM_COLORS] || PLATFORM_COLORS.Other }}
                  />
                  <span className="text-muted-foreground">{platform.name}</span>
                  <span className="font-medium">{platform.value.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="w-14 h-14">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={platforms}
                  cx="50%"
                  cy="50%"
                  innerRadius={16}
                  outerRadius={26}
                  paddingAngle={2}
                  dataKey="value"
                  stroke="none"
                >
                  {platforms.map((entry) => (
                    <Cell
                      key={entry.name}
                      fill={PLATFORM_COLORS[entry.name as keyof typeof PLATFORM_COLORS] || PLATFORM_COLORS.Other}
                    />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// Main MetricsCards component
export default function MetricsCards({
  totalSensors,
  onlineSensors,
  sleeperSensors,
  osPlatforms,
  totalPayloads,
  loading = false,
}: MetricsCardsProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      <SleepModeCard
        sleepers={sleeperSensors}
        total={totalSensors}
        loading={loading}
      />
      <OnlineStatusCard
        online={onlineSensors}
        total={totalSensors}
        loading={loading}
      />
      <OSDistributionCard
        platforms={osPlatforms}
        loading={loading}
      />
      <MetricCard
        title="Payloads Ready"
        value={totalPayloads}
        subtitle="available"
        icon={<Package className="w-5 h-5" />}
        iconColor="text-violet-500"
        loading={loading}
      />
    </div>
  );
}

// Export helper to process sensor data into OS distribution
export function processSensorPlatforms(sensors: Array<{ plat: number }>): { name: string; value: number }[] {
  const counts: Record<string, number> = {
    Windows: 0,
    Linux: 0,
    macOS: 0,
    Other: 0,
  };

  sensors.forEach((sensor) => {
    switch (sensor.plat) {
      case PlatformID.WINDOWS:
        counts.Windows++;
        break;
      case PlatformID.LINUX:
        counts.Linux++;
        break;
      case PlatformID.MACOS:
        counts.macOS++;
        break;
      default:
        counts.Other++;
        break;
    }
  });

  // Convert to array and filter out zeros
  return Object.entries(counts)
    .filter(([, value]) => value > 0)
    .map(([name, value]) => ({ name, value }));
}
