export const IDENTITY_COLORS = ['violet', 'indigo', 'blue', 'cyan', 'fuchsia', 'pink', 'orange', 'silver'] as const;
export type IdentityColor = (typeof IDENTITY_COLORS)[number] | 'none';
export type IdentitySource = 'saved' | 'env' | 'none';

export interface ConsoleIdentity {
  code: string | null;
  name: string | null;
  color: IdentityColor;
  source: IdentitySource;
}

export interface ConsoleIdentityInput {
  code: string;
  name: string | null;
  color: IdentityColor;
}
