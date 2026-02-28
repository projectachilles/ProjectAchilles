import { Loader2, ShieldCheck, ShieldX } from 'lucide-react';
import { formatDistanceToNow, isValid } from 'date-fns';
import type { TestExecution } from '../../../services/api/analytics';

// Parse timestamp - handles both epoch ms strings and ISO strings
function parseTimestamp(timestamp: string): Date {
  // Check if it's a numeric string (epoch milliseconds)
  if (/^\d+$/.test(timestamp)) {
    return new Date(parseInt(timestamp, 10));
  }
  // Otherwise parse as Date string
  return new Date(timestamp);
}

// Safe date formatting that handles invalid timestamps
function formatTimestamp(timestamp: string): string {
  if (!timestamp) return 'Unknown';
  try {
    const date = parseTimestamp(timestamp);
    if (!isValid(date)) return 'Unknown';
    return formatDistanceToNow(date, { addSuffix: true });
  } catch {
    return 'Unknown';
  }
}

interface ExecutionsTableProps {
  data: TestExecution[];
  loading?: boolean;
}

export default function ExecutionsTable({ data, loading }: ExecutionsTableProps) {
  if (loading) {
    return (
      <div className="h-full bg-secondary/50 border-theme border-border rounded-base shadow-theme p-6 min-h-[300px] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="h-full bg-secondary/50 border-theme border-border rounded-base shadow-theme p-6 min-h-[300px] flex items-center justify-center">
        <p className="text-muted-foreground">No recent executions</p>
      </div>
    );
  }

  return (
    <div className="h-full bg-secondary/50 border-theme border-border rounded-base shadow-theme p-6 flex flex-col">
      <h3 className="font-semibold text-lg mb-4">Recent Test Executions</h3>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b-[length:var(--theme-border-width)] border-border">
              <th className="text-left py-2 px-3 text-sm font-medium text-muted-foreground">Test Name</th>
              <th className="text-left py-2 px-3 text-sm font-medium text-muted-foreground">Host</th>
              <th className="text-left py-2 px-3 text-sm font-medium text-muted-foreground">Result</th>
              <th className="text-left py-2 px-3 text-sm font-medium text-muted-foreground">Org</th>
              <th className="text-left py-2 px-3 text-sm font-medium text-muted-foreground">Time</th>
            </tr>
          </thead>
          <tbody>
            {data.map((execution, index) => (
              <tr
                key={`${execution.test_uuid}-${execution.timestamp}-${index}`}
                className="border-b border-border/50 last:border-0 hover:bg-accent/50 transition-colors"
              >
                <td className="py-3 px-3">
                  <span className="font-medium">{execution.test_name}</span>
                </td>
                <td className="py-3 px-3">
                  <span className="text-muted-foreground font-mono text-sm">
                    {execution.hostname}
                  </span>
                </td>
                <td className="py-3 px-3">
                  {execution.is_protected ? (
                    <span className="inline-flex items-center gap-1.5 text-green-600 dark:text-green-400">
                      <ShieldCheck className="w-4 h-4" />
                      <span className="text-sm font-medium">Protected</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-red-600 dark:text-red-400">
                      <ShieldX className="w-4 h-4" />
                      <span className="text-sm font-medium">Unprotected</span>
                    </span>
                  )}
                </td>
                <td className="py-3 px-3">
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-primary/10 text-primary">
                    {execution.org}
                  </span>
                </td>
                <td className="py-3 px-3">
                  <span className="text-sm text-muted-foreground">
                    {formatTimestamp(execution.timestamp)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
