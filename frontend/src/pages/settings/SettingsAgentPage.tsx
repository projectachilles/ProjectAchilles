import { useState, useEffect, useCallback } from 'react';
import { Hammer, Package, Upload } from 'lucide-react';
import { useHasPermission } from '@/hooks/useAppRole';
import { agentApi } from '@/services/api/agent';
import type { AgentVersion } from '@/types/agent';
import { SettingsPageHeader } from './components/SettingsPageHeader';
import { SettingsCard } from './components/SettingsCard';
import { AgentBuildFromSource } from './components/AgentBuildFromSource';
import { AgentBinaryUpload } from './components/AgentBinaryUpload';
import { AgentVersionTable } from './components/AgentVersionTable';
import type { IntegrationStatus } from './components/IntegrationCard';

export default function SettingsAgentPage() {
  const canDeleteVersion = useHasPermission('endpoints:versions:delete');
  const [versions, setVersions] = useState<AgentVersion[]>([]);
  const [status, setStatus] = useState<IntegrationStatus>('not-configured');
  const [statusMessage, setStatusMessage] = useState('No binaries uploaded');

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
        setStatusMessage(`${result.length} version(s) · ${platforms.size} platform(s)`);
      }
    } catch {
      setStatus('error');
      setStatusMessage('Failed to load');
    }
  }, []);

  useEffect(() => {
    fetchVersions();
  }, [fetchVersions]);

  return (
    <main className="settings-content">
      <SettingsPageHeader
        eyebrow="Agent / Binaries"
        title="Agent"
        description="Build, upload, and manage Achilles agent binaries shipped to endpoints."
      />

      <div className="settings-stack">
        <SettingsCard
          icon={Hammer}
          title="Build From Source"
          description="Cross-compile the Go agent for a target OS / architecture."
          status={status}
          statusMessage={statusMessage}
        >
          <AgentBuildFromSource versions={versions} onBuilt={fetchVersions} />
        </SettingsCard>

        <SettingsCard
          icon={Upload}
          title="Upload Binary"
          description="Upload a pre-compiled agent binary for distribution."
          status={status}
          statusMessage={statusMessage}
        >
          <AgentBinaryUpload onUploaded={fetchVersions} />
        </SettingsCard>

        <SettingsCard
          icon={Package}
          title="Registered Versions"
          description="All agent binaries available for download by enrolled endpoints."
          status={versions.length > 0 ? 'connected' : 'not-configured'}
          statusMessage={
            versions.length > 0 ? `${versions.length} active` : 'None registered'
          }
        >
          <AgentVersionTable
            versions={versions}
            canDelete={canDeleteVersion}
            onDeleted={fetchVersions}
          />
        </SettingsCard>
      </div>
    </main>
  );
}
