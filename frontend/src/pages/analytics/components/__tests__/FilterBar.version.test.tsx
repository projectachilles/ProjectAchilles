import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import FilterBar from '../FilterBar';
import { useAnalyticsFilters } from '@/hooks/useAnalyticsFilters';

function Harness({ showVersionFilter }: { showVersionFilter?: boolean }) {
  const filterState = useAnalyticsFilters(false);
  return (
    <>
      <FilterBar
        filterState={filterState}
        showVersionFilter={showVersionFilter}
        availableHostnames={[]} availableTests={[]} availableTechniques={[]} availableCategories={[]}
        availableThreatActors={[]} availableTags={[]} availableErrorNames={[]} availableErrorCodes={[]}
        availableBundleNames={[]}
      />
      <output data-testid="state">{String(filterState.filters.versionState)}</output>
    </>
  );
}
const renderBar = (props = {}) => render(<MemoryRouter><Harness {...props} /></MemoryRouter>);

describe('FilterBar Version control', () => {
  it('offers the five options, in order', () => {
    renderBar({ showVersionFilter: true });
    const select = screen.getByLabelText('Version');
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'All versions', 'Older version', 'Current version', 'Version unknown', 'Not recorded',
    ]);
  });

  it('sets the filter, shows a chip, and Clear All resets it', async () => {
    renderBar({ showVersionFilter: true });
    await userEvent.selectOptions(screen.getByLabelText('Version'), 'Older version');
    expect(screen.getByTestId('state')).toHaveTextContent('older');
    expect(screen.getByText('Version: Older version')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Clear All/ }));
    expect(screen.getByTestId('state')).toHaveTextContent('null');
    expect(screen.queryByText('Version: Older version')).toBeNull();
  });

  it('is hidden when versions are not available', () => {
    renderBar();
    expect(screen.queryByLabelText('Version')).toBeNull();
  });
});
