import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import HeroMetricsCard from '../HeroMetricsCard';

function ledgerRow(label: string): HTMLElement {
  // Each ledger row is "label ... value"; scope value lookups to the row.
  const el = screen.getByText(label).parentElement;
  if (!el) throw new Error(`row for ${label} not found`);
  return el;
}

describe('HeroMetricsCard (Defense ledger)', () => {
  describe('"Actual" row (pre-risk-acceptance score)', () => {
    it('REGRESSION: shows rawScore (without RA exclusion), not realScore (EDR-only with RA)', () => {
      // Reproduces the tpsgl bug shape: defenseScore == realScore (no Defender boost)
      // but rawScore is meaningfully different because risk acceptance excluded
      // unprotected docs. The Actual row must reflect rawScore, the un-filtered score.
      render(
        <HeroMetricsCard
          defenseScore={54.5}
          realScore={54.5}
          rawScore={53.0}
          riskAcceptedCount={44}
          uniqueEndpoints={17}
          executedTests={72}
        />,
      );

      expect(within(ledgerRow('Actual')).getByText('53.0%')).toBeInTheDocument();
      expect(within(ledgerRow('Risk-accepted')).getByText('44 excluded')).toBeInTheDocument();
      // The 54.5 headline appears once (the ring) — not also in the Actual row
      expect(screen.getAllByText('54.5%')).toHaveLength(1);
    });

    it('shows a dash when no risk acceptances are active (no misleading duplicate)', () => {
      render(
        <HeroMetricsCard
          defenseScore={75.0}
          realScore={70.0}
          rawScore={75.0}
          riskAcceptedCount={0}
          uniqueEndpoints={5}
          executedTests={20}
        />,
      );

      expect(within(ledgerRow('Actual')).getByText('—')).toBeInTheDocument();
      expect(within(ledgerRow('Risk-accepted')).getByText('none')).toBeInTheDocument();
    });

    it('shows a dash when rawScore is missing', () => {
      render(
        <HeroMetricsCard
          defenseScore={80.0}
          riskAcceptedCount={5}
          uniqueEndpoints={3}
          executedTests={10}
        />,
      );
      expect(within(ledgerRow('Actual')).getByText('—')).toBeInTheDocument();
    });
  });

  describe('"EDR-only" row', () => {
    it('shows EDR-only when realScore differs from defenseScore (Defender boost active)', () => {
      render(
        <HeroMetricsCard
          defenseScore={88.0}
          realScore={75.0}
          rawScore={88.0}
          uniqueEndpoints={10}
          executedTests={50}
        />,
      );
      expect(within(ledgerRow('EDR-only')).getByText('75.0%')).toBeInTheDocument();
    });

    it('shows a dash when realScore equals defenseScore (no Defender boost)', () => {
      render(
        <HeroMetricsCard
          defenseScore={54.5}
          realScore={54.5}
          rawScore={53.0}
          riskAcceptedCount={44}
          uniqueEndpoints={17}
          executedTests={72}
        />,
      );
      expect(within(ledgerRow('EDR-only')).getByText('—')).toBeInTheDocument();
    });
  });

  describe('loading state', () => {
    it('renders skeletons (not a spinner) while loading', () => {
      const { container } = render(
        <HeroMetricsCard loading defenseScore={0} uniqueEndpoints={0} executedTests={0} />,
      );
      expect(container.querySelectorAll('[data-testid="skeleton"]').length).toBeGreaterThan(0);
      expect(container.querySelector('.animate-spin')).toBeNull();
    });
  });

  describe('headline and fleet facts', () => {
    it('shows the defense score, stats, and compacted results count', () => {
      render(
        <HeroMetricsCard
          defenseScore={92.3}
          uniqueEndpoints={42}
          executedTests={123}
          totalResults={17055}
          windowLabel="90d window"
        />,
      );
      expect(screen.getByText('92.3%')).toBeInTheDocument();
      expect(screen.getByText('42')).toBeInTheDocument();
      expect(screen.getByText('123')).toBeInTheDocument();
      expect(screen.getByText('17k')).toBeInTheDocument();
      expect(screen.getByText('90d window')).toBeInTheDocument();
    });

    it('renders em-dash placeholders when defenseScore is null', () => {
      render(
        <HeroMetricsCard
          defenseScore={null}
          uniqueEndpoints={0}
          executedTests={0}
        />,
      );
      expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    });
  });
});
