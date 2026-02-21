import { useState, useEffect, useCallback } from 'react';
import { Upload, Package, Hammer } from 'lucide-react';
import { useHasPermission } from '@/hooks/useAppRole';
import { IntegrationCard, type IntegrationStatus } from './IntegrationCard';
import { AgentBuildFromSource } from './AgentBuildFromSource';
import { AgentBinaryUpload } from './AgentBinaryUpload';
import { AgentVersionTable } from './AgentVersionTable';
import { agentApi } from '@/services/api/agent';
import type { AgentVersion } from '@/types/agent';

export function AgentTab() {
  const canDeleteVersion = useHasPermission('endpoints:versions:delete');
  const [versions, setVersions] = useState<AgentVersion[]>([]);
  const [status, setStatus] = useState<IntegrationStatus>('not-configured');
  const [statusMessage, setStatusMessage] = useState('No binaries uploaded');
  const [buildAvailable, setBuildAvailable] = useState<boolean | null>(null);

  const fetchVersions = useCallback(async () => {
    try {
      const result = await agentApi.listVersions();
      setVersions(result);

      if (result.length === 0) {
        setStatus('not-configured');
        setStatusMessage('No binaries uploaded');
      } else {
        const platforms = new Set(result.map((v) => `${v.os}-${v.arch}`));
        setStatus('connected');
        setStatusMessage(`${result.length} version(s) across ${platforms.size} platform(s)`);
      }
    } catch {
      setStatus('error');
      setStatusMessage('Failed to load');
    }
  }, []);

  useEffect(() => {
    fetchVersions();
    agentApi.checkBuildAvailable().then(setBuildAvailable).catch(() => setBuildAvailable(false));
  }, [fetchVersions]);

  return (
    <div className="space-y-4">
      <div className="mb-6">
        <h2 className="text-xl font-semibold">Agent</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Build, upload, and manage Achilles agent binaries
        </p>
      </div>

      {buildAvailable && (
        <IntegrationCard
          icon={Hammer}
          title="Build Agent Binary"
          description="Cross-compile the agent from source for a target platform"
          status={status}
          statusMessage={statusMessage}
          defaultExpanded
        >
          <AgentBuildFromSource versions={versions} onBuilt={fetchVersions} />
        </IntegrationCard>
      )}

      <IntegrationCard
        icon={Upload}
        title="Upload Agent Binary"
        description="Upload a pre-compiled agent binary for distribution"
        status={status}
        statusMessage={statusMessage}
      >
        <AgentBinaryUpload onUploaded={fetchVersions} />
      </IntegrationCard>

      <IntegrationCard
        icon={Package}
        title="Registered Versions"
        description="All uploaded agent binaries available for download"
        status={versions.length > 0 ? 'connected' : 'not-configured'}
        statusMessage={versions.length > 0 ? `${versions.length} version(s)` : 'None'}
        defaultExpanded={versions.length > 0}
      >
        <AgentVersionTable versions={versions} canDelete={canDeleteVersion} onDeleted={fetchVersions} />
      </IntegrationCard>
    </div>
  );
}
