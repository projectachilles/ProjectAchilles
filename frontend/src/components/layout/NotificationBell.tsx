import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, AlertTriangle, ExternalLink, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { alertsApi } from '@/services/api/alerts';
import type { AlertHistoryItem } from '@/services/api/alerts';

const LAST_SEEN_KEY = 'achilles:lastSeenAlert';
const MAX_DISPLAY = 5;

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function NotificationBell() {
  const navigate = useNavigate();
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [alerts, setAlerts] = useState<AlertHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasUnseen, setHasUnseen] = useState(false);

  // On mount: check if alerting is configured + seed hasUnseen
  useEffect(() => {
    let cancelled = false;
    alertsApi.getAlertSettings().then((settings) => {
      if (cancelled) return;
      setConfigured(settings.configured);
      if (settings.last_alert_at) {
        const lastSeen = localStorage.getItem(LAST_SEEN_KEY);
        if (!lastSeen || new Date(settings.last_alert_at) > new Date(lastSeen)) {
          setHasUnseen(true);
        }
      }
    });
    return () => { cancelled = true; };
  }, []);

  // On dropdown open: fetch history, clear unseen
  const handleOpenChange = useCallback((open: boolean) => {
    if (!open || !configured) return;

    setLoading(true);
    alertsApi.getAlertHistory().then((items) => {
      setAlerts(items.slice(0, MAX_DISPLAY));
      setLoading(false);

      // Update last seen
      if (items.length > 0) {
        localStorage.setItem(LAST_SEEN_KEY, items[0].timestamp);
      }
      setHasUnseen(false);
    });
  }, [configured]);

  return (
    <DropdownMenu onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-4 w-4" />
          <span className="sr-only">Notifications</span>
          {hasUnseen && (
            <span
              data-testid="unseen-dot"
              className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-destructive"
            />
          )}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel>Notifications</DropdownMenuLabel>
        <DropdownMenuSeparator />

        {/* Not configured state */}
        {configured === false && (
          <div className="px-3 py-4 text-center">
            <Bell className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm font-medium">Alerts not configured</p>
            <p className="text-xs text-muted-foreground mt-1">
              Set up in Settings → Integrations
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => navigate('/settings')}
            >
              <ExternalLink className="h-3 w-3 mr-1" />
              Open Settings
            </Button>
          </div>
        )}

        {/* Loading state */}
        {configured && loading && (
          <div className="px-3 py-6 flex justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* No alerts state */}
        {configured && !loading && alerts.length === 0 && (
          <div className="px-3 py-4 text-center">
            <p className="text-sm text-muted-foreground">No recent alerts — all clear</p>
          </div>
        )}

        {/* Alert items */}
        {configured && !loading && alerts.map((alert, idx) => (
          <DropdownMenuItem key={`${alert.timestamp}-${idx}`} className="flex-col items-start gap-1 py-2 cursor-default">
            {alert.breaches.map((b) => (
              <div key={b.metric} className="w-full">
                <div className="flex items-center gap-1.5 text-sm font-medium text-amber-500">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  {b.metric} {b.direction} {b.threshold}{b.unit}
                </div>
                <div className="text-xs text-muted-foreground ml-5">
                  {b.current}{b.unit} (threshold: {b.threshold}{b.unit})
                </div>
              </div>
            ))}
            <div className="flex items-center justify-between w-full mt-1 ml-5">
              <div className="flex gap-2 text-xs">
                {alert.channels.slack && (
                  <span className="text-green-500">Slack ✓</span>
                )}
                {alert.channels.slack === false && (
                  <span className="text-muted-foreground">Slack ✗</span>
                )}
                {alert.channels.email && (
                  <span className="text-green-500">Email ✓</span>
                )}
                {alert.channels.email === false && (
                  <span className="text-muted-foreground">Email ✗</span>
                )}
              </div>
              <span className="text-xs text-muted-foreground">
                {formatRelativeTime(alert.timestamp)}
              </span>
            </div>
          </DropdownMenuItem>
        ))}

        {/* Footer */}
        {configured && !loading && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="justify-center text-xs text-muted-foreground cursor-pointer"
              onClick={() => navigate('/settings')}
            >
              View all alerts →
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
