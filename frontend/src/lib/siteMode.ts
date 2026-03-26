/**
 * Site mode detection.
 *
 * 'marketing' — static landing page at projectachilles.io (no Clerk, no backend)
 * 'app'       — deployed ProjectAchilles instance with Clerk auth (default)
 *
 * Set via VITE_SITE_MODE env var or window.__env__.VITE_SITE_MODE (Docker runtime injection).
 */

export type SiteMode = 'marketing' | 'app';

export const SITE_MODE: SiteMode =
  (window.__env__?.VITE_SITE_MODE || import.meta.env.VITE_SITE_MODE) === 'marketing'
    ? 'marketing'
    : 'app';

export const isMarketingMode = SITE_MODE === 'marketing';
export const isAppMode = SITE_MODE === 'app';
