import { useState } from 'react';
import { Trash2, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/shared/ui/Button';
import { Spinner } from '@/components/shared/ui/Spinner';
import { Badge } from '@/components/shared/ui/Badge';
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

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface AgentVersionTableProps {
  versions: AgentVersion[];
  onDeleted: () => void;
}

export function AgentVersionTable({ versions, onDeleted }: AgentVersionTableProps) {
  const [deletingKey, setDeletingKey] = useState<string | null>(null);

  async function handleDelete(v: AgentVersion) {
    const key = `${v.version}-${v.os}-${v.arch}`;
    setDeletingKey(key);
    try {
      await agentApi.deleteVersion(v.version, v.os, v.arch);
      onDeleted();
    } catch (err) {
      console.error('Failed to delete version:', err);
    } finally {
      setDeletingKey(null);
    }
  }

  if (versions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4 text-center">
        No versions registered yet.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Version</TableHead>
          <TableHead>OS</TableHead>
          <TableHead>Arch</TableHead>
          <TableHead>Size</TableHead>
          <TableHead>SHA-256</TableHead>
          <TableHead>Signed</TableHead>
          <TableHead>Mandatory</TableHead>
          <TableHead>Created</TableHead>
          <TableHead className="w-16">Delete</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {versions.map((v) => {
          const key = `${v.version}-${v.os}-${v.arch}`;
          const isDeleting = deletingKey === key;
          return (
            <TableRow key={key}>
              <TableCell className="font-mono text-sm">{v.version}</TableCell>
              <TableCell>{v.os}</TableCell>
              <TableCell>{v.arch}</TableCell>
              <TableCell>{formatSize(v.binary_size)}</TableCell>
              <TableCell
                className="font-mono text-xs cursor-help"
                title={v.binary_sha256}
              >
                {v.binary_sha256.slice(0, 12)}...
              </TableCell>
              <TableCell>
                {v.signed ? (
                  <ShieldCheck className="w-4 h-4 text-green-500" />
                ) : (
                  <span className="text-muted-foreground text-sm">—</span>
                )}
              </TableCell>
              <TableCell>
                {v.mandatory ? (
                  <Badge variant="destructive">Yes</Badge>
                ) : (
                  <span className="text-muted-foreground text-sm">No</span>
                )}
              </TableCell>
              <TableCell className="text-sm">
                {new Date(v.created_at).toLocaleDateString()}
              </TableCell>
              <TableCell>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleDelete(v)}
                  disabled={isDeleting}
                >
                  {isDeleting ? (
                    <Spinner size="sm" />
                  ) : (
                    <Trash2 className="w-4 h-4 text-destructive" />
                  )}
                </Button>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
