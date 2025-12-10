import { useState, useEffect } from 'react';
import { Server, Search, RefreshCw, AlertCircle, Wifi, WifiOff } from 'lucide-react';
import { endpointsApi } from '../../services/api/endpoints';
import type { Sensor } from '../../services/api/endpoints';
import { Card, CardContent } from '../../components/shared/ui/Card';
import { Input } from '../../components/shared/ui/Input';
import { Button } from '../../components/shared/ui/Button';
import { Badge, PlatformBadge, StatusDot } from '../../components/shared/ui/Badge';
import { Loading } from '../../components/shared/ui/Spinner';

export default function SensorsPage() {
  const [sensors, setSensors] = useState<Sensor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadSensors();
  }, []);

  const loadSensors = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await endpointsApi.getSensors();
      setSensors(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sensors');
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadSensors();
    setRefreshing(false);
  };

  // Filter sensors based on search
  const filteredSensors = sensors.filter(sensor => {
    const query = searchQuery.toLowerCase();
    return (
      sensor.hostname.toLowerCase().includes(query) ||
      sensor.sid.toLowerCase().includes(query) ||
      sensor.internalIp.includes(query) ||
      sensor.platform.toLowerCase().includes(query)
    );
  });

  // Count stats
  const onlineCount = sensors.filter(s => s.isOnline).length;
  const offlineCount = sensors.filter(s => !s.isOnline).length;

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Loading message="Loading sensors..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Card className="flex items-center gap-4 p-6 bg-destructive/10 border-destructive/30">
          <AlertCircle className="w-8 h-8 text-destructive" />
          <div>
            <h2 className="font-semibold text-destructive">Failed to Load Sensors</h2>
            <p className="text-sm text-muted-foreground">{error}</p>
          </div>
          <Button variant="outline" onClick={loadSensors} className="ml-auto">
            Retry
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold mb-1">Sensors</h1>
          <p className="text-muted-foreground">
            {sensors.length} sensor{sensors.length !== 1 ? 's' : ''} •{' '}
            <span className="text-success">{onlineCount} online</span> •{' '}
            <span className="text-destructive">{offlineCount} offline</span>
          </p>
        </div>
        <Button
          variant="outline"
          onClick={handleRefresh}
          disabled={refreshing}
          className="gap-2"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Search */}
      <div className="mb-6">
        <Input
          placeholder="Search by hostname, SID, IP, or platform..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          leftIcon={<Search className="w-4 h-4" />}
        />
      </div>

      {/* Sensors List */}
      {filteredSensors.length === 0 ? (
        <Card className="p-8 text-center">
          <Server className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">
            {searchQuery ? 'No sensors match your search' : 'No sensors found'}
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredSensors.map((sensor) => (
            <Card key={sensor.sid} className="hover:border-primary/30 transition-colors">
              <CardContent className="py-4">
                <div className="flex items-center gap-4">
                  {/* Status */}
                  <div className="flex-shrink-0">
                    {sensor.isOnline ? (
                      <div className="p-2 rounded-lg bg-success/10">
                        <Wifi className="w-5 h-5 text-success" />
                      </div>
                    ) : (
                      <div className="p-2 rounded-lg bg-destructive/10">
                        <WifiOff className="w-5 h-5 text-destructive" />
                      </div>
                    )}
                  </div>

                  {/* Main Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold truncate">{sensor.hostname}</h3>
                      <StatusDot status={sensor.isOnline ? 'online' : 'offline'} />
                    </div>
                    <p className="text-xs text-muted-foreground font-mono truncate">
                      {sensor.sid}
                    </p>
                  </div>

                  {/* Platform */}
                  <div className="hidden sm:block">
                    <PlatformBadge platform={sensor.platform} />
                  </div>

                  {/* IP */}
                  <div className="hidden md:block text-sm text-muted-foreground">
                    {sensor.internalIp}
                  </div>

                  {/* Tags */}
                  <div className="hidden lg:flex gap-1 max-w-xs overflow-hidden">
                    {sensor.tags.slice(0, 3).map((tag) => (
                      <Badge key={tag} variant="outline" className="text-xs">
                        {tag}
                      </Badge>
                    ))}
                    {sensor.tags.length > 3 && (
                      <Badge variant="default" className="text-xs">
                        +{sensor.tags.length - 3}
                      </Badge>
                    )}
                  </div>

                  {/* Last Seen */}
                  <div className="text-xs text-muted-foreground whitespace-nowrap">
                    {sensor.isOnline ? 'Now' : formatLastSeen(sensor.lastSeen)}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function formatLastSeen(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}
