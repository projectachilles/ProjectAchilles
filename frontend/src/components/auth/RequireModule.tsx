import { Navigate } from 'react-router-dom';
import { useCanAccessModule } from '@/hooks/useAppRole';
import type { AppModule } from '@/types/roles';

interface RequireModuleProps {
  module: AppModule;
  children: React.ReactNode;
}

/**
 * Route guard that redirects to /dashboard if the user lacks access to the given module.
 */
export function RequireModule({ module, children }: RequireModuleProps) {
  const canAccess = useCanAccessModule(module);

  if (!canAccess) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}
