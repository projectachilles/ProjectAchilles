import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import TechniqueBadge from '../TechniqueBadge';

describe('TechniqueBadge', () => {
  it('renders technique text', () => {
    render(<TechniqueBadge technique="T1505.003" />);
    expect(screen.getByText('T1505.003')).toBeInTheDocument();
  });

  it('applies md size by default', () => {
    render(<TechniqueBadge technique="T1505.003" />);
    const el = screen.getByText('T1505.003');
    expect(el.className).toContain('text-xs');
    expect(el.className).toContain('px-2');
  });

  it('applies sm size', () => {
    render(<TechniqueBadge technique="T1505.003" size="sm" />);
    const el = screen.getByText('T1505.003');
    expect(el.className).toContain('text-[10px]');
    expect(el.className).toContain('px-1.5');
  });

  it('applies xs size', () => {
    render(<TechniqueBadge technique="T1505.003" size="xs" />);
    const el = screen.getByText('T1505.003');
    expect(el.className).toContain('text-[9px]');
    expect(el.className).toContain('px-1');
  });

  it('has monospace font', () => {
    render(<TechniqueBadge technique="T1505.003" />);
    const el = screen.getByText('T1505.003');
    expect(el.className).toContain('font-mono');
  });
});
