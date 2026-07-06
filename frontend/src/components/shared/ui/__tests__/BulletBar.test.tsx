import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { BulletBar } from '../BulletBar';

describe('BulletBar', () => {
  it('fills to value% and colors by band', () => {
    const { container, rerender } = render(<BulletBar value={16} target={80} aria-label="host score" />);
    const fill = container.querySelector('[data-slot="bullet-fill"]') as HTMLElement;
    expect(fill.style.width).toBe('16%');
    expect(fill.style.background).toContain('var(--chart-bypassed)');
    rerender(<BulletBar value={55} target={80} aria-label="x" />);
    expect((container.querySelector('[data-slot="bullet-fill"]') as HTMLElement).style.background).toContain('var(--chart-warn)');
    rerender(<BulletBar value={92} target={80} aria-label="x" />);
    expect((container.querySelector('[data-slot="bullet-fill"]') as HTMLElement).style.background).toContain('var(--chart-protected)');
  });
  it('draws a target marker at target%', () => {
    const { container } = render(<BulletBar value={50} target={80} aria-label="x" />);
    const marker = container.querySelector('[data-slot="bullet-target"]') as HTMLElement;
    expect(marker.style.left).toBe('80%');
  });
});
