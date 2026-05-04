import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import HeroMetricsCard from '../HeroMetricsCard';

describe('HeroMetricsCard', () => {
  describe('"actual: X% (N excluded)" line', () => {
    it('REGRESSION: shows rawScore (without RA exclusion), not realScore (EDR-only with RA)', () => {
      // Reproduces the tpsgl bug shape: defenseScore == realScore (no Defender boost)
      // but rawScore is meaningfully different because risk acceptance excluded unprotected docs.
      // The "actual:" label must reflect rawScore, the un-filtered score.
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

      expect(screen.getByText(/actual:\s*53\.0%/)).toBeInTheDocument();
      expect(screen.getByText(/\(44 excluded\)/)).toBeInTheDocument();
      // The 54.5 number should appear once (the headline) — not twice
      // (i.e. it must NOT also appear next to "actual:")
      const allMatches = screen.getAllByText(/54\.5%/);
      expect(allMatches).toHaveLength(1);
    });

    it('hides the "actual" line when no risk acceptances are active', () => {
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

      expect(screen.queryByText(/actual:/)).not.toBeInTheDocument();
      expect(screen.queryByText(/excluded/)).not.toBeInTheDocument();
    });

    it('hides the "actual" line when rawScore is missing', () => {
      render(
        <HeroMetricsCard
          defenseScore={80.0}
          riskAcceptedCount={5}
          uniqueEndpoints={3}
          executedTests={10}
        />,
      );
      expect(screen.queryByText(/actual:/)).not.toBeInTheDocument();
    });
  });

  describe('"EDR-only" sub-stat', () => {
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
      expect(screen.getByText(/EDR-only:\s*75\.0%/)).toBeInTheDocument();
    });

    it('hides EDR-only when realScore equals defenseScore (no Defender boost)', () => {
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
      expect(screen.queryByText(/EDR-only/)).not.toBeInTheDocument();
    });
  });

  describe('headline rendering', () => {
    it('shows the defense score and basic stats', () => {
      render(
        <HeroMetricsCard
          defenseScore={92.3}
          uniqueEndpoints={42}
          executedTests={123}
        />,
      );
      expect(screen.getByText('92.3%')).toBeInTheDocument();
      expect(screen.getByText('42')).toBeInTheDocument();
      expect(screen.getByText('123')).toBeInTheDocument();
    });

    it('renders em-dash placeholder when defenseScore is null', () => {
      render(
        <HeroMetricsCard
          defenseScore={null}
          uniqueEndpoints={0}
          executedTests={0}
        />,
      );
      expect(screen.getByText('—')).toBeInTheDocument();
    });
  });
});
