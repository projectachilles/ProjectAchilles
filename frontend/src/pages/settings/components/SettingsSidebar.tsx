import { Plug, FlaskConical, Bot, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useHasPermission } from '@/hooks/useAppRole';

type SettingsTab = 'integrations' | 'tests' | 'agent' | 'users';

interface SettingsSidebarProps {
  activeTab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
}

interface TabItem {
  id: SettingsTab;
  label: string;
  icon: typeof Plug;
}

const allTabs: TabItem[] = [
  { id: 'integrations', label: 'Integrations', icon: Plug },
  { id: 'tests', label: 'Tests', icon: FlaskConical },
  { id: 'agent', label: 'Agent', icon: Bot },
  { id: 'users', label: 'Users', icon: Users },
];

export function SettingsSidebar({ activeTab, onTabChange }: SettingsSidebarProps) {
  const canManageUsers = useHasPermission('settings:users:manage');

  const tabs = allTabs.filter((tab) => {
    if (tab.id === 'users') return canManageUsers;
    return true;
  });

  return (
    <div className="w-52 shrink-0">
      <h1 className="text-2xl font-bold mb-6">Settings</h1>
      <nav className="space-y-1">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;

          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left',
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              )}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}

export type { SettingsTab };
