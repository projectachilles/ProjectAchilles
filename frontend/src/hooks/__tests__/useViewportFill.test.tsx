import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { useViewportFill } from '../useViewportFill';

function Probe({ enabled, top = 300 }: { enabled: boolean; top?: number }) {
  const { ref, height } = useViewportFill<HTMLDivElement>(enabled);
  return (
    <div
      ref={(el) => {
        if (el) el.getBoundingClientRect = () => ({ top } as DOMRect);
        (ref as { current: HTMLDivElement | null }).current = el;
      }}
      data-testid="probe"
    >
      {String(height)}
    </div>
  );
}

function setInnerHeight(h: number) {
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: h });
}

describe('useViewportFill', () => {
  afterEach(() => setInnerHeight(768));

  it('fills the remaining viewport height minus the bottom gap', () => {
    setInnerHeight(1000);
    render(<Probe enabled />);
    expect(screen.getByTestId('probe').textContent).toBe('676');
  });

  it('is null when disabled', () => {
    setInnerHeight(1000);
    render(<Probe enabled={false} />);
    expect(screen.getByTestId('probe').textContent).toBe('null');
  });

  it('recomputes on resize', () => {
    setInnerHeight(1000);
    render(<Probe enabled />);
    act(() => {
      setInnerHeight(1200);
      window.dispatchEvent(new Event('resize'));
    });
    expect(screen.getByTestId('probe').textContent).toBe('876');
  });

  it('never goes below 320', () => {
    setInnerHeight(500);
    render(<Probe enabled />);
    expect(screen.getByTestId('probe').textContent).toBe('320');
  });
});
