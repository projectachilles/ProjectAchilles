import { useMemo } from 'react';
import { useUser } from '@clerk/clerk-react';
import type { AppRole, Permission, AppModule } from '@/types/roles';
import { getPermissionsForRole, canAccessModule } from '@/types/roles';

/**
 * Returns the current user's role from Clerk publicMetadata.
 * Returns undefined if no role is set (= full access for migration safety).
 */
export function useAppRole(): AppRole | undefined {
  const { user } = useUser();
  const role = (user?.publicMetadata as Record<string, unknown> | undefined)?.role;
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
