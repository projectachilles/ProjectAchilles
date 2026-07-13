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

  it('honors the tone override with the real chart tokens', () => {
    const { container, rerender } = render(<BulletBar value={90} tone="warning" aria-label="x" />);
    const fill = () => container.querySelector('[data-slot="bullet-fill"]') as HTMLElement;
    // tone="warning" must resolve to --chart-warn (NOT the non-existent --chart-warning)
    expect(fill().style.background).toContain('var(--chart-warn)');
    expect(fill().style.background).not.toContain('var(--chart-warning)');
    rerender(<BulletBar value={10} tone="protected" aria-label="x" />);
    expect(fill().style.background).toContain('var(--chart-protected)');
    rerender(<BulletBar value={95} tone="bypassed" aria-label="x" />);
    expect(fill().style.background).toContain('var(--chart-bypassed)');
  });

  it('exposes accessible meter semantics', () => {
    const { container } = render(<BulletBar value={42} target={80} aria-label="host score" />);
    const meter = container.querySelector('[role="meter"]') as HTMLElement;
    expect(meter).not.toBeNull();
    expect(meter.getAttribute('aria-valuenow')).toBe('42');
    expect(meter.getAttribute('aria-valuemin')).toBe('0');
    expect(meter.getAttribute('aria-valuemax')).toBe('100');
    expect(meter.getAttribute('aria-label')).toBe('host score');
  });

  it('clamps value to [0,100] for width and aria-valuenow', () => {
    const { container, rerender } = render(<BulletBar value={120} target={80} aria-label="x" />);
    const fill = () => container.querySelector('[data-slot="bullet-fill"]') as HTMLElement;
    const meter = () => container.querySelector('[role="meter"]') as HTMLElement;
    expect(fill().style.width).toBe('100%');
    expect(meter().getAttribute('aria-valuenow')).toBe('100');
    rerender(<BulletBar value={-5} target={80} aria-label="x" />);
    expect(fill().style.width).toBe('0%');
    expect(meter().getAttribute('aria-valuenow')).toBe('0');
  });
});
