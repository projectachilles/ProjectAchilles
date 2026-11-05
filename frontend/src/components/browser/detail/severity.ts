export function severityPillClass(severity?: string): string {
  switch (severity?.toLowerCase()) {
    case 'critical':
      return 'text-danger bg-danger-dim border-danger/30';
    case 'high':
      return 'text-warning bg-warning-dim border-warning/30';
    case 'medium':
      return 'text-info bg-info-dim border-info/30';
    default:
      return 'text-muted bg-raised border-border-strong';
  }
}
