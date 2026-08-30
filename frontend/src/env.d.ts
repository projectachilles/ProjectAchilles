interface Window {
  __env__?: {
    VITE_CLERK_PUBLISHABLE_KEY?: string;
    VITE_API_URL?: string;
    VITE_SITE_MODE?: string;
  };
}

interface ImportMetaEnv {
  readonly VITE_BRAND_WORDMARK?: string;
  readonly VITE_BRAND_TAGLINE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
