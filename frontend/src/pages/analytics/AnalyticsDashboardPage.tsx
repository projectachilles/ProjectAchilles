import { useState, useEffect } from 'react';
import { BarChart3, TrendingUp, Shield, Server, AlertCircle } from 'lucide-react';
import { analyticsApi } from '../../services/api/analytics';
import type { DefenseScore, Execution } from '../../services/api/analytics';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/shared/ui/Card';
import { Loading } from '../../components/shared/ui/Spinner';
import { Badge } from '../../components/shared/ui/Badge';

export default function AnalyticsDashboardPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [defenseScore, setDefenseScore] = useState<DefenseScore | null>(null);
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [uniqueHosts, setUniqueHosts] = useState(0);
  const [uniqueTests, setUniqueTests] = useState(0);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    try {
      setLoading(true);
      setError(null);

      const [scoreData, executionsData, hostsCount, testsCount] = await Promise.all([
        analyticsApi.getDefenseScore(),
        analyticsApi.getRecentExecutions({ limit: 10 }),
        analyticsApi.getUniqueHostnames(),
        analyticsApi.getUniqueTests(),
      ]);

      setDefenseScore(scoreData);
      setExecutions(executionsData);
      setUniqueHosts(hostsCount);
      setUniqueTests(testsCount);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load analytics data');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Loading message="Loading analytics..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Card className="flex items-center gap-4 p-6 bg-destructive/10 border-destructive/30">
          <AlertCircle className="w-8 h-8 text-destructive" />
          <div>
            <h2 className="font-semibold text-destructive">Failed to Load Analytics</h2>
            <p className="text-sm text-muted-foreground">{error}</p>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Analytics Dashboard</h1>
        <p className="text-muted-foreground">
          Test execution results and endpoint protection metrics
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {/* Defense Score */}
        <Card className="bg-gradient-to-br from-primary/10 to-primary/5">
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-lg bg-primary/10">
                <Shield className="w-6 h-6 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Defense Score</p>
                <p className="text-3xl font-bold">
                  {defenseScore ? `${Math.round(defenseScore.score)}%` : 'N/A'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Total Executions */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-lg bg-muted">
                <BarChart3 className="w-6 h-6 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Executions</p>
                <p className="text-3xl font-bold">{defenseScore?.totalExecutions || 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Unique Hosts */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-lg bg-muted">
                <Server className="w-6 h-6 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Unique Endpoints</p>
                <p className="text-3xl font-bold">{uniqueHosts}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Unique Tests */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-lg bg-muted">
                <TrendingUp className="w-6 h-6 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Unique Tests</p>
                <p className="text-3xl font-bold">{uniqueTests}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Protection Stats */}
      {defenseScore && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
          <Card>
            <CardHeader>
              <CardTitle>Protection Breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm">Protected</span>
                  <div className="flex items-center gap-2">
                    <div className="w-32 h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-success rounded-full"
                        style={{ width: `${(defenseScore.protectedCount / defenseScore.totalExecutions) * 100}%` }}
                      />
                    </div>
                    <span className="font-medium text-success">{defenseScore.protectedCount}</span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm">Unprotected</span>
                  <div className="flex items-center gap-2">
                    <div className="w-32 h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-destructive rounded-full"
                        style={{ width: `${(defenseScore.unprotectedCount / defenseScore.totalExecutions) * 100}%` }}
                      />
                    </div>
                    <span className="font-medium text-destructive">{defenseScore.unprotectedCount}</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Recent Executions */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Executions</CardTitle>
        </CardHeader>
        <CardContent>
          {executions.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">No executions found</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-3 px-2 font-medium">Test</th>
                    <th className="text-left py-3 px-2 font-medium">Hostname</th>
                    <th className="text-left py-3 px-2 font-medium">Outcome</th>
                    <th className="text-left py-3 px-2 font-medium">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {executions.map((execution, idx) => (
                    <tr key={idx} className="border-b border-border last:border-0">
                      <td className="py-3 px-2">
                        <span className="font-medium">{execution.testName || execution.testUuid}</span>
                      </td>
                      <td className="py-3 px-2 text-muted-foreground">
                        {execution.hostname}
                      </td>
                      <td className="py-3 px-2">
                        <Badge
                          variant={
                            execution.error === 126 ? 'success' :
                            execution.error === 101 ? 'destructive' :
                            'default'
                          }
                        >
                          {execution.outcome || `Exit ${execution.error}`}
                        </Badge>
                      </td>
                      <td className="py-3 px-2 text-muted-foreground">
                        {new Date(execution.timestamp).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
