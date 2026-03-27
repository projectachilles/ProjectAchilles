import { describe, it, expect } from 'vitest';
import { getPermissionsForRole, hasPermissions, ROLE_PERMISSIONS } from '../../types/roles.js';
import type { Permission } from '../../types/roles.js';

describe('getPermissionsForRole', () => {
  it('returns explorer permissions when role is undefined (PA-001 fix)', () => {
    const perms = getPermissionsForRole(undefined);
    const explorerPerms = new Set(ROLE_PERMISSIONS.explorer);
    expect(perms).toEqual(explorerPerms);
  });

  it('does NOT return all permissions for undefined role', () => {
    const perms = getPermissionsForRole(undefined);
    // endpoints:tasks:command is admin-only — must NOT be granted to undefined role
    expect(perms.has('endpoints:tasks:command' as Permission)).toBe(false);
    expect(perms.has('settings:users:manage' as Permission)).toBe(false);
    expect(perms.has('integrations:write' as Permission)).toBe(false);
  });

  it('returns all permissions for admin role', () => {
    const perms = getPermissionsForRole('admin');
    expect(perms.has('endpoints:tasks:command' as Permission)).toBe(true);
    expect(perms.has('settings:users:manage' as Permission)).toBe(true);
    expect(perms.has('integrations:write' as Permission)).toBe(true);
  });

  it('returns correct permissions for each defined role', () => {
    for (const [role, expected] of Object.entries(ROLE_PERMISSIONS)) {
      const perms = getPermissionsForRole(role as any);
      expect(perms.size).toBe(expected.length);
      for (const perm of expected) {
        expect(perms.has(perm)).toBe(true);
      }
    }
  });
});

describe('hasPermissions', () => {
  it('denies dangerous permissions for undefined role (PA-001)', () => {
    expect(hasPermissions(undefined, 'endpoints:tasks:command' as Permission)).toBe(false);
    expect(hasPermissions(undefined, 'settings:users:manage' as Permission)).toBe(false);
  });

  it('grants read-only permissions for undefined role', () => {
    expect(hasPermissions(undefined, 'tests:library:read' as Permission)).toBe(true);
    expect(hasPermissions(undefined, 'analytics:dashboards:read' as Permission)).toBe(true);
  });

  it('grants all permissions for admin', () => {
    expect(hasPermissions('admin', 'endpoints:tasks:command' as Permission)).toBe(true);
    expect(hasPermissions('admin', 'settings:users:manage' as Permission)).toBe(true);
  });
});
