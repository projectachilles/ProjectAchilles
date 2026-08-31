import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export interface RemediationControl {
  id: string;
  title: string;
  category?: string;
  scoreImpact: string;
  url?: string;
}

interface TopControlsCardProps {
  controls: RemediationControl[];
  configured: boolean;
  loading?: boolean;
}

export function TopControlsCard({ controls, configured, loading }: TopControlsCardProps) {
  if (loading) {
    return <div className="h-64 animate-pulse rounded-lg border border-border bg-raised" aria-hidden="true" />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Top remediation controls</CardTitle>
        <CardDescription>Highest secure-score impact</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {!configured ? (
          <div className="flex h-32 items-center justify-center text-sm text-faint">
            Defender is not configured.
          </div>
        ) : controls.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-sm text-faint">
            Nothing recorded yet.
          </div>
        ) : (
          controls.map((control, i) => {
            const row = (
              <>
                <span className="w-4 shrink-0 font-mono text-xs text-faint">{i + 1}</span>
                <span className="flex-1 text-xs leading-snug">{control.title}</span>
                {control.category && <Badge variant="default">{control.category}</Badge>}
                <span className="shrink-0 font-mono text-xs text-accent">{control.scoreImpact}</span>
              </>
            );
            const className = 'flex items-center gap-2.5 rounded-md px-1 py-1.5 hover:bg-raised';
            return control.url ? (
              <a key={control.id} href={control.url} target="_blank" rel="noreferrer" className={className}>
                {row}
              </a>
            ) : (
              <div key={control.id} className={className}>{row}</div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
