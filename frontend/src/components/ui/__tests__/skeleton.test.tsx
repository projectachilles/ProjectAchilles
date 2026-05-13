import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Skeleton } from '../skeleton';

describe('Skeleton', () => {
  it('renders with the expected pulse + rounded classes and is aria-hidden', () => {
    render(<Skeleton className="h-4 w-12" />);

    const el = screen.getByTestId('skeleton');
    expect(el).toBeInTheDocument();
    expect(el.className).toContain('animate-pulse');
    expect(el.className).toContain('bg-muted');
    expect(el.className).toContain('h-4');
    expect(el.className).toContain('w-12');
    expect(el.getAttribute('aria-hidden')).toBe('true');
  });
});
