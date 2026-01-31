import { X } from 'lucide-react';
import MultiSelectFilter from './MultiSelectFilter';
import SeverityFilter from './SeverityFilter';
import type { UseAnalyticsFiltersReturn } from '@/hooks/useAnalyticsFilters';
import type { FilterOption } from '@/services/api/analytics';

interface FilterBarProps {
  filterState: UseAnalyticsFiltersReturn;
  availableHostnames: FilterOption[];
  availableTests: string[];
  availableTechniques: string[];
  availableCategories: FilterOption[];
  availableSeverities: FilterOption[];
  availableThreatActors: FilterOption[];
  availableTags: FilterOption[];
  availableErrorNames: FilterOption[];
  availableErrorCodes: FilterOption[];
  loading?: boolean;
}

export default function FilterBar({
  filterState,
  availableHostnames,
  availableTests,
  availableTechniques,
  availableCategories,
  availableSeverities,
  availableThreatActors,
  availableTags,
  availableErrorNames,
  availableErrorCodes,
  loading = false,
}: FilterBarProps) {
  const {
    filters,
    activeFilterCount,
    setResult,
    setHostnames,
    setTests,
    setTechniques,
    setCategories,
    setSeverities,
    setThreatActors,
    setTags,
    setErrorNames,
    setErrorCodes,
    clearAdvancedFilters,
  } = filterState;

  // Build active filter tags for display
  const activeFilterTags: { label: string; onClear: () => void }[] = [];

  if (filters.result !== 'all') {
    activeFilterTags.push({
      label: `Result: ${filters.result === 'protected' ? 'Protected' : 'Unprotected'}`,
      onClear: () => setResult('all'),
    });
  }
  if (filters.severities.length > 0) {
    activeFilterTags.push({
      label: `Severity: ${filters.severities.join(', ')}`,
      onClear: () => setSeverities([]),
    });
  }
  if (filters.categories.length > 0) {
    activeFilterTags.push({
      label: `Category: ${filters.categories.join(', ')}`,
      onClear: () => setCategories([]),
    });
  }
  if (filters.threatActors.length > 0) {
    activeFilterTags.push({
      label: `Threat Actor: ${filters.threatActors.length > 2 ? `${filters.threatActors.length} selected` : filters.threatActors.join(', ')}`,
      onClear: () => setThreatActors([]),
    });
  }
  if (filters.hostnames.length > 0) {
    activeFilterTags.push({
      label: `Hostname: ${filters.hostnames.length > 2 ? `${filters.hostnames.length} selected` : filters.hostnames.join(', ')}`,
      onClear: () => setHostnames([]),
    });
  }
  if (filters.tests.length > 0) {
    activeFilterTags.push({
      label: `Tests: ${filters.tests.length > 2 ? `${filters.tests.length} selected` : filters.tests.join(', ')}`,
      onClear: () => setTests([]),
    });
  }
  if (filters.techniques.length > 0) {
    activeFilterTags.push({
      label: `Techniques: ${filters.techniques.length > 2 ? `${filters.techniques.length} selected` : filters.techniques.join(', ')}`,
      onClear: () => setTechniques([]),
    });
  }
  if (filters.tags.length > 0) {
    activeFilterTags.push({
      label: `Tags: ${filters.tags.length > 2 ? `${filters.tags.length} selected` : filters.tags.join(', ')}`,
      onClear: () => setTags([]),
    });
  }
  if (filters.errorNames.length > 0) {
    activeFilterTags.push({
      label: `Error Name: ${filters.errorNames.length > 2 ? `${filters.errorNames.length} selected` : filters.errorNames.join(', ')}`,
      onClear: () => setErrorNames([]),
    });
  }
  if (filters.errorCodes.length > 0) {
    activeFilterTags.push({
      label: `Error Code: ${filters.errorCodes.length > 2 ? `${filters.errorCodes.length} selected` : filters.errorCodes.join(', ')}`,
      onClear: () => setErrorCodes([]),
    });
  }

  return (
    <div className="bg-card text-card-foreground border border-border rounded-lg p-4 mb-4">
      {/* Filter Controls */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Result Filter */}
        <div className="flex items-center gap-2">
          <select
            value={filters.result}
            onChange={(e) => setResult(e.target.value as 'all' | 'protected' | 'unprotected')}
            className="px-3 py-1.5 bg-secondary text-foreground border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="all">All Results</option>
            <option value="protected">Protected Only</option>
            <option value="unprotected">Unprotected Only</option>
          </select>
        </div>

        {/* Hostname Filter */}
        <MultiSelectFilter
          label="Hostname"
          options={availableHostnames.map(h => h.value)}
          selected={filters.hostnames}
          onChange={setHostnames}
          loading={loading}
          placeholder="All Hosts"
        />

        {/* Category Filter */}
        <MultiSelectFilter
          label="Category"
          options={availableCategories.map(c => c.value)}
          selected={filters.categories}
          onChange={setCategories}
          loading={loading}
          placeholder="All Categories"
        />

        {/* Severity Filter */}
        <SeverityFilter
          options={availableSeverities}
          selected={filters.severities}
          onChange={setSeverities}
          loading={loading}
        />

        {/* Threat Actor Filter */}
        <MultiSelectFilter
          label="Threat Actor"
          options={availableThreatActors.map(t => t.value)}
          selected={filters.threatActors}
          onChange={setThreatActors}
          loading={loading}
          placeholder="All Actors"
        />

        {/* Tags Filter */}
        <MultiSelectFilter
          label="Tags"
          options={availableTags.map(t => t.value)}
          selected={filters.tags}
          onChange={setTags}
          loading={loading}
          placeholder="All Tags"
        />

        {/* Error Name Filter */}
        <MultiSelectFilter
          label="Error Name"
          options={availableErrorNames.map(e => e.value)}
          selected={filters.errorNames}
          onChange={setErrorNames}
          loading={loading}
          placeholder="All Error Types"
        />

        {/* Error Code Filter */}
        <MultiSelectFilter
          label="Error Code"
          options={availableErrorCodes.map(e => e.value)}
          selected={filters.errorCodes}
          onChange={setErrorCodes}
          loading={loading}
          placeholder="All Error Codes"
        />

        {/* Test Filter */}
        <MultiSelectFilter
          label="Test"
          options={availableTests}
          selected={filters.tests}
          onChange={setTests}
          loading={loading}
          placeholder="All Tests"
        />

        {/* Technique Filter */}
        <MultiSelectFilter
          label="Technique"
          options={availableTechniques}
          selected={filters.techniques}
          onChange={setTechniques}
          loading={loading}
          placeholder="All Techniques"
        />

        {/* Clear All Filters */}
        {activeFilterCount > 0 && (
          <button
            onClick={clearAdvancedFilters}
            className="flex items-center gap-1 px-2 py-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" />
            Clear All
          </button>
        )}
      </div>

      {/* Active Filter Tags */}
      {activeFilterTags.length > 0 && (
        <div className="mt-3 pt-3 border-t border-border flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">Active:</span>
          {activeFilterTags.map((tag, index) => (
            <span
              key={index}
              className="inline-flex items-center gap-1 px-2 py-1 bg-primary/10 text-primary text-sm rounded-full"
            >
              {tag.label}
              <button
                onClick={tag.onClear}
                className="hover:bg-primary/20 rounded-full p-0.5"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
