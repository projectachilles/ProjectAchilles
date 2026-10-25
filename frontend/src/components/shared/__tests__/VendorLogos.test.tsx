import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CrowdStrikeLogo, SentinelOneLogo } from '../VendorLogos';

describe('VendorLogos', () => {
  it.each([
    ['crowdstrike-logo', CrowdStrikeLogo, /crowdstrike.*\.png/],
    ['sentinelone-logo', SentinelOneLogo, /sentinelone.*\.png/],
  ] as const)('%s renders a decorative image sized by className with a WebP source', (testId, Logo, src) => {
    const { container } = render(<Logo className="h-4 w-4" />);
    const img = screen.getByTestId(testId);
    expect(img.getAttribute('src')).toMatch(src);
    expect(img).toHaveAttribute('alt', '');
    expect(img).toHaveAttribute('aria-hidden', 'true');
    expect(img.className).toContain('h-4');
    expect(img.className).toContain('object-contain');
    expect(container.querySelector('source')?.getAttribute('type')).toBe('image/webp');
  });
});
