import Link from 'next/link';
import { ThemeToggle } from './ThemeToggle';

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-10 border-b border-border bg-background/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
        <Link href="/" className="font-display text-sm font-bold tracking-tight">
          ProjectAchilles<span className="text-accent">·</span>
          <span className="text-muted">blog</span>
        </Link>
        <nav className="flex items-center gap-4 font-mono text-xs text-muted">
          <a href="https://docs.projectachilles.io" className="transition-colors hover:text-foreground">
            docs
          </a>
          <a href="https://projectachilles.io" className="transition-colors hover:text-foreground">
            platform
          </a>
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}
