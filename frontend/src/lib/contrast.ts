/**
 * WCAG 2.x contrast-ratio utilities for OKLCH color tokens.
 *
 * Chart cell backgrounds are expressed as `oklch(L C H)` CSS custom
 * properties. Picking a legible label color for an arbitrary cell requires
 * computing *actual* relative luminance (which depends on lightness AND
 * chroma/hue, since OKLCH is not perceptually uniform in a way that maps
 * L directly to sRGB luminance) rather than eyeballing an L threshold.
 *
 * Conversion path: OKLCH -> OKLab -> linear sRGB -> relative luminance,
 * using Björn Ottosson's published OKLab <-> linear-sRGB matrices.
 */

export interface LinearRgb {
  R: number;
  G: number;
  B: number;
}

export interface OklchComponents {
  L: number;
  a: number;
  b: number;
}

/** Clamp a linear-sRGB channel to the displayable [0, 1] range. */
function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/**
 * Convert OKLab-space (L, a, b) coordinates to linear sRGB.
 * Constants from https://bottosson.github.io/posts/oklab/
 */
export function oklchToLinearRgb(L: number, a: number, b: number): LinearRgb {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;

  const R = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const G = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const B = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

  return { R: clamp01(R), G: clamp01(G), B: clamp01(B) };
}

/**
 * Parse a CSS `oklch(L C H)` string into OKLab components (L, a, b).
 * `L` may be a bare number (0..1) or a percentage (e.g. `56%`).
 * `C` (chroma) and `H` (hue, degrees) are plain numbers.
 * Returns null if the string can't be parsed (e.g. unresolved custom
 * property, empty string in jsdom, or a non-oklch color).
 */
export function parseOklch(str: string | null | undefined): OklchComponents | null {
  if (!str) return null;
  const match = str.match(
    /oklch\(\s*([\d.]+)(%)?\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*[\d.%]+)?\s*\)/i
  );
  if (!match) return null;

  const [, lRaw, lPercent, cRaw, hRaw] = match;
  const L = lPercent ? Number(lRaw) / 100 : Number(lRaw);
  const C = Number(cRaw);
  const H = Number(hRaw);
  if (Number.isNaN(L) || Number.isNaN(C) || Number.isNaN(H)) return null;

  const hRad = (H * Math.PI) / 180;
  const a = C * Math.cos(hRad);
  const b = C * Math.sin(hRad);
  return { L, a, b };
}

/**
 * Compute WCAG relative luminance (Y) for a CSS `oklch(...)` color string.
 * Returns null if the string is unparseable.
 */
export function relativeLuminance(str: string | null | undefined): number | null {
  const oklch = parseOklch(str);
  if (!oklch) return null;
  const { R, G, B } = oklchToLinearRgb(oklch.L, oklch.a, oklch.b);
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

/**
 * WCAG contrast ratio between two relative luminances, per
 * https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio — (L1 + 0.05) / (L2 + 0.05)
 * with L1 the lighter of the two.
 */
export function contrastRatio(lum1: number, lum2: number): number {
  const hi = Math.max(lum1, lum2);
  const lo = Math.min(lum1, lum2);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Pick whichever candidate label color has the highest computed WCAG
 * contrast against `bgOklch`. Falls back to `candidates[0]` (a safe,
 * deterministic default) if the background or every candidate fails to
 * parse — e.g. in jsdom, where CSS custom properties never resolve to
 * concrete oklch() values.
 */
export function pickAccessibleLabel(bgOklch: string, candidates: string[]): string {
  const bgLum = relativeLuminance(bgOklch);
  if (bgLum === null) return candidates[0];

  let best: string | null = null;
  let bestRatio = -Infinity;
  for (const candidate of candidates) {
    const candLum = relativeLuminance(candidate);
    if (candLum === null) continue;
    const ratio = contrastRatio(bgLum, candLum);
    if (ratio > bestRatio) {
      bestRatio = ratio;
      best = candidate;
    }
  }
  return best ?? candidates[0];
}
