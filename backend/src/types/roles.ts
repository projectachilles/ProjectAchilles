/**
 * Role-Based Access Control (RBAC) definitions.
 *
 * Roles are stored in Clerk publicMetadata and embedded in JWTs via session claims.
 * If a user has no role assigned, they retain full Administrator access (migration safety).
 */

export type AppRole = 'admin' | 'operator' | 'analyst' | 'explorer';

/** Atomic permission strings using module:resource:action format. */
export type Permission =
  // Tests module
  | 'tests:library:read'
  | 'tests:builds:read'
  | 'tests:builds:create'
  | 'tests:builds:delete'
  | 'tests:sync:execute'
  // Analytics module
  | 'analytics:dashboards:read'
  | 'analytics:settings:read'
  | 'analytics:settings:write'
  | 'analytics:index:create'
  | 'analytics:executions:archive'
  // Endpoints module
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
  // Settings module
  | 'settings:platform:read'
  | 'settings:platform:write'
  | 'settings:certificates:read'
  | 'settings:certificates:create'
  | 'settings:certificates:delete'
  | 'settings:users:manage';

/** Full permission set — every Permission value. */
const ALL_PERMISSIONS: readonly Permission[] = [
  'tests:library:read',
  'tests:builds:read',
  'tests:builds:create',
  'tests:builds:delete',
  'tests:sync:execute',
  'analytics:dashboards:read',
  'analytics:settings:read',
  'analytics:settings:write',
  'analytics:index:create',
  'analytics:executions:archive',
  'endpoints:agents:read',
  'endpoints:agents:write',
  'endpoints:agents:delete',
  'endpoints:tokens:create',
  'endpoints:tokens:delete',
  'endpoints:tasks:read',
  'endpoints:tasks:create',
  'endpoints:tasks:cancel',
  'endpoints:tasks:delete',
  'endpoints:tasks:notes',
  'endpoints:tasks:command',
  'endpoints:schedules:read',
  'endpoints:schedules:create',
  'endpoints:schedules:write',
  'endpoints:schedules:delete',
  'endpoints:versions:read',
  'endpoints:versions:create',
  'endpoints:versions:delete',
  'settings:platform:read',
  'settings:platform:write',
  'settings:certificates:read',
  'settings:certificates:create',
  'settings:certificates:delete',
  'settings:users:manage',
] as const;

/**
 * Maps each role to its granted permissions.
 * Permissions are additive — higher roles include all lower-role permissions.
 */
export const ROLE_PERMISSIONS: Record<AppRole, readonly Permission[]> = {
  admin: ALL_PERMISSIONS,

  operator: [
    // Tests — full read, build, sync (no delete)
    'tests:library:read',
    'tests:builds:read',
    'tests:builds:create',
    'tests:sync:execute',
    // Analytics — full read + settings read (no settings write, no index create)
    'analytics:dashboards:read',
    'analytics:settings:read',
    // Endpoints — full read/write/create, cancel tasks (no deletes, no command tasks)
    'endpoints:agents:read',
    'endpoints:agents:write',
    'endpoints:tokens:create',
    'endpoints:tasks:read',
    'endpoints:tasks:create',
    'endpoints:tasks:cancel',
    'endpoints:tasks:notes',
    'endpoints:schedules:read',
    'endpoints:schedules:create',
    'endpoints:schedules:write',
    'endpoints:versions:read',
    'endpoints:versions:create',
    // Settings — read certs and platform, create certs (no delete, no users, no write platform)
    'settings:platform:read',
    'settings:certificates:read',
    'settings:certificates:create',
  ],

  analyst: [
    // Tests — read-only
    'tests:library:read',
    // Analytics — full read
    'analytics:dashboards:read',
    'analytics:settings:read',
    // Endpoints — tasks read-only + notes
    'endpoints:tasks:read',
    'endpoints:tasks:notes',
    // Settings — read-only integrations (see ES connection status)
    'settings:platform:read',
  ],

  explorer: [
    // Tests — read-only
    'tests:library:read',
    // Analytics — full read
    'analytics:dashboards:read',
    'analytics:settings:read',
    // Settings — read-only integrations (see ES connection status)
    'settings:platform:read',
  ],
} as const;

/** Returns the permission set for a role. If role is undefined, returns ALL permissions (migration safety). */
export function getPermissionsForRole(role: AppRole | undefined): ReadonlySet<Permission> {
  if (!role) return new Set(ALL_PERMISSIONS);
  return new Set(ROLE_PERMISSIONS[role]);
}

/** Checks whether a role (or undefined = full access) has ALL of the given permissions. */
export function hasPermissions(role: AppRole | undefined, ...permissions: Permission[]): boolean {
  const granted = getPermissionsForRole(role);
  return permissions.every(p => granted.has(p));
}

export const VALID_ROLES: readonly AppRole[] = ['admin', 'operator', 'analyst', 'explorer'] as const;
