import { useState, useCallback } from 'react';
import { ShieldCheck } from 'lucide-react';
import { useHasPermission } from '@/hooks/useAppRole';
import { SettingsPageHeader } from './components/SettingsPageHeader';
import { SettingsCard } from './components/SettingsCard';
import { CertificateConfig } from './components/CertificateConfig';
import type { IntegrationStatus } from './components/IntegrationCard';

export default function SettingsCertificatePage() {
  const canDelete = useHasPermission('settings:certificates:delete');
  const [status, setStatus] = useState<IntegrationStatus>('not-configured');

  const handleStatusChange = useCallback((exists: boolean) => {
    setStatus(exists ? 'connected' : 'not-configured');
  }, []);

  return (
    <main className="settings-content">
      <SettingsPageHeader
        eyebrow="Code Signing"
        title="Certificates"
        description="PFX certificates used by osslsigncode to Authenticode-sign Windows binaries."
      />

      <SettingsCard
        icon={ShieldCheck}
        title="Certificate Store"
        description="Up to 5 certificates may be registered. Only one may be active at a time."
        status={status}
        statusMessage={status === 'connected' ? 'Active cert configured' : 'No active cert'}
      >
        <CertificateConfig canDelete={canDelete} onStatusChange={handleStatusChange} />
      </SettingsCard>
    </main>
  );
}
