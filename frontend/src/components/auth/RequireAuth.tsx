import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAppAuth } from '../../contexts/AuthContext';

interface RequireAuthProps {
  children: ReactNode;
}

export function RequireAuth({ children }: RequireAuthProps) {
  const { isSignedIn, isLoaded } = useAppAuth();

  if (!isLoaded) return null;
  if (!isSignedIn) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
