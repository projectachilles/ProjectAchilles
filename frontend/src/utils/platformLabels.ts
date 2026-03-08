// Shared platform/target label utilities for security test metadata.
// Centralizes the mapping from machine-readable target identifiers
// (e.g. "windows-endpoint") to display labels used across the UI.

/** Full display labels — used in filter dropdowns and detail pages */
export const TARGET_LABELS: Record<string, string> = {
  'windows-endpoint': 'Windows',
  'linux-server': 'Linux',
  'linux-endpoint': 'Linux',
  'entra-id': 'Entra ID',
  'azure-ad': 'Azure AD',
  'active-directory': 'Active Directory',
  'macos-endpoint': 'macOS',
  'm365': 'M365',
  'microsoft-365': 'M365',
  'exchange-online': 'Exchange Online',
  'sharepoint-online': 'SharePoint Online',
  'network': 'Network',
};

/** Compact labels — used on cards where space is limited */
export const TARGET_SHORT_LABELS: Record<string, string> = {
  'windows-endpoint': 'Win',
  'linux-server': 'Linux',
  'linux-endpoint': 'Linux',
  'entra-id': 'Entra',
  'azure-ad': 'Azure AD',
  'active-directory': 'AD',
  'macos-endpoint': 'macOS',
  'm365': 'M365',
  'microsoft-365': 'M365',
  'exchange-online': 'Exchange',
  'sharepoint-online': 'SharePoint',
  'network': 'Net',
};

/** Dot colors for platform indicators (Tailwind text-color classes) */
export const TARGET_COLORS: Record<string, string> = {
  'windows-endpoint': 'text-blue-500',
  'linux-server': 'text-orange-500',
  'linux-endpoint': 'text-orange-500',
  'entra-id': 'text-cyan-500',
  'azure-ad': 'text-cyan-500',
  'active-directory': 'text-cyan-400',
  'macos-endpoint': 'text-gray-400',
  'm365': 'text-purple-500',
  'microsoft-365': 'text-purple-500',
  'exchange-online': 'text-purple-400',
  'sharepoint-online': 'text-purple-400',
  'network': 'text-green-500',
};

/** Full label with title-case fallback for unknown targets */
export function targetLabel(raw: string): string {
  return TARGET_LABELS[raw] || raw.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/** Short label with title-case fallback for unknown targets */
export function targetShortLabel(raw: string): string {
  return TARGET_SHORT_LABELS[raw] || raw.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/** Color class for a target, defaulting to muted gray */
export function targetColor(raw: string): string {
  return TARGET_COLORS[raw] || 'text-muted-foreground';
}
