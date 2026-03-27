// --- Should trigger ---

// ruleid: projectachilles-no-role-elevation
function getPermissionsForRole(role: string | undefined) {
  if (!role) { return allPermissions; }
  return permissionMap[role] ?? [];
}

// ruleid: projectachilles-no-role-elevation
function getRolePermissions(role: string) {
  if (!role) { return Object.values(permissions); }
  return permissions[role];
}

// --- Should NOT trigger ---

// ok: projectachilles-no-role-elevation
function getPermissionsSafe(role: string | undefined) {
  if (!role) { return []; }
  return permissionMap[role] ?? [];
}

// ok: projectachilles-no-role-elevation
function getPermissionsStrict(role: string) {
  if (!role) { throw new Error('Role is required'); }
  return permissionMap[role];
}
