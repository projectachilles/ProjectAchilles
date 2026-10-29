import { describe, it, expect } from 'vitest';
import { buildValidTabs } from '../validTabs';

const none = { defender: false, crowdstrike: false, sentinelone: false, sophos: false };

describe('buildValidTabs', () => {
  it('hides the Sophos tab when Sophos is not configured', () => {
    expect(buildValidTabs(none)).not.toContain('sophos');
  });
  it('shows the Sophos tab when configured', () => {
    expect(buildValidTabs({ ...none, sophos: true })).toContain('sophos');
  });
});
