import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { browserApi } from '@/services/api/browser';
import type { FileContent, TestDetails, TestFile } from '@/types/test';
import { Icon, I } from '@/components/layout/AchillesShell';
import FileViewer from '@/components/browser/FileViewer';
import { useTestPreferences } from '@/hooks/useTestPreferences';
import { useHasPermission } from '@/hooks/useAppRole';
import { ExecutionDrawer } from '@/components/browser/execution';
import { buildKillChain, tacticCaption, type KillChainCell } from './killChain';
import { categoryColor, scoreClass, relTime } from './utils';
import './tests.css';

interface FileGroup {
  key: string;
  label: string;
  files: TestFile[];
}

const TYPE_TAGS: Record<string, { tag: string; color: string }> = {
  kql: { tag: 'KQL', color: '#4f8eff' },
  yara: { tag: 'YARA', color: '#ffaa2e' },
  sigma: { tag: 'SIGMA', color: '#a78bfa' },
  ndjson: { tag: 'ELASTIC', color: '#22d3ee' },
};

const GROUP_ORDER: { key: TestFile['category']; label: string }[] = [
  { key: 'documentation', label: 'Documentation' },
  { key: 'source', label: 'Source Code' },
  { key: 'detection', label: 'Detection Rules' },
  { key: 'defense', label: 'Defense Guidance' },
  { key: 'config', label: 'Configuration' },
  { key: 'references', label: 'References' },
  { key: 'diagram', label: 'Diagrams' },
  { key: 'other', label: 'Other' },
];

function groupFiles(files: TestFile[] | undefined): FileGroup[] {
  if (!files) return [];
  const groups: FileGroup[] = [];
  for (const meta of GROUP_ORDER) {
    const matching = files.filter((f) => f.category === meta.key);
    if (matching.length > 0) {
      groups.push({ key: meta.key, label: meta.label, files: matching });
    }
  }
  return groups;
}

export default function TestDetailPage() {
  const { uuid } = useParams<{ uuid: string }>();
  const navigate = useNavigate();
  const { isFavorite, toggleFavorite, trackView } = useTestPreferences();
  const canCreateTasks = useHasPermission('endpoints:tasks:create');

  const [test, setTest] = useState<TestDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<FileContent | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  const [drawerOpen, setDrawerOpen] = useState(false);

  const [activeStageIdx, setActiveStageIdx] = useState<number>(0);

  // ── Load test details ──
  useEffect(() => {
    if (!uuid) return;
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const data = await browserApi.getTestDetails(uuid);
        if (cancelled) return;
        setTest(data);
        trackView(uuid, data.name);

        // Auto-select README, then first doc file, then first file overall.
        const readme = data.files.find((f) => f.name.toLowerCase() === 'readme.md');
        const firstDoc = data.files.find((f) => f.category === 'documentation');
        const initial = readme?.name ?? firstDoc?.name ?? data.files[0]?.name ?? null;
        setActiveFile(initial);

        // Open the group that contains the initial file (default: documentation).
        const initialGroup =
          (initial && data.files.find((f) => f.name === initial)?.category) || 'documentation';
        setOpenGroups({ [initialGroup]: true });
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load test');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [uuid, trackView]);

  // ── Lazy-load file content when a file is selected ──
  useEffect(() => {
    if (!uuid || !activeFile) {
      setFileContent(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        setFileLoading(true);
        const content = await browserApi.getFileContent(uuid, activeFile);
        if (!cancelled) setFileContent(content);
      } catch {
        if (!cancelled) setFileContent(null);
      } finally {
        if (!cancelled) setFileLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [uuid, activeFile]);

  const fileGroups = useMemo(() => groupFiles(test?.files), [test?.files]);
  const killChain: KillChainCell[] = useMemo(() => buildKillChain(test), [test]);
  const usedStages = useMemo(() => killChain.filter((c) => c.used), [killChain]);

  // Default the active stage to the first one with steps so the panel is never empty.
  useEffect(() => {
    if (usedStages.length === 0) {
      setActiveStageIdx(0);
      return;
    }
    const firstWithSteps = usedStages.findIndex((c) => c.steps.length > 0);
    setActiveStageIdx(firstWithSteps >= 0 ? firstWithSteps : 0);
  }, [usedStages]);

  // ── Render ──
  if (loading) {
    return (
      <div className="tm-page">
        <div className="tm-loading">
          <span className="tm-spinner" />
          <span>Loading test details…</span>
        </div>
      </div>
    );
  }

  if (error || !test) {
    return (
      <div className="tm-page">
        <div className="tm-empty">
          <span className="tm-empty-title">Test not found</span>
          <span>{error ?? 'No data returned for this UUID.'}</span>
          <button type="button" className="tm-reset-btn" onClick={() => navigate('/browser')}>
            Back to tests
          </button>
        </div>
      </div>
    );
  }

  const fav = isFavorite(test.uuid);
  const activeStage = usedStages[activeStageIdx];

  const breadcrumbName = activeFile ?? '—';
  const breadcrumbMeta = fileContent
    ? `${(fileContent.size ?? fileContent.content.length).toLocaleString()} bytes · ${
        fileContent.type ?? 'text'
      }`
    : '';

  return (
    <div className="tm-page">
      <button type="button" className="tm-back" onClick={() => navigate('/browser')}>
        <Icon size={11}>{I.chevronLeft}</Icon>
        <span>Back to tests</span>
      </button>

      {/* Hero strip */}
      <div className="tm-detail-hero">
        <div className="tm-hero-idrow">
          <span className="tm-hero-id">{test.uuid.slice(0, 8)}</span>
          {test.severity && (
            <span className={`sev-pill sev-bg-${test.severity} sev-md`}>{test.severity}</span>
          )}
          {test.category && (
            <span className="tm-cell-cat">
              <span
                className="tm-cell-cat-dot"
                style={{ background: categoryColor(test.category) }}
              />
              {test.category}
            </span>
          )}
          <span className="tm-hero-uuid font-mono">{test.uuid}</span>
        </div>

        <div className="tm-hero-head">
          <h1 className="tm-hero-title">{test.name}</h1>
          <div className="tm-hero-actions">
            <button
              type="button"
              className={`tm-hero-iconbtn ${fav ? 'is-fav' : ''}`}
              title={fav ? 'Remove from favorites' : 'Add to favorites'}
              aria-label={fav ? 'Remove from favorites' : 'Add to favorites'}
              aria-pressed={fav}
              onClick={() => toggleFavorite(test.uuid)}
            >
              <Icon size={14} fill={fav ? 'currentColor' : 'none'}>
                {I.star}
              </Icon>
            </button>
            {canCreateTasks && (
              <button
                type="button"
                className="tm-run-btn"
                onClick={() => setDrawerOpen(true)}
              >
                <Icon size={11} fill="currentColor" sw={0}>
                  {I.play}
                </Icon>
                <span>Run test</span>
              </button>
            )}
            {test.score != null && (
              <div className="tm-hero-score">
                <Icon size={14} fill="currentColor" sw={0}>
                  {I.star}
                </Icon>
                <div className="tm-hero-score-val">
                  <strong className={scoreClass(test.score)}>{test.score.toFixed(1)}</strong>
                  <span className="tac-label">Test Score</span>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="tm-hero-meta">
          {test.author && (
            <span className="tm-hero-meta-item">
              <Icon size={11}>{I.user}</Icon>
              <span>{test.author}</span>
            </span>
          )}
          {test.createdDate && (
            <span className="tm-hero-meta-item">
              <Icon size={11}>{I.clock}</Icon>
              <span>{test.createdDate}</span>
            </span>
          )}
          {test.lastModifiedDate && (
            <span className="tm-hero-meta-item">
              <span className="dot" style={{ background: 'var(--accent)' }} />
              <span>Modified {relTime(test.lastModifiedDate)}</span>
            </span>
          )}
          {test.threatActor && (
            <span className="tm-hero-meta-item tm-hero-actor">
              <Icon size={11}>{I.target}</Icon>
              <span>{test.threatActor}</span>
            </span>
          )}
          {Array.isArray(test.target) && test.target.length > 0 && (
            <span className="tm-hero-meta-item">
              <Icon size={11}>{I.monitor}</Icon>
              <span>{test.target.join(', ')}</span>
            </span>
          )}
        </div>

        {Array.isArray(test.techniques) && test.techniques.length > 0 && (
          <div className="tm-hero-techs" aria-label="MITRE techniques">
            {test.techniques.map((tid) => (
              <span key={tid} className="tm-hero-tech">
                <strong>{tid}</strong>
              </span>
            ))}
          </div>
        )}

        {test.description && <p className="tm-hero-desc">{test.description}</p>}
      </div>

      {/* Two-column body */}
      <div className="tm-detail-shell">
        {/* Files & Documentation panel */}
        <section className="tm-files-panel" aria-label="Files and documentation">
          <header className="tm-files-panel-head">
            <span className="tm-panel-title">
              <span className="accent-dot" />
              Files &amp; Documentation
            </span>
            <span className="tm-cell-when">{test.files.length} file{test.files.length === 1 ? '' : 's'}</span>
          </header>

          <div className="tm-files-body">
            <aside className="tm-tree" aria-label="File tree">
              {fileGroups.length === 0 && (
                <span className="tm-cell-when">No files in this test bundle.</span>
              )}
              {fileGroups.map((g) => {
                const open = openGroups[g.key] !== false; // default open on first render
                return (
                  <div key={g.key} className="tm-tree-group">
                    <button
                      type="button"
                      className="tm-tree-head"
                      onClick={() =>
                        setOpenGroups((prev) => ({ ...prev, [g.key]: !open }))
                      }
                      aria-expanded={open}
                    >
                      <Icon size={10} sw={2.4}>
                        {open ? I.chevronDown : I.chevronRight}
                      </Icon>
                      <span className="tm-tree-name">{g.label}</span>
                      <span className="tm-tree-count">{g.files.length}</span>
                    </button>
                    {open && (
                      <ul className="tm-tree-items">
                        {g.files.map((f) => {
                          const tag = TYPE_TAGS[f.type];
                          const active = activeFile === f.name;
                          return (
                            <li
                              key={f.name}
                              className={`tm-tree-item ${active ? 'is-active' : ''}`}
                              onClick={() => setActiveFile(f.name)}
                              tabIndex={0}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  setActiveFile(f.name);
                                }
                              }}
                            >
                              {tag && (
                                <span className="tm-tree-tag" style={{ color: tag.color }}>
                                  {tag.tag}
                                </span>
                              )}
                              <span className="tm-tree-fn">{f.name}</span>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                );
              })}
            </aside>

            <div className="tm-viewer">
              {/* Tab strip — mirrors the active file path so the user can see
                  which document they're reading and can copy it quickly. */}
              <div className="tm-viewer-tabs" role="tablist">
                {fileGroups.map((g) => (
                  <button
                    key={g.key}
                    type="button"
                    role="tab"
                    className={`tm-vtab ${
                      g.files.some((f) => f.name === activeFile) ? 'is-active' : ''
                    }`}
                    onClick={() => {
                      const first = g.files[0];
                      if (first) setActiveFile(first.name);
                    }}
                  >
                    {g.label}
                  </button>
                ))}
              </div>

              <div className="tm-viewer-toolbar">
                <div className="tm-viewer-bc" title={activeFile ?? ''}>
                  <Icon size={11}>{I.book}</Icon>
                  <span className="font-mono">{breadcrumbName}</span>
                  {breadcrumbMeta && <span className="bc-meta">· {breadcrumbMeta}</span>}
                </div>
                <div className="tm-viewer-tools">
                  <button
                    type="button"
                    className="tm-iconbtn"
                    title="Copy file path"
                    onClick={() => {
                      if (activeFile) {
                        void navigator.clipboard?.writeText(activeFile);
                      }
                    }}
                    disabled={!activeFile}
                  >
                    <Icon size={11}>{I.bookmark}</Icon>
                  </button>
                </div>
              </div>

              <div className="tm-viewer-content">
                {fileLoading ? (
                  <div className="tm-loading">
                    <span className="tm-spinner" />
                    <span>Loading {activeFile}…</span>
                  </div>
                ) : fileContent ? (
                  <FileViewer file={fileContent} />
                ) : (
                  <div className="tm-viewer-empty">
                    Select a file from the tree to view its content.
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Kill Chain panel */}
        <section className="tm-kc-panel" aria-label="Kill chain">
          <header className="tm-kc-panel-head">
            <span className="tm-panel-title">
              <span className="accent-dot" />
              Kill Chain
            </span>
            <span className="tm-cell-when">
              {usedStages.length} stage{usedStages.length === 1 ? '' : 's'} used
            </span>
          </header>

          <div className="tm-kc-stagestrip" role="tablist" aria-label="Kill chain stages">
            {killChain.map((cell, idx) => {
              const usedIndex = usedStages.indexOf(cell);
              const isActive = usedIndex === activeStageIdx && cell.used;
              return (
                <button
                  key={cell.tactic.slug}
                  type="button"
                  role="tab"
                  className={`tm-kc-stagechip ${cell.used ? 'is-used' : ''} ${
                    isActive ? 'is-active' : ''
                  }`}
                  onClick={() => {
                    if (cell.used && usedIndex >= 0) setActiveStageIdx(usedIndex);
                  }}
                  disabled={!cell.used}
                  aria-selected={isActive}
                  title={cell.tactic.name}
                >
                  <span className="tm-kc-stagechip-name">{cell.tactic.shortName}</span>
                  <span className="tm-kc-stagechip-count">
                    {cell.steps.length > 0
                      ? `${cell.steps.length} step${cell.steps.length === 1 ? '' : 's'}`
                      : cell.used
                      ? 'used'
                      : ''}
                  </span>
                  <span className="sr-only">{idx + 1}</span>
                </button>
              );
            })}
          </div>

          <div className="tm-kc-detail">
            {activeStage ? (
              <>
                <div className="tm-kc-stage-title">
                  <span>{activeStage.tactic.name}</span>
                  <span className="tac-label">{activeStage.tactic.id}</span>
                </div>
                {activeStage.steps.length === 0 ? (
                  <div className="tm-kc-empty">
                    This tactic is declared by the test but no per-stage steps were extracted from
                    the test bundle.
                  </div>
                ) : (
                  activeStage.steps.map((step, i) => (
                    <div
                      key={`${step.stageId}-${step.fileName}`}
                      className="tm-kc-step"
                      tabIndex={0}
                    >
                      <span className="tm-kc-step-n">
                        {String(step.stageId || i + 1).padStart(2, '0')}
                      </span>
                      <div className="tm-kc-step-body">
                        <span className="tm-kc-step-cmd" title={step.fileName}>
                          {step.name || step.fileName}
                        </span>
                        <span className="tm-kc-step-out">
                          {tacticCaption(activeStage.tactic.slug)}
                          {step.fileName ? ` · ${step.fileName}` : ''}
                        </span>
                      </div>
                      {step.technique && (
                        <span className="tm-kc-step-tech">{step.technique}</span>
                      )}
                    </div>
                  ))
                )}
              </>
            ) : (
              <div className="tm-kc-empty">
                This test does not declare any MITRE tactics. Add a <code>TACTICS:</code> entry to
                the test header to populate the kill chain.
              </div>
            )}
          </div>
        </section>
      </div>

      <ExecutionDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        tests={[test]}
      />
    </div>
  );
}
