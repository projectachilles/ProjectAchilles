import { useMemo } from 'react';
import type { AppRole, Permission, AppModule } from '@/types/roles';
import { getPermissionsForRole, canAccessModule } from '@/types/roles';
import { useAppAuth } from '@/contexts/AuthContext';

/**
 * Returns the current user's role from AuthContext.
 */
export function useAppRole(): AppRole | undefined {
  const { user } = useAppAuth();
  const role = user?.role;
  if (role === 'admin' || role === 'operator' || role === 'analyst' || role === 'explorer') {
    return role;
  }
  return undefined;
}

/**
 * Check if the current user has a specific permission.
 */
export function useHasPermission(...permissions: Permission[]): boolean {
  const role = useAppRole();
  return useMemo(() => {
    const granted = getPermissionsForRole(role);
    return permissions.every(p => granted.has(p));
  }, [role, ...permissions]);
}

/**
 * Check if the current user can access a module.
 */
export function useCanAccessModule(module: AppModule): boolean {
  const role = useAppRole();
  return useMemo(() => canAccessModule(role, module), [role, module]);
}
