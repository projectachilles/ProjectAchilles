import { SettingsPageHeader } from './components/SettingsPageHeader';
import { SettingsCard } from './components/SettingsCard';
import { UsersTab } from './components/UsersTab';

export default function SettingsUsersPage() {
  return (
    <main className="settings-content">
      <SettingsPageHeader
        eyebrow="Access Control"
        title="Users & Roles"
        description="Invite teammates and assign per-module access. Unassigned users have full Administrator access by default."
      />

      <SettingsCard title="Members" description="Active accounts and pending invitations.">
        <UsersTab />
      </SettingsCard>
    </main>
  );
}
