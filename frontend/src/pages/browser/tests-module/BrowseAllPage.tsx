import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { browserApi } from '@/services/api/browser';
import type { TestMetadata } from '@/types/test';
import { Icon, I } from '@/components/layout/AchillesShell';
import { useTestPreferences } from '@/hooks/useTestPreferences';
import { useHasPermission } from '@/hooks/useAppRole';
import { ExecutionDrawer } from '@/components/browser/execution';
import {
  categoryColor,
  scoreClass,
  severityRank,
  relTime,
  SORT_OPTIONS,
  type SortField,
} from './utils';
import './tests.css';

const SEVERITIES: { id: string; label: string }[] = [
  { id: 'critical', label: 'Critical' },
  { id: 'high', label: 'High' },
  { id: 'medium', label: 'Medium' },
  { id: 'low', label: 'Low' },
];

/** Read a CSV-encoded set from a URL search param. */
function paramSet(searchParams: URLSearchParams, key: string): Set<string> {
  const raw = searchParams.get(key);
  if (!raw) return new Set();
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
}

export default function BrowseAllPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { isFavorite, toggleFavorite } = useTestPreferences();
  const canCreateTasks = useHasPermission('endpoints:tasks:create');

  const [tests, setTests] = useState<TestMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [drawerTests, setDrawerTests] = useState<TestMetadata[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // ── Filter state read from URL (so it survives refresh / is shareable) ──
  const search = searchParams.get('q') ?? '';
  const severities = paramSet(searchParams, 'sev');
  const categories = paramSet(searchParams, 'cat');
  const technique = (searchParams.get('tech') ?? '').toUpperCase();
  const sort: SortField = ((): SortField => {
    const raw = (searchParams.get('sort') ?? 'modified').toLowerCase();
    return ['modified', 'score', 'severity', 'name'].includes(raw)
      ? (raw as SortField)
      : 'modified';
  })();

  function patchParams(patch: (next: URLSearchParams) => void) {
    const next = new URLSearchParams(searchParams);
    patch(next);
    // Strip empty values so URLs stay clean.
    for (const key of Array.from(next.keys())) {
      const v = next.get(key);
      if (v == null || v === '') next.delete(key);
    }
    setSearchParams(next, { replace: true });
  }

  function setSearch(q: string) {
    patchParams((p) => {
      if (q) p.set('q', q);
      else p.delete('q');
    });
  }

  function toggleSet(key: 'sev' | 'cat', value: string) {
    const current = paramSet(searchParams, key);
    if (current.has(value)) current.delete(value);
    else current.add(value);
    patchParams((p) => {
      if (current.size === 0) p.delete(key);
      else p.set(key, Array.from(current).join(','));
    });
  }

  function setTechnique(t: string) {
    patchParams((p) => {
      if (t && t !== 'all') p.set('tech', t.toUpperCase());
      else p.delete('tech');
    });
  }

  function setSort(s: SortField) {
    patchParams((p) => p.set('sort', s));
  }

  function resetFilters() {
    setSearchParams(new URLSearchParams(), { replace: true });
  }

  // ── Load catalog once ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const data = await browserApi.getAllTests();
        if (!cancelled) setTests(data);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load tests');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Derived: categories + technique options + filtered/sorted list ──
  const categoryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const t of tests) if (t.category) set.add(t.category);
    return Array.from(set).sort();
  }, [tests]);

  const techniqueOptions = useMemo(() => {
    const set = new Set<string>();
    for (const t of tests) {
      if (Array.isArray(t.techniques)) {
        for (const tid of t.techniques) if (tid) set.add(tid);
      }
    }
    return Array.from(set).sort();
  }, [tests]);

  const filtered = useMemo(() => {
    let list = tests;
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      list = list.filter(
        (t) =>
          (t.name || '').toLowerCase().includes(q) ||
          (t.uuid || '').toLowerCase().includes(q) ||
          (t.description || '').toLowerCase().includes(q) ||
          (Array.isArray(t.techniques) &&
            t.techniques.some((tid) => (tid || '').toLowerCase().includes(q)))
      );
    }
    if (severities.size > 0) {
      list = list.filter((t) => severities.has((t.severity || '').toLowerCase()));
    }
    if (categories.size > 0) {
      list = list.filter((t) => categories.has((t.category || '').toLowerCase()));
    }
    if (technique) {
      list = list.filter((t) => Array.isArray(t.techniques) && t.techniques.includes(technique));
    }

    const sorted = [...list];
    sorted.sort((a, b) => {
      switch (sort) {
        case 'score':
          return (b.score ?? 0) - (a.score ?? 0);
        case 'severity':
          return severityRank(b.severity) - severityRank(a.severity);
        case 'name':
          return (a.name || '').localeCompare(b.name || '');
        case 'modified':
        default: {
          const at = a.lastModifiedDate ? new Date(a.lastModifiedDate).getTime() : 0;
          const bt = b.lastModifiedDate ? new Date(b.lastModifiedDate).getTime() : 0;
          return bt - at;
        }
      }
    });
    return sorted;
  }, [tests, search, severities, categories, technique, sort]);

  function runTest(test: TestMetadata, e: React.MouseEvent) {
    e.stopPropagation();
    setDrawerTests([test]);
    setDrawerOpen(true);
  }

  function openTest(uuid: string) {
    navigate(`/browser/test/${uuid}`);
  }

  const hasActiveFilters =
    search !== '' ||
    severities.size > 0 ||
    categories.size > 0 ||
    technique !== '' ||
    sort !== 'modified';

  // suppress unused warning until Favorites column is exposed in a future iteration
  void isFavorite;
  void toggleFavorite;

  return (
    <div className="tm-page">
      <header className="tm-pagehead">
        <div className="tm-pagehead-text">
          <h1 className="tm-pagehead-title">Tests</h1>
          <span className="tm-pagehead-sub">
            {loading
              ? 'Loading catalog…'
              : `${filtered.length} of ${tests.length} test${tests.length === 1 ? '' : 's'}`}
          </span>
        </div>
        <div className="tm-pagehead-actions">
          <button
            type="button"
            className="dash-quick-btn"
            onClick={() => navigate('/dashboard')}
          >
            <Icon size={12}>{I.layout}</Icon>
            <span>Dashboard</span>
          </button>
          {canCreateTasks && (
            <button
              type="button"
              className="dash-quick-btn primary"
              onClick={() => {
                if (filtered.length === 0) return;
                setDrawerTests(filtered);
                setDrawerOpen(true);
              }}
              disabled={filtered.length === 0}
            >
              <Icon size={12}>{I.play}</Icon>
              <span>Run all visible</span>
            </button>
          )}
        </div>
      </header>

      {/* Filter strip */}
      <div className="tm-filterstrip" data-testid="tm-filterstrip">
        <div className="tm-search">
          <Icon size={14}>{I.search}</Icon>
          <input
            type="search"
            placeholder="Search by name, UUID, technique, or description…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search tests"
          />
        </div>

        <div className="tm-chipgroup" role="group" aria-label="Severity filter">
          <span className="tm-chipgroup-label">Sev</span>
          {SEVERITIES.map((s) => {
            const active = severities.has(s.id);
            return (
              <button
                key={s.id}
                type="button"
                className={`tm-chip ${active ? 'is-active' : ''}`}
                onClick={() => toggleSet('sev', s.id)}
                aria-pressed={active}
              >
                <span className={`tm-chip-dot sev-bg-${s.id}`} aria-hidden="true" />
                {s.label}
              </button>
            );
          })}
        </div>

        {categoryOptions.length > 0 && (
          <div className="tm-chipgroup" role="group" aria-label="Category filter">
            <span className="tm-chipgroup-label">Cat</span>
            {categoryOptions.map((c) => {
              const active = categories.has(c.toLowerCase());
              return (
                <button
                  key={c}
                  type="button"
                  className={`tm-chip ${active ? 'is-active' : ''}`}
                  onClick={() => toggleSet('cat', c.toLowerCase())}
                  aria-pressed={active}
                >
                  <span
                    className="tm-chip-dot"
                    style={{ background: categoryColor(c) }}
                    aria-hidden="true"
                  />
                  {c}
                </button>
              );
            })}
          </div>
        )}

        {techniqueOptions.length > 0 && (
          <select
            className="tm-select"
            aria-label="Filter by MITRE technique"
            value={technique}
            onChange={(e) => setTechnique(e.target.value)}
          >
            <option value="">All techniques</option>
            {techniqueOptions.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        )}

        <div className="tm-spacer" />

        <select
          className="tm-select"
          aria-label="Sort tests"
          value={sort}
          onChange={(e) => setSort(e.target.value as SortField)}
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        {hasActiveFilters && (
          <button type="button" className="tm-reset-btn" onClick={resetFilters}>
            Reset
          </button>
        )}
      </div>

      {/* Body */}
      {loading ? (
        <div className="tm-loading">
          <span className="tm-spinner" />
          <span>Loading security tests…</span>
        </div>
      ) : error ? (
        <div className="tm-empty">
          <span className="tm-empty-title">Catalog unavailable</span>
          <span>{error}</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="tm-empty">
          <span className="tm-empty-title">No tests match these filters</span>
          {hasActiveFilters && (
            <button type="button" className="tm-reset-btn" onClick={resetFilters}>
              Reset filters
            </button>
          )}
        </div>
      ) : (
        <div className="tm-table" role="table" aria-label="Test catalog">
          <div className="tm-table-head" role="row">
            <span role="columnheader">ID</span>
            <span role="columnheader">Name</span>
            <span role="columnheader">Severity</span>
            <span role="columnheader">Category</span>
            <span role="columnheader">Techniques</span>
            <span role="columnheader" style={{ textAlign: 'right' }}>Score</span>
            <span role="columnheader">Last mod</span>
            <span role="columnheader" style={{ textAlign: 'right' }}>Run</span>
          </div>

          {filtered.map((t) => {
            const techs = Array.isArray(t.techniques) ? t.techniques : [];
            const techPills = techs.slice(0, 2);
            const techMore = techs.length - techPills.length;

            return (
              <div
                key={t.uuid}
                className="tm-table-row"
                role="row"
                tabIndex={0}
                onClick={() => openTest(t.uuid)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    openTest(t.uuid);
                  }
                }}
              >
                <span className="tm-cell-id" title={t.uuid} role="cell">
                  {t.uuid.slice(0, 8)}
                </span>
                <span className="tm-cell-name" title={t.name} role="cell">
                  {t.name}
                </span>
                <span role="cell">
                  {t.severity ? (
                    <span className={`sev-pill sev-bg-${t.severity}`}>{t.severity}</span>
                  ) : (
                    <span className="tm-cell-when">—</span>
                  )}
                </span>
                <span role="cell" style={{ minWidth: 0 }}>
                  {t.category ? (
                    <span className="tm-cell-cat" title={t.category}>
                      <span
                        className="tm-cell-cat-dot"
                        style={{ background: categoryColor(t.category) }}
                      />
                      {t.category}
                    </span>
                  ) : (
                    <span className="tm-cell-when">—</span>
                  )}
                </span>
                <span className="tm-cell-tech" role="cell">
                  {techPills.map((tid) => (
                    <span key={tid} className="tm-tech">
                      {tid}
                    </span>
                  ))}
                  {techMore > 0 && (
                    <span className="tm-tech tm-tech-more" title={techs.slice(2).join(', ')}>
                      +{techMore}
                    </span>
                  )}
                </span>
                <span
                  className={`tm-cell-score ${scoreClass(t.score)}`}
                  role="cell"
                >
                  {t.score != null ? t.score.toFixed(1) : '—'}
                </span>
                <span className="tm-cell-when" role="cell">
                  {relTime(t.lastModifiedDate)}
                </span>
                <span className="tm-cell-actions" role="cell">
                  {canCreateTasks && (
                    <button
                      type="button"
                      className="tm-iconbtn"
                      title="Run test"
                      aria-label={`Run ${t.name}`}
                      onClick={(e) => runTest(t, e)}
                    >
                      <Icon size={11} fill="currentColor" sw={0}>
                        {I.play}
                      </Icon>
                    </button>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <ExecutionDrawer
        open={drawerOpen}
        onClose={() => {
          setDrawerOpen(false);
          setDrawerTests([]);
        }}
        tests={drawerTests}
      />
    </div>
  );
}
