/**
 * RBAC role and permission definitions — mirrors backend/src/types/roles.ts.
 * Used for client-side UI filtering (backend enforces authorization regardless).
 */

export type AppRole = 'admin' | 'operator' | 'analyst' | 'explorer';

export type Permission =
  | 'tests:library:read'
  | 'tests:builds:read'
  | 'tests:builds:create'
  | 'tests:builds:delete'
  | 'tests:sync:execute'
  | 'analytics:dashboards:read'
  | 'analytics:settings:read'
  | 'analytics:settings:write'
  | 'analytics:index:create'
  | 'endpoints:agents:read'
  | 'endpoints:agents:write'
  | 'endpoints:agents:delete'
  | 'endpoints:tokens:create'
  | 'endpoints:tokens:delete'
  | 'endpoints:tasks:read'
  | 'endpoints:tasks:create'
  | 'endpoints:tasks:cancel'
  | 'endpoints:tasks:delete'
  | 'endpoints:tasks:notes'
  | 'endpoints:tasks:command'
  | 'endpoints:schedules:read'
  | 'endpoints:schedules:create'
  | 'endpoints:schedules:write'
  | 'endpoints:schedules:delete'
  | 'endpoints:versions:read'
  | 'endpoints:versions:create'
  | 'endpoints:versions:delete'
  | 'settings:platform:read'
  | 'settings:platform:write'
  | 'settings:certificates:read'
  | 'settings:certificates:create'
  | 'settings:certificates:delete'
  | 'settings:users:manage';

const ALL_PERMISSIONS: readonly Permission[] = [
  'tests:library:read', 'tests:builds:read', 'tests:builds:create', 'tests:builds:delete', 'tests:sync:execute',
  'analytics:dashboards:read', 'analytics:settings:read', 'analytics:settings:write', 'analytics:index:create',
  'endpoints:agents:read', 'endpoints:agents:write', 'endpoints:agents:delete',
  'endpoints:tokens:create', 'endpoints:tokens:delete',
  'endpoints:tasks:read', 'endpoints:tasks:create', 'endpoints:tasks:cancel', 'endpoints:tasks:delete', 'endpoints:tasks:notes', 'endpoints:tasks:command',
  'endpoints:schedules:read', 'endpoints:schedules:create', 'endpoints:schedules:write', 'endpoints:schedules:delete',
  'endpoints:versions:read', 'endpoints:versions:create', 'endpoints:versions:delete',
  'settings:platform:read', 'settings:platform:write',
  'settings:certificates:read', 'settings:certificates:create', 'settings:certificates:delete',
  'settings:users:manage',
];

export const ROLE_PERMISSIONS: Record<AppRole, readonly Permission[]> = {
  admin: ALL_PERMISSIONS,
  operator: [
    'tests:library:read', 'tests:builds:read', 'tests:builds:create', 'tests:sync:execute',
    'analytics:dashboards:read', 'analytics:settings:read',
    'endpoints:agents:read', 'endpoints:agents:write',
    'endpoints:tokens:create',
    'endpoints:tasks:read', 'endpoints:tasks:create', 'endpoints:tasks:cancel', 'endpoints:tasks:notes',
    'endpoints:schedules:read', 'endpoints:schedules:create', 'endpoints:schedules:write',
    'endpoints:versions:read', 'endpoints:versions:create',
    'settings:platform:read',
    'settings:certificates:read', 'settings:certificates:create',
  ],
  analyst: [
    'tests:library:read',
    'analytics:dashboards:read', 'analytics:settings:read',
    'endpoints:tasks:read', 'endpoints:tasks:notes',
  ],
  explorer: [
    'tests:library:read',
    'analytics:dashboards:read', 'analytics:settings:read',
  ],
};

export function getPermissionsForRole(role: AppRole | undefined): ReadonlySet<Permission> {
  if (!role) return new Set(ALL_PERMISSIONS);
  return new Set(ROLE_PERMISSIONS[role]);
}

/** Module-level access check for route guards and nav filtering. */
export type AppModule = 'tests' | 'analytics' | 'endpoints' | 'settings';

const MODULE_PERMISSIONS: Record<AppModule, Permission> = {
  tests: 'tests:library:read',
  analytics: 'analytics:dashboards:read',
  endpoints: 'endpoints:agents:read',
  settings: 'settings:platform:read',
};

export function canAccessModule(role: AppRole | undefined, module: AppModule): boolean {
  const perms = getPermissionsForRole(role);
  // Endpoints also allows analyst (tasks:read) but not explorer
  if (module === 'endpoints') {
    return perms.has('endpoints:agents:read') || perms.has('endpoints:tasks:read');
  }
  return perms.has(MODULE_PERMISSIONS[module]);
}

export const ROLE_LABELS: Record<AppRole, string> = {
  admin: 'Administrator',
  operator: 'Operator',
  analyst: 'Analyst',
  explorer: 'Explorer',
};

export const ROLE_COLORS: Record<AppRole, string> = {
  admin: 'text-red-700 bg-red-100 dark:text-red-300 dark:bg-red-900/30',
  operator: 'text-blue-700 bg-blue-100 dark:text-blue-300 dark:bg-blue-900/30',
  analyst: 'text-green-700 bg-green-100 dark:text-green-300 dark:bg-green-900/30',
  explorer: 'text-zinc-700 bg-zinc-100 dark:text-zinc-300 dark:bg-zinc-800/50',
};

export const VALID_ROLES: readonly AppRole[] = ['admin', 'operator', 'analyst', 'explorer'];
