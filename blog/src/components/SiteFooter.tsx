export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-6 font-mono text-xs text-muted">
        <span>© {new Date().getFullYear()} F0RT1KA · ProjectAchilles</span>
        <a href="/feed.xml" className="transition-colors hover:text-foreground">
          rss
        </a>
      </div>
    </footer>
  );
}
