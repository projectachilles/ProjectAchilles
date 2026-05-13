import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import CoveragePips from '../CoveragePips';

describe('CoveragePips', () => {
  it('renders one pip per item', () => {
    const { container } = render(
      <CoveragePips
        items={[
          { technique: 'T1059', detected: true },
          { technique: 'T1486', detected: false },
          { technique: 'T1566', detected: true },
        ]}
      />
    );

    // 3 items → 3 pip spans
    expect(container.querySelectorAll('span').length).toBe(3);
  });

  it('uses green styling for detected and red for missed', () => {
    const { container } = render(
      <CoveragePips
        items={[
          { technique: 'T1', detected: true },
          { technique: 'T2', detected: false },
        ]}
      />
    );

    const pips = container.querySelectorAll('span');
    expect(pips[0].className).toContain('bg-emerald-500');
    expect(pips[1].className).toContain('bg-red-500');
  });

  it('attaches the technique name as a hover title for each pip', () => {
    render(
      <CoveragePips
        items={[
          { technique: 'T1059', detected: true },
          { technique: 'T1486', detected: false },
        ]}
      />
    );

    expect(screen.getByTitle('T1059: detected')).toBeInTheDocument();
    expect(screen.getByTitle('T1486: missed')).toBeInTheDocument();
  });

  it('sets an aria-label summarizing the detected/total ratio', () => {
    render(
      <CoveragePips
        items={[
          { technique: 'T1', detected: true },
          { technique: 'T2', detected: false },
          { technique: 'T3', detected: false },
        ]}
      />
    );

    expect(screen.getByRole('img', { name: '1 of 3 techniques detected' })).toBeInTheDocument();
  });

  it('renders nothing when items is empty', () => {
    const { container } = render(<CoveragePips items={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('respects a custom aria-label override', () => {
    render(
      <CoveragePips
        items={[{ technique: 'T1', detected: true }]}
        ariaLabel="Custom coverage description"
      />
    );

    expect(screen.getByRole('img', { name: 'Custom coverage description' })).toBeInTheDocument();
  });
});
