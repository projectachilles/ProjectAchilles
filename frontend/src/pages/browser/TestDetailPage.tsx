import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import DOMPurify from 'dompurify';
import { Loader2 } from 'lucide-react';
import { browserApi } from '@/services/api/browser';
import type { TestDetails } from '@/types/test';
import { useTheme } from '@/hooks/useTheme';
import { useTestPreferences } from '@/hooks/useTestPreferences';
import { useHasPermission } from '@/hooks/useAppRole';
import { ExecutionDrawer } from '@/components/browser/execution';
import { pillClass } from '@/components/shared/ui/pillStyles';
import TestDetailHeader from '@/components/browser/detail/TestDetailHeader';
import DocumentTab from '@/components/browser/detail/DocumentTab';
import OverviewTab from '@/components/browser/detail/overview/OverviewTab';
import { useBuildInfo } from '@/components/browser/detail/useBuildInfo';
import { buildTestTabs, resolveTabSelection, type TestTabId } from '@/components/browser/detail/testTabs';

const TAB_PANEL_ID = 'test-detail-tabpanel';

export default function TestDetailPage() {
  const { uuid } = useParams<{ uuid: string }>();
  if (!uuid) return null;
  // Keyed so every piece of per-test state (diagrams, build, drawer) resets.
  return <TestDetailView key={uuid} uuid={uuid} />;
}

function TestDetailView({ uuid }: { uuid: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  // The Tests list passes its own URL (filters, view) so Back restores it.
  const fromList = (location.state as { backTo?: unknown } | null)?.backTo;
  const backTo = typeof fromList === 'string' && fromList.startsWith('/tests') ? fromList : '/tests';
  const { theme } = useTheme();
  const attackFlowIframeRef = useRef<HTMLIFrameElement>(null);
  const killChainIframeRef = useRef<HTMLIFrameElement>(null);
  const [test, setTest] = useState<TestDetails | null>(null);
  const [attackFlowHtml, setAttackFlowHtml] = useState<string | null>(null);
  const [killChainHtml, setKillChainHtml] = useState<string | null>(null);
  // Diagrams whose fetch failed (until then their tab shows a spinner).
  const [diagramFailed, setDiagramFailed] = useState<Partial<Record<'attack-flow' | 'kill-chain', true>>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { trackView } = useTestPreferences();
  const canBuild = useHasPermission('tests:builds:create');
  const canCreateTasks = useHasPermission('endpoints:tasks:create');
  const [executionDrawerOpen, setExecutionDrawerOpen] = useState(false);
  // The page's only build state: the header's Download and the Deploy panel share it.
  // Fetched only for builders of a test with source (the build route needs
  // tests:builds:read, which read-only roles lack); otherwise inert.
  const hasSource = !!test?.files?.some(f => f.category === 'source');
  const build = useBuildInfo(canBuild && hasSource ? uuid : null);

  const tabs = useMemo(() => (test ? buildTestTabs(test) : []), [test]);
  const selection = resolveTabSelection(tabs, searchParams.get('tab'), searchParams.get('file'));
  const activeTab = tabs.find(t => t.id === selection.tab);

  // A tab or file click is a real history entry (browser Back works). The
  // router state rides along so the breadcrumb keeps the list's `backTo`.
  // Re-clicking the active tab (or the open file) adds no entry.
  const openTab = useCallback((tab: TestTabId, file?: string | null) => {
    if (tab === selection.tab && (!file || file === selection.file)) return;
    const next = new URLSearchParams();
    if (tab !== 'overview') next.set('tab', tab);
    if (file) next.set('file', file);
    setSearchParams(next, { replace: false, state: location.state });
  }, [setSearchParams, location.state, selection.tab, selection.file]);

  // A deep link to a file the tab doesn't have shows the tab's first file;
  // rewrite the URL to match (replace, so Back still leaves the page).
  const requestedFile = searchParams.get('file');
  useEffect(() => {
    if (!test || !selection.file || requestedFile === null || requestedFile === selection.file) return;
    const next = new URLSearchParams(searchParams);
    next.set('file', selection.file);
    setSearchParams(next, { replace: true, state: location.state });
  }, [test, selection.file, requestedFile, searchParams, setSearchParams, location.state]);

  // Sync theme to visualization iframes via postMessage
  const syncThemeToIframe = useCallback(() => {
    const message = { type: 'theme-change', theme };
    if (attackFlowIframeRef.current?.contentWindow) {
      attackFlowIframeRef.current.contentWindow.postMessage(message, window.location.origin);
    }
    if (killChainIframeRef.current?.contentWindow) {
      killChainIframeRef.current.contentWindow.postMessage(message, window.location.origin);
    }
  }, [theme]);

  // Sync theme when it changes or when iframe loads
  useEffect(() => {
    syncThemeToIframe();
  }, [theme, attackFlowHtml, killChainHtml, syncThemeToIframe]);

  useEffect(() => {
    loadTestDetails(uuid);
  }, [uuid]);

  // A diagram is fetched once, the first time its tab is shown.
  const diagramRequested = useRef(new Set<string>());
  useEffect(() => {
    if (!test || diagramRequested.current.has(selection.tab)) return;
    if (selection.tab === 'attack-flow') {
      diagramRequested.current.add(selection.tab);
      loadAttackFlow();
    } else if (selection.tab === 'kill-chain') {
      diagramRequested.current.add(selection.tab);
      loadKillChain();
    }
  }, [selection.tab, test]);

  async function loadTestDetails(testUuid: string) {
    try {
      setLoading(true);
      const data = await browserApi.getTestDetails(testUuid);
      setTest(data);
      trackView(testUuid, data.name);
    } catch (err) {
      setError('Failed to load test details');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function loadAttackFlow() {
    if (!uuid || !test?.hasAttackFlow) return;

    try {
      const html = await browserApi.getAttackFlow(uuid);
      const sanitized = DOMPurify.sanitize(html, {
        ADD_TAGS: ['style'],
        ADD_ATTR: ['class', 'style', 'viewBox', 'xmlns', 'fill', 'stroke', 'd', 'transform'],
        WHOLE_DOCUMENT: true,
      });
      setAttackFlowHtml(sanitized);
    } catch (err) {
      console.error('Failed to load attack flow:', err);
      setDiagramFailed(prev => ({ ...prev, 'attack-flow': true }));
    }
  }

  async function loadKillChain() {
    if (!uuid || !test?.hasKillChain) return;

    try {
      const html = await browserApi.getKillChain(uuid);
      // Kill chain diagrams use Cytoscape.js (loaded from CDN via <script src>).
      // Allow external script src but strip inline scripts and event handlers.
      const sanitized = DOMPurify.sanitize(html, {
        ADD_TAGS: ['script', 'style', 'link'],
        ADD_ATTR: ['src', 'href', 'rel', 'type', 'charset'],
        FORCE_BODY: true,
        WHOLE_DOCUMENT: true,
      });
      setKillChainHtml(sanitized);
    } catch (err) {
      console.error('Failed to load kill chain:', err);
      setDiagramFailed(prev => ({ ...prev, 'kill-chain': true }));
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="flex items-center gap-2 text-sm text-muted">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>Loading test details...</span>
        </div>
      </div>
    );
  }

  if (error || !test) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="text-center">
          <p className="mb-4 text-sm text-danger">{error || 'Test not found'}</p>
          <button
            type="button"
            onClick={() => navigate(backTo)}
            className="inline-flex h-8 items-center rounded-md bg-accent px-3 text-[13px] font-medium text-accent-foreground hover:opacity-90 transition-opacity"
          >
            Back to Tests
          </button>
        </div>
      </div>
    );
  }

  const diagramFallback = diagramFailed[selection.tab as 'attack-flow' | 'kill-chain'] ? (
    <p className="py-12 text-sm text-muted">The diagram could not be loaded.</p>
  ) : (
    <div className="flex items-center gap-2 py-12 text-sm text-muted">
      <Loader2 className="h-4 w-4 animate-spin" />
      <span>Loading...</span>
    </div>
  );

  let content = null;
  if (selection.tab === 'overview') {
    content = <OverviewTab test={test} canBuild={canBuild} build={build} onOpenFile={openTab} />;
  } else if (selection.tab === 'attack-flow') {
    content = attackFlowHtml ? (
      <div className="h-[75vh] overflow-hidden rounded-lg border border-border">
        <iframe
          ref={attackFlowIframeRef}
          srcDoc={attackFlowHtml}
          className="w-full h-full min-h-[60vh] border-0 lg:min-h-0"
          title="Attack Flow Diagram"
          sandbox=""
          onLoad={syncThemeToIframe}
        />
      </div>
    ) : diagramFallback;
  } else if (selection.tab === 'kill-chain') {
    content = killChainHtml ? (
      <div className="h-[75vh] overflow-hidden rounded-lg border border-border">
        <iframe
          ref={killChainIframeRef}
          srcDoc={killChainHtml}
          className="w-full h-full min-h-[60vh] border-0 lg:min-h-0"
          title="Kill Chain Diagram"
          sandbox="allow-scripts"
          onLoad={syncThemeToIframe}
        />
      </div>
    ) : diagramFallback;
  } else if (activeTab && selection.file) {
    content = (
      <DocumentTab
        uuid={uuid}
        testName={test.name}
        tab={activeTab}
        file={selection.file}
        onSelectFile={(file) => openTab(activeTab.id, file)}
      />
    );
  }

  return (
    <div>
      <TestDetailHeader
        test={test}
        backTo={backTo}
        canRun={canCreateTasks}
        onRun={() => setExecutionDrawerOpen(true)}
        canBuild={canBuild}
        hasBuild={!!build.buildInfo?.exists}
        onDownload={() => { void build.download(); }}
      />

      {/* Same container as the header, so the title, tabs and content line up. */}
      <div className="border-b border-border">
        {/* Scrolls sideways on narrow screens instead of wrapping. */}
        <div role="tablist" aria-label="Test sections" className="container mx-auto flex gap-2 overflow-x-auto px-4 py-3">
          {tabs.map(tab => {
            const active = tab.id === selection.tab;
            return (
              <button
                key={tab.id}
                id={`test-tab-${tab.id}`}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls={active ? TAB_PANEL_ID : undefined}
                onClick={() => openTab(tab.id)}
                className={pillClass(active, 'shrink-0')}
              >
                {tab.label}
                {tab.count !== undefined && (
                  <>
                    <span aria-hidden="true" className="rounded bg-overlay px-1 font-mono text-[10px] leading-4 text-faint">{tab.count}</span>
                    <span className="sr-only">{`, ${tab.count} files`}</span>
                  </>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div
        role="tabpanel"
        id={TAB_PANEL_ID}
        aria-labelledby={`test-tab-${selection.tab}`}
        className="container mx-auto px-4 py-5"
      >
        {content}
      </div>

      <ExecutionDrawer
        open={executionDrawerOpen}
        onClose={() => setExecutionDrawerOpen(false)}
        tests={[test]}
      />
    </div>
  );
}
