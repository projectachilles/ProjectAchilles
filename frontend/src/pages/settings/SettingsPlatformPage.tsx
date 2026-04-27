import { Monitor } from 'lucide-react';
import { SettingsPageHeader } from './components/SettingsPageHeader';
import { SettingsCard } from './components/SettingsCard';
import { PlatformConfig } from './components/PlatformConfig';

export default function SettingsPlatformPage() {
  return (
    <main className="settings-content">
      <SettingsPageHeader
        eyebrow="Tests / Compilation"
        title="Target Platform"
        description="Operating system and architecture used when building security-test binaries."
      />

      <SettingsCard
        icon={Monitor}
        title="Platform"
        description="Changes apply to all subsequent builds. Existing artifacts are not rebuilt."
        status="connected"
        statusMessage="Saved automatically"
      >
        <PlatformConfig />
      </SettingsCard>
    </main>
  );
}
