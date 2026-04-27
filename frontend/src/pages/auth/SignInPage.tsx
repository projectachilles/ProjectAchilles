import { SignIn } from '@clerk/clerk-react';
import { clerkAppearance } from '@/lib/clerkAppearance';
import '@/pages/settings/settings.css';

export default function SignInPage() {
  return (
    <div className="auth-shell">
      <div className="auth-shell-inner">
        <div className="auth-shell-brand">
          <span className="accent-dot" />
          ProjectAchilles
        </div>
        <SignIn
          routing="path"
          path="/sign-in"
          signUpUrl="/sign-up"
          afterSignInUrl="/dashboard"
          appearance={clerkAppearance}
        />
      </div>
    </div>
  );
}
