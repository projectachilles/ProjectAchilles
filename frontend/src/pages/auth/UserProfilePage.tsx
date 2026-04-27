import { UserProfile } from '@clerk/clerk-react';
import { clerkAppearance } from '@/lib/clerkAppearance';
import '@/pages/settings/settings.css';

export default function UserProfilePage() {
  return (
    <div className="auth-shell user-profile">
      <div className="auth-shell-inner">
        <div className="auth-shell-brand">
          <span className="accent-dot" />
          ProjectAchilles
        </div>
        <UserProfile appearance={clerkAppearance} />
      </div>
    </div>
  );
}
