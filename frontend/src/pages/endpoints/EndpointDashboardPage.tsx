/**
 * Dashboard Page - Home/Overview screen
 * ACHILLES - Endpoint Management
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Monitor, FileCode2, Activity, CheckCircle2, Building2 } from 'lucide-react';
import { useAppSelector } from '../../store';
import SharedLayout from '../../components/shared/Layout';
import { PageContainer, PageHeader } from '../../components/endpoints/Layout';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/shared/ui/Card';
import MetricsCards, { processSensorPlatforms } from '../../components/endpoints/dashboard/MetricsCards';
import { api } from '../../services/api/endpoints';

// Metrics state interface
interface DashboardMetrics {
  totalSensors: number;
  onlineSensors: number;
  sleeperSensors: number;
  osPlatforms: { name: string; value: number }[];
  totalPayloads: number;
}

export default function EndpointDashboardPage() {
  const navigate = useNavigate();
  const { isAuthenticated, currentOrg } = useAppSelector((state) => state.endpointAuth);
  const [metrics, setMetrics] = useState<DashboardMetrics>({
    totalSensors: 0,
    onlineSensors: 0,
    sleeperSensors: 0,
    osPlatforms: [],
    totalPayloads: 0,
  });
  const [metricsLoading, setMetricsLoading] = useState(true);

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/endpoints/login');
    }
  }, [isAuthenticated, navigate]);

  // Fetch dashboard metrics on mount
  useEffect(() => {
    const fetchMetrics = async () => {
      if (!isAuthenticated) return;

      setMetricsLoading(true);
      try {
        // Fetch sensors (with tags to count sleepers) and payloads in parallel
        const [sensorsResponse, payloadsResponse] = await Promise.all([
          api.listSensors({ withTags: true, limit: 10000 }),
          api.listPayloads(),
        ]);

        if (sensorsResponse.success && sensorsResponse.data) {
          const sensors = sensorsResponse.data.sensors || [];
          const onlineCount = sensors.filter((s: any) => s.is_online).length;
          const sleeperCount = sensors.filter((s: any) =>
            s.tags?.includes('lc:sleeper')
          ).length;
          const platforms = processSensorPlatforms(sensors);

          setMetrics((prev) => ({
            ...prev,
            totalSensors: sensorsResponse.data?.total || sensors.length,
            onlineSensors: onlineCount,
            sleeperSensors: sleeperCount,
            osPlatforms: platforms,
          }));
        }

        if (payloadsResponse.success && payloadsResponse.data) {
          setMetrics((prev) => ({
            ...prev,
            totalPayloads: payloadsResponse.data?.payloads?.length || 0,
          }));
        }
      } catch (error) {
        console.error('Failed to fetch dashboard metrics:', error);
      } finally {
        setMetricsLoading(false);
      }
    };

    fetchMetrics();
  }, [isAuthenticated]);

  const quickActions = [
    {
      title: 'Sensors',
      description: 'View and manage LimaCharlie sensors',
      icon: Monitor,
      path: '/endpoints/sensors',
      color: 'text-blue-500',
    },
    {
      title: 'Payloads',
      description: 'Upload and deploy payload files',
      icon: FileCode2,
      path: '/endpoints/payloads',
      color: 'text-purple-500',
    },
    {
      title: 'Events',
      description: 'Query events using LCQL',
      icon: Activity,
      path: '/endpoints/events',
      color: 'text-green-500',
    },
  ];

  return (
    <SharedLayout>
      <PageContainer>
        <PageHeader
          title="Dashboard"
          description="Welcome to ACHILLES - Endpoint Management"
        />

        {/* Organization Info */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="w-5 h-5" />
              Current Organization
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Organization Name</p>
                <p className="font-medium">{currentOrg?.name || 'N/A'}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Organization ID</p>
                <p className="font-mono text-sm">{currentOrg?.oid || 'N/A'}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Dashboard Metrics */}
        <MetricsCards
          totalSensors={metrics.totalSensors}
          onlineSensors={metrics.onlineSensors}
          sleeperSensors={metrics.sleeperSensors}
          osPlatforms={metrics.osPlatforms}
          totalPayloads={metrics.totalPayloads}
          loading={metricsLoading}
        />

        {/* Quick Actions */}
        <div className="mb-6">
          <h2 className="text-lg font-semibold mb-4">Quick Actions</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {quickActions.map((action) => (
              <Card
                key={action.title}
                className="cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => navigate(action.path)}
              >
                <CardContent className="pt-6">
                  <div className="flex items-start gap-4">
                    <div className={`p-3 rounded-lg bg-muted ${action.color}`}>
                      <action.icon className="w-6 h-6" />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-semibold mb-1">{action.title}</h3>
                      <p className="text-sm text-muted-foreground">
                        {action.description}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        {/* API Status */}
        <Card className="border-green-500/20 bg-green-500/5">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-green-500 mt-0.5" />
              <div>
                <h3 className="font-semibold text-green-500 mb-2">
                  Connected to Backend API
                </h3>
                <div className="space-y-1 text-sm text-muted-foreground">
                  <p>
                    <span className="font-medium">Backend:</span>{' '}
                    {import.meta.env.VITE_API_URL || 'http://localhost:3000'}
                  </p>
                  <p>
                    <span className="font-medium">Authentication:</span>{' '}
                    Session-based (Active)
                  </p>
                  <p>
                    <span className="font-medium">WebSocket:</span>{' '}
                    ws://localhost:3000/ws (Available)
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Getting Started */}
        <div className="mt-6 text-center text-sm text-muted-foreground">
          <p>
            Select a quick action above or use the navigation menu to get started.
          </p>
        </div>
      </PageContainer>
    </SharedLayout>
  );
}
