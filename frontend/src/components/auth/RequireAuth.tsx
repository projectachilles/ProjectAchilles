import { SignedIn, SignedOut, RedirectToSignIn } from '@clerk/clerk-react';
import { ReactNode } from 'react';

interface RequireAuthProps {
  children: ReactNode;
}

export function RequireAuth({ children }: RequireAuthProps) {
  return (
    <>
      <SignedIn>{children}</SignedIn>
      <SignedOut>
        <RedirectToSignIn />
      </SignedOut>
    </>
  );
}
