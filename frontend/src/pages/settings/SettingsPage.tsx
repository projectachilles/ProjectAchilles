import { useState } from 'react';
import { Plug, FlaskConical, Bot, Users, KeyRound, FingerprintPattern } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { pillClass } from '@/components/shared/ui/pillStyles';
import { useHasPermission } from '@/hooks/useAppRole';
import { useCapabilities } from '@/hooks/useCapabilities';
import { GeneralTab } from './components/GeneralTab';
import { IntegrationsTab } from './components/IntegrationsTab';
import { TestsTab } from './components/TestsTab';
import { AgentTab } from './components/AgentTab';
import { UsersTab } from './components/UsersTab';
import { ApiKeysTab } from './components/ApiKeysTab';

type SettingsTab = 'general' | 'integrations' | 'tests' | 'agent' | 'users' | 'apikeys';

const ALL_TABS: Array<{ id: SettingsTab; label: string; icon: typeof Plug }> = [
  { id: 'general', label: 'General', icon: FingerprintPattern },
  { id: 'integrations', label: 'Integrations', icon: Plug },
  { id: 'tests', label: 'Tests', icon: FlaskConical },
  { id: 'agent', label: 'Agent', icon: Bot },
  { id: 'users', label: 'Users', icon: Users },
  { id: 'apikeys', label: 'API keys', icon: KeyRound },
];

export default function SettingsPage() {
  const canManageUsers = useHasPermission('settings:users:manage');
  const canEditPlatform = useHasPermission('settings:platform:write');
  const { consoleIdentity } = useCapabilities();

  const tabs = ALL_TABS.filter((tab) => {
    if (tab.id === 'general') return canEditPlatform && consoleIdentity;
    if (tab.id === 'users' || tab.id === 'apikeys') return canManageUsers;
    return true;
  });

  // Permissions can resolve after first render, so keep the choice as "unset"
  // until the user clicks and fall back to the first visible tab.
  const [selectedTab, setActiveTab] = useState<SettingsTab | null>(null);
  const activeTab: SettingsTab =
    selectedTab && tabs.some((t) => t.id === selectedTab) ? selectedTab : (tabs[0]?.id ?? 'integrations');

  const renderTabContent = () => {
    switch (activeTab) {
      case 'general':
        return <GeneralTab />;
      case 'integrations':
        return <IntegrationsTab />;
      case 'tests':
        return <TestsTab />;
      case 'agent':
        return <AgentTab />;
      case 'users':
        return <UsersTab />;
      case 'apikeys':
        return <ApiKeysTab />;
      default:
        return <IntegrationsTab />;
    }
  };

  return (
    <div>
      <PageHeader title="Settings" description="Platform configuration and integrations" />

      {/* Pill tabs (handoff §6) */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={pillClass(activeTab === tab.id)}
          >
            <tab.icon className="h-4 w-4" />
            {tab.label}
          </button>
        ))}
      </div>

      <div className="max-w-5xl">{renderTabContent()}</div>
    </div>
  );
}
