import { useState } from 'react';
import { pillClass } from '@/components/shared/ui/pillStyles';
import { Plug, FlaskConical, Bot, Users, KeyRound } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { useHasPermission } from '@/hooks/useAppRole';
import { IntegrationsTab } from './components/IntegrationsTab';
import { TestsTab } from './components/TestsTab';
import { AgentTab } from './components/AgentTab';
import { UsersTab } from './components/UsersTab';
import { ApiKeysTab } from './components/ApiKeysTab';

type SettingsTab = 'integrations' | 'tests' | 'agent' | 'users' | 'apikeys';

const ALL_TABS: Array<{ id: SettingsTab; label: string; icon: typeof Plug }> = [
  { id: 'integrations', label: 'Integrations', icon: Plug },
  { id: 'tests', label: 'Tests', icon: FlaskConical },
  { id: 'agent', label: 'Agent', icon: Bot },
  { id: 'users', label: 'Users', icon: Users },
  { id: 'apikeys', label: 'API keys', icon: KeyRound },
];

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('integrations');
  const canManageUsers = useHasPermission('settings:users:manage');

  const tabs = ALL_TABS.filter((tab) =>
    tab.id === 'users' || tab.id === 'apikeys' ? canManageUsers : true,
  );

  const renderTabContent = () => {
    switch (activeTab) {
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
