import { useState } from 'react';
import { testsApi } from '@/services/api/tests';
import { Badge } from '@/components/shared/ui/Badge';
import { Button } from '@/components/shared/ui/Button';
import { Alert } from '@/components/shared/ui/Alert';
import { Hammer, Loader2 } from 'lucide-react';
import type { BuildInfo } from '@/types/test';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface SingleBuildProps {
  uuid: string;
  buildInfo: BuildInfo | null;
  onBuildComplete: (info: BuildInfo) => void;
  loading?: boolean;
}

function SingleBuild({ uuid, buildInfo, onBuildComplete, loading }: SingleBuildProps) {
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleBuild() {
    setBuilding(true);
    setError(null);
    try {
      const info = await testsApi.buildTest(uuid);
      onBuildComplete(info);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Build failed';
      const axiosErr = err as { response?: { data?: { error?: string } } };
      setError(axiosErr?.response?.data?.error || msg);
    } finally {
      setBuilding(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="w-3 h-3 animate-spin" />
        Checking build...
      </div>
    );
  }

  if (building) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
        <Loader2 className="w-4 h-4 animate-spin" />
        Building & signing...
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-red-500 line-clamp-2">{error}</p>
        <Button variant="outline" size="sm" onClick={handleBuild} className="w-full">
          Retry Build
        </Button>
      </div>
    );
  }

  if (!buildInfo || !buildInfo.exists) {
    return (
      <Alert variant="warning">
        <div>
          <p className="font-medium text-sm">Build required</p>
          <p className="text-xs mt-1">This test needs to be compiled before execution.</p>
          <Button variant="primary" size="sm" onClick={handleBuild} className="mt-2">
            <Hammer className="w-3 h-3" />
            Build & Sign
          </Button>
        </div>
      </Alert>
    );
  }

  // Build exists — compact display
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="font-mono text-xs truncate">{buildInfo.filename}</span>
      <div className="flex gap-1 shrink-0">
        {buildInfo.platform && (
          <Badge variant="default">{buildInfo.platform.os}/{buildInfo.platform.arch}</Badge>
        )}
        {buildInfo.signed ? (
          <Badge variant="success">Signed</Badge>
        ) : (
          <Badge variant="warning">Unsigned</Badge>
        )}
      </div>
      {buildInfo.fileSize != null && (
        <span className="text-xs text-muted-foreground shrink-0">{formatBytes(buildInfo.fileSize)}</span>
      )}
    </div>
  );
}

interface BatchBuildProps {
  builds: Map<string, BuildInfo | null>;
  onBuildAll: () => void;
  loading?: boolean;
}

function BatchBuild({ builds, onBuildAll, loading }: BatchBuildProps) {
  const total = builds.size;
  const builtCount = Array.from(builds.values()).filter(b => b?.exists).length;

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="w-3 h-3 animate-spin" />
        Checking builds...
      </div>
    );
  }

  if (builtCount === total) {
    return (
      <p className="text-xs text-muted-foreground">All {total} tests have builds</p>
    );
  }

  return (
    <Alert variant="warning">
      <div>
        <p className="font-medium text-sm">{builtCount} of {total} tests have builds</p>
        <p className="text-xs mt-1">Unbuilt tests need to be compiled before execution.</p>
        <Button variant="primary" size="sm" onClick={onBuildAll} className="mt-2">
          <Hammer className="w-3 h-3" />
          Build All ({total - builtCount})
        </Button>
      </div>
    </Alert>
  );
}

interface DrawerBuildSectionProps {
  builds: Map<string, BuildInfo | null>;
  onBuildComplete: (uuid: string, info: BuildInfo) => void;
  loading?: boolean;
}

export default function DrawerBuildSection({ builds, onBuildComplete, loading }: DrawerBuildSectionProps) {
  const [buildingAll, setBuildingAll] = useState(false);

  async function handleBuildAll() {
    setBuildingAll(true);
    const unbuilt = Array.from(builds.entries()).filter(([, b]) => !b?.exists);
    await Promise.allSettled(
      unbuilt.map(async ([uuid]) => {
        try {
          const info = await testsApi.buildTest(uuid);
          onBuildComplete(uuid, info);
        } catch {
          // individual failures are non-fatal
        }
      })
    );
    setBuildingAll(false);
  }

  const entries = Array.from(builds.entries());
  const isBatch = entries.length > 1;

  return (
    <div>
      <h3 className="text-xs font-semibold uppercase text-muted-foreground mb-2 flex items-center gap-2">
        <Hammer className="w-3 h-3" />
        Build Status
      </h3>

      {buildingAll ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          Building all...
        </div>
      ) : isBatch ? (
        <BatchBuild
          builds={builds}
          onBuildAll={handleBuildAll}
          loading={loading}
        />
      ) : entries.length === 1 ? (
        <SingleBuild
          uuid={entries[0][0]}
          buildInfo={entries[0][1]}
          onBuildComplete={(info) => onBuildComplete(entries[0][0], info)}
          loading={loading}
        />
      ) : null}
    </div>
  );
}
