import { useState, useEffect } from 'react';
import { Download, ChevronDown, Package } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/shared/ui/Card';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/shared/ui/Table';
import { agentApi } from '@/services/api/agent';
import type { AgentVersion } from '@/types/agent';
import { cn } from '@/lib/utils';
import { getLatestPerPlatform } from '@/pages/endpoints/utils/versionHelpers';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function AvailableBinaries() {
  const [versions, setVersions] = useState<AgentVersion[]>([]);
  const [expanded, setExpanded] = useState(true);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    agentApi.listVersions()
      .then((v) => setVersions(v))
      .catch(() => {/* silent – section just won't show */})
      .finally(() => setLoaded(true));
  }, []);

  if (!loaded || versions.length === 0) return null;

  const latest = getLatestPerPlatform(versions);

  return (
    <Card className="mb-6">
      <CardHeader>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="w-full flex items-center justify-between"
        >
          <CardTitle className="flex items-center gap-2">
            <Package className="w-5 h-5" />
            Available Binaries
          </CardTitle>
          <ChevronDown
            className={cn(
              'w-5 h-5 text-muted-foreground transition-transform duration-200',
              expanded && 'rotate-180'
            )}
          />
        </button>
      </CardHeader>
      {expanded && (
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Version</TableHead>
                <TableHead>OS</TableHead>
                <TableHead>Arch</TableHead>
                <TableHead>Size</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="w-24">Download</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {latest.map((v) => (
                <TableRow key={`${v.os}-${v.arch}`}>
                  <TableCell className="font-mono text-sm">{v.version}</TableCell>
                  <TableCell>{v.os}</TableCell>
                  <TableCell>{v.arch}</TableCell>
                  <TableCell>{formatSize(v.binary_size)}</TableCell>
                  <TableCell className="text-sm">
                    {new Date(v.created_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    <a
                      href={`/api/agent/download?os=${v.os}&arch=${v.arch}`}
                      download
                      className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                    >
                      <Download className="w-4 h-4" />
                      Download
                    </a>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      )}
    </Card>
  );
}
