import { useState } from 'react';
import { SettingsSidebar, type SettingsTab } from './components/SettingsSidebar';
import { IntegrationsTab } from './components/IntegrationsTab';
import { TestsTab } from './components/TestsTab';
import { AgentTab } from './components/AgentTab';
import { UsersTab } from './components/UsersTab';

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('integrations');

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
      default:
        return <IntegrationsTab />;
    }
  };

  return (
    <div className="container mx-auto px-6 py-8">
      <div className="flex gap-8">
        <SettingsSidebar activeTab={activeTab} onTabChange={setActiveTab} />
        <div className="flex-1 max-w-3xl">{renderTabContent()}</div>
      </div>
    </div>
  );
}
