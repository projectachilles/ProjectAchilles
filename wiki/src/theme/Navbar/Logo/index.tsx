import type {ReactNode} from 'react';
import Link from '@docusaurus/Link';

/**
 * Navbar brand — overrides the classic theme's Navbar/Logo (Docusaurus picks
 * up `src/theme/**` automatically, no swizzle needed).
 *
 * Renders the console wordmark exactly as `frontend/src/lib/brand.ts` +
 * AppShell do: the part before the first underscore in the foreground colour,
 * `_suffix` in accent, then a pulsing block cursor. Styling lives in
 * `src/css/custom.css` under "Brand block".
 */
export default function NavbarLogo(): ReactNode {
  return (
    <Link
      to="/"
      className="f0-brand navbar__brand"
      aria-label="ProjectAchilles documentation — home">
      <span className="f0-brand__mark">
        <span className="f0-brand__prefix">f0</span>
        <span className="f0-brand__suffix">_csv</span>
        <span className="f0-brand__cursor" aria-hidden="true" />
      </span>
      <span className="f0-brand__caption">docs</span>
    </Link>
  );
}
