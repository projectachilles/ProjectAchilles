import { useNavigate } from 'react-router-dom';
import { Monitor, ShieldCheck } from 'lucide-react';
import { I, Icon } from '@/components/layout/AchillesShell';
import { SettingsPageHeader } from './components/SettingsPageHeader';
import { SettingsCard } from './components/SettingsCard';
import { PlatformConfig } from './components/PlatformConfig';
import { CertificateConfig } from './components/CertificateConfig';
import { useHasPermission } from '@/hooks/useAppRole';

export default function SettingsTestsPage() {
  const navigate = useNavigate();
  const canDeleteCert = useHasPermission('settings:certificates:delete');

  return (
    <main className="settings-content">
      <SettingsPageHeader
        eyebrow="Tests / Compilation"
        title="Tests"
        description="Configure target platform and code-signing for security test binaries."
        actions={
          <>
            <button
              type="button"
              className="dash-quick-btn"
              onClick={() => navigate('/settings/platform')}
            >
              <Icon size={12}>{I.target}</Icon>
              Platform
            </button>
            <button
              type="button"
              className="dash-quick-btn"
              onClick={() => navigate('/settings/certificate')}
            >
              <Icon size={12}>{I.target}</Icon>
              Certificates
            </button>
          </>
        }
      />

      <div className="settings-stack">
        <SettingsCard
          icon={Monitor}
          title="Target Platform"
          description="Operating system and architecture for test-binary compilation."
          status="connected"
          statusMessage="Configured"
        >
          <PlatformConfig />
        </SettingsCard>

        <SettingsCard
          icon={ShieldCheck}
          title="Code Signing Certificate"
          description="PFX certificates for osslsigncode binary signing — upload or generate."
        >
          <CertificateConfig canDelete={canDeleteCert} />
        </SettingsCard>
      </div>
    </main>
  );
}
