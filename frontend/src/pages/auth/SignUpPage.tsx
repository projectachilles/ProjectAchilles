import { SignUp } from '@clerk/clerk-react';
import { clerkAppearance } from '@/lib/clerkAppearance';
import '@/pages/settings/settings.css';

export default function SignUpPage() {
  return (
    <div className="auth-shell">
      <div className="auth-shell-inner">
        <div className="auth-shell-brand">
          <span className="accent-dot" />
          ProjectAchilles
        </div>
        <SignUp
          routing="path"
          path="/sign-up"
          signInUrl="/sign-in"
          afterSignUpUrl="/dashboard"
          appearance={clerkAppearance}
        />
      </div>
    </div>
  );
}
