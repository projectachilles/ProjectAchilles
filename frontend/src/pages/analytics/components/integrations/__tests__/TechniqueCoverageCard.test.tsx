import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { TechniqueCoverageItem, TechniqueCoverageResponse } from '@/services/api/integrationTypes';
import type { IntegrationVendor } from '../vendorConfig';
import TechniqueCoverageCard from '../TechniqueCoverageCard';

const vendor = { id: 'crowdstrike', alertsTitle: 'Falcon Alerts', product: 'Falcon' } as unknown as IntegrationVendor;

function item(i: number, over: Partial<TechniqueCoverageItem> = {}): TechniqueCoverageItem {
  return {
    technique: `T${1000 + i}`,
    name: `Technique ${i}`,
    executions: 10,
    prevented: 1,
    detectedOnly: 1,
    missed: 8,
    alerts: 2,
    ...over,
  };
}

function makeData(items: TechniqueCoverageItem[], executions = 98): TechniqueCoverageResponse {
  return {
    overall: {
      executions,
      prevented: 5,
      detectedOnly: 3,
      missed: 90,
      detectionRate: 8.2,
      preventionRate: 5.1,
      testedTechniques: items.length,
      detectedTechniques: 2,
    },
    byTechnique: items,
  };
}

const noop = () => {};

describe('TechniqueCoverageCard', () => {
  it('renders header totals from overall', () => {
    render(<TechniqueCoverageCard vendor={vendor} data={makeData([item(1)])} loading={false} onSelectTechnique={noop} />);
    expect(screen.getByText('5 prevented')).toBeInTheDocument();
    expect(screen.getByText('3 detected only')).toBeInTheDocument();
    expect(screen.getByText('90 no alert')).toBeInTheDocument();
    expect(screen.getByText('of 98 executions')).toBeInTheDocument();
    expect(screen.getByText(/what Falcon did about it/)).toBeInTheDocument();
    expect(screen.queryByText(/±60/)).not.toBeInTheDocument();
  });

  it("labels the alerts column 'Alerts (in window)'", () => {
    render(<TechniqueCoverageCard vendor={vendor} data={makeData([item(1)])} loading={false} onSelectTechnique={noop} />);
    expect(screen.getByText('Alerts (in window)', { selector: 'th' })).toBeInTheDocument();
  });

  it('uses Defender wording for the defender vendor', () => {
    const d = { id: 'defender', product: 'Defender' } as unknown as IntegrationVendor;
    render(<TechniqueCoverageCard vendor={d} data={makeData([item(1)])} loading={false} onSelectTechnique={noop} />);
    expect(screen.getByText(/what Defender did about it/)).toBeInTheDocument();
  });

  it('shows 7 rows then expands to all', () => {
    const items = Array.from({ length: 10 }, (_, i) => item(i));
    render(<TechniqueCoverageCard vendor={vendor} data={makeData(items)} loading={false} onSelectTechnique={noop} />);
    expect(screen.getAllByTestId('technique-row')).toHaveLength(7);
    fireEvent.click(screen.getByRole('button', { name: 'Show 3 more techniques' }));
    expect(screen.getAllByTestId('technique-row')).toHaveLength(10);
    fireEvent.click(screen.getByRole('button', { name: 'Show fewer' }));
    expect(screen.getAllByTestId('technique-row')).toHaveLength(7);
  });

  it("flags 'none matched a run' when alerts exist but nothing was detected", () => {
    const items = [item(1, { prevented: 0, detectedOnly: 0, missed: 10, alerts: 3 }), item(2)];
    render(<TechniqueCoverageCard vendor={vendor} data={makeData(items)} loading={false} onSelectTechnique={noop} />);
    expect(screen.getAllByText('none matched a run')).toHaveLength(1);
  });

  it('calls onSelectTechnique with the technique id', () => {
    const onSelect = vi.fn();
    render(<TechniqueCoverageCard vendor={vendor} data={makeData([item(1)])} loading={false} onSelectTechnique={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: 'T1001' }));
    expect(onSelect).toHaveBeenCalledWith('T1001');
  });

  it('renders an empty state when executions is 0', () => {
    render(<TechniqueCoverageCard vendor={vendor} data={makeData([], 0)} loading={false} onSelectTechnique={noop} />);
    expect(screen.getByText('No technique runs in this range')).toBeInTheDocument();
  });

  it('renders a loading status when loading with no data', () => {
    render(<TechniqueCoverageCard vendor={vendor} data={null} loading={true} onSelectTechnique={noop} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('shows an error when the coverage request failed', () => {
    render(<TechniqueCoverageCard vendor={vendor} data={null} loading={false} error onSelectTechnique={noop} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Unable to load technique coverage');
  });
});
