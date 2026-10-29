import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import TechniqueDistributionCard from '../TechniqueDistributionCard';

describe('TechniqueDistributionCard Sophos badge', () => {
  it('shows "with Sophos alerts" when techniques overlap', () => {
    render(<TechniqueDistributionCard data={[]} sophosTechniqueCount={4} />);
    expect(screen.getByText('4 with Sophos alerts')).toBeInTheDocument();
  });
  it('hides the badge at zero', () => {
    render(<TechniqueDistributionCard data={[]} />);
    expect(screen.queryByText(/with Sophos alerts/)).not.toBeInTheDocument();
  });
});
