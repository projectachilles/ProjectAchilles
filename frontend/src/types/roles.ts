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
  | 'analytics:risk:read'
  | 'analytics:risk:write'
  | 'settings:users:manage';

const ALL_PERMISSIONS: readonly Permission[] = [
  'tests:library:read', 'tests:builds:read', 'tests:builds:create', 'tests:builds:delete', 'tests:sync:execute',
  'analytics:dashboards:read', 'analytics:settings:read', 'analytics:settings:write', 'analytics:index:create',
  'analytics:risk:read', 'analytics:risk:write',
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
    'analytics:dashboards:read', 'analytics:settings:read', 'analytics:risk:read', 'analytics:risk:write',
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
    'analytics:dashboards:read', 'analytics:settings:read', 'analytics:risk:read',
    'endpoints:tasks:read', 'endpoints:tasks:notes',
    'settings:platform:read',
  ],
  explorer: [
    'tests:library:read',
    'analytics:dashboards:read', 'analytics:settings:read',
    'settings:platform:read',
  ],
};

export function getPermissionsForRole(role: AppRole | undefined): ReadonlySet<Permission> {
  if (!role) return new Set(ROLE_PERMISSIONS.explorer);
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

export const ROLE_DESCRIPTIONS: Record<AppRole, string> = {
  admin: 'Full platform access including user management and destructive actions',
  operator: 'Day-to-day operations — builds, agents, tasks (no deletions or user management)',
  analyst: 'Read-only dashboards and task notes',
  explorer: 'View-only test library and analytics',
};

export interface PermissionCategory {
  label: string;
  permissions: { key: Permission; label: string }[];
}

export const PERMISSION_CATEGORIES: PermissionCategory[] = [
  {
    label: 'Test Browser',
    permissions: [
      { key: 'tests:library:read', label: 'View test library' },
      { key: 'tests:builds:read', label: 'View builds' },
      { key: 'tests:builds:create', label: 'Create builds' },
      { key: 'tests:builds:delete', label: 'Delete builds' },
      { key: 'tests:sync:execute', label: 'Sync test repository' },
    ],
  },
  {
    label: 'Analytics',
    permissions: [
      { key: 'analytics:dashboards:read', label: 'View dashboards' },
      { key: 'analytics:settings:read', label: 'View ES settings' },
      { key: 'analytics:settings:write', label: 'Modify ES settings' },
      { key: 'analytics:index:create', label: 'Create indices' },
      { key: 'analytics:risk:read', label: 'View risk acceptances' },
      { key: 'analytics:risk:write', label: 'Manage risk acceptances' },
    ],
  },
  {
    label: 'Endpoints',
    permissions: [
      { key: 'endpoints:agents:read', label: 'View agents' },
      { key: 'endpoints:agents:write', label: 'Edit agents' },
      { key: 'endpoints:agents:delete', label: 'Delete agents' },
      { key: 'endpoints:tokens:create', label: 'Create enrollment tokens' },
      { key: 'endpoints:tokens:delete', label: 'Delete enrollment tokens' },
      { key: 'endpoints:tasks:read', label: 'View tasks' },
      { key: 'endpoints:tasks:create', label: 'Create tasks' },
      { key: 'endpoints:tasks:cancel', label: 'Cancel tasks' },
      { key: 'endpoints:tasks:delete', label: 'Delete tasks' },
      { key: 'endpoints:tasks:notes', label: 'Add task notes' },
      { key: 'endpoints:tasks:command', label: 'Send agent commands' },
      { key: 'endpoints:schedules:read', label: 'View schedules' },
      { key: 'endpoints:schedules:create', label: 'Create schedules' },
      { key: 'endpoints:schedules:write', label: 'Edit schedules' },
      { key: 'endpoints:schedules:delete', label: 'Delete schedules' },
      { key: 'endpoints:versions:read', label: 'View agent versions' },
      { key: 'endpoints:versions:create', label: 'Upload agent versions' },
      { key: 'endpoints:versions:delete', label: 'Delete agent versions' },
    ],
  },
  {
    label: 'Settings',
    permissions: [
      { key: 'settings:platform:read', label: 'View platform settings' },
      { key: 'settings:platform:write', label: 'Modify platform settings' },
      { key: 'settings:certificates:read', label: 'View certificates' },
      { key: 'settings:certificates:create', label: 'Upload certificates' },
      { key: 'settings:certificates:delete', label: 'Delete certificates' },
      { key: 'settings:users:manage', label: 'Manage users & roles' },
    ],
  },
];
