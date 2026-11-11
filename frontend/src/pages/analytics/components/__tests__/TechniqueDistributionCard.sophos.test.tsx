import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import TechniqueDistributionCard from '../TechniqueDistributionCard';

const row = (technique: string) => ({ technique, protected: 1, unprotected: 1 });

describe('TechniqueDistributionCard vendor alert badges', () => {
  it('counts only the techniques on the card that appear on the vendor\'s alerts', () => {
    // T1003 and T1105 have alerts but are not on this card (another window or filter).
    render(
      <TechniqueDistributionCard
        data={[row('T1059'), row('T1486'), row('T1021')]}
        sophosAlertTechniques={['T1059', 'T1486', 'T1003', 'T1105']}
        defenderAlertTechniques={['T1003']}
      />,
    );
    expect(screen.getByText('2 with Sophos alerts')).toBeInTheDocument();
    expect(screen.queryByText(/with Defender alerts/)).not.toBeInTheDocument();
  });

  it('hides the badge at zero', () => {
    render(<TechniqueDistributionCard data={[]} sophosAlertTechniques={['T1059']} />);
    expect(screen.queryByText(/with Sophos alerts/)).not.toBeInTheDocument();
  });
});
