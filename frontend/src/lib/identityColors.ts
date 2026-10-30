import type { IdentityColor } from '@/types/consoleIdentity';

/** Preset console identity colours. Only the key crosses the API. */
export const IDENTITY_PALETTE: Record<Exclude<IdentityColor, 'none'>, { label: string; hex: string }> = {
  violet: { label: 'Violet', hex: '#a78bfa' },
  indigo: { label: 'Indigo', hex: '#818cf8' },
  blue: { label: 'Blue', hex: '#60a5fa' },
  cyan: { label: 'Cyan', hex: '#22d3ee' },
  fuchsia: { label: 'Fuchsia', hex: '#e879f9' },
  pink: { label: 'Pink', hex: '#f472b6' },
  orange: { label: 'Orange', hex: '#fb923c' },
  silver: { label: 'Silver', hex: '#cbd5e1' },
};

/** Text colour used on top of any preset fill. */
export const IDENTITY_CHIP_TEXT = '#0b0b10';

export function identityHex(color: IdentityColor): string | null {
  return color === 'none' ? null : IDENTITY_PALETTE[color].hex;
}
