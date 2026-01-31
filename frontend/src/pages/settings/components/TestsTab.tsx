import { useState, useCallback } from 'react';
import { Monitor, ShieldCheck } from 'lucide-react';
import { IntegrationCard, type IntegrationStatus } from './IntegrationCard';
import { PlatformConfig } from './PlatformConfig';
import { CertificateConfig } from './CertificateConfig';

export function TestsTab() {
  const [certStatus, setCertStatus] = useState<IntegrationStatus>('not-configured');

  const handleCertStatusChange = useCallback((exists: boolean) => {
    setCertStatus(exists ? 'connected' : 'not-configured');
  }, []);

  return (
    <div className="space-y-4">
      <div className="mb-6">
        <h2 className="text-xl font-semibold">Tests</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Configure target platform and code signing for security tests
        </p>
      </div>

      <IntegrationCard
        icon={Monitor}
        title="Target Platform"
        description="Operating system and architecture for test binary compilation"
        status="connected"
        statusMessage="Configured"
        defaultExpanded
      >
        <PlatformConfig />
      </IntegrationCard>

      <IntegrationCard
        icon={ShieldCheck}
        title="Code Signing Certificate"
        description="Self-signed PFX certificate for osslsigncode binary signing"
        status={certStatus}
        defaultExpanded={certStatus === 'not-configured'}
      >
        <CertificateConfig onStatusChange={handleCertStatusChange} />
      </IntegrationCard>
    </div>
  );
}
