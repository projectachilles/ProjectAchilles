import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { Button } from '../Button';

describe('Button', () => {
  it('renders children', () => {
    render(<Button>Click me</Button>);

    expect(screen.getByRole('button', { name: 'Click me' })).toBeInTheDocument();
  });

  it('applies primary variant by default', () => {
    render(<Button>Primary</Button>);

    const btn = screen.getByRole('button');
    expect(btn.className).toContain('bg-primary');
  });

  it('applies secondary variant', () => {
    render(<Button variant="secondary">Secondary</Button>);

    const btn = screen.getByRole('button');
    expect(btn.className).toContain('bg-secondary');
  });

  it('applies ghost variant', () => {
    render(<Button variant="ghost">Ghost</Button>);

    const btn = screen.getByRole('button');
    expect(btn.className).toContain('hover:bg-accent');
    expect(btn.className).not.toContain('bg-primary');
  });

  it('applies destructive variant', () => {
    render(<Button variant="destructive">Delete</Button>);

    const btn = screen.getByRole('button');
    expect(btn.className).toContain('bg-destructive');
  });

  it('applies outline variant', () => {
    render(<Button variant="outline">Outline</Button>);

    const btn = screen.getByRole('button');
    expect(btn.className).toContain('border');
    expect(btn.className).toContain('bg-transparent');
  });

  it('applies md size by default', () => {
    render(<Button>Default</Button>);

    const btn = screen.getByRole('button');
    expect(btn.className).toContain('h-10');
  });

  it('applies sm size', () => {
    render(<Button size="sm">Small</Button>);

    const btn = screen.getByRole('button');
    expect(btn.className).toContain('h-8');
  });

  it('applies lg size', () => {
    render(<Button size="lg">Large</Button>);

    const btn = screen.getByRole('button');
    expect(btn.className).toContain('h-12');
  });

  it('applies icon size', () => {
    render(<Button size="icon">X</Button>);

    const btn = screen.getByRole('button');
    expect(btn.className).toContain('w-10');
  });

  it('handles click events', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Click</Button>);

    await userEvent.click(screen.getByRole('button'));

    expect(onClick).toHaveBeenCalledOnce();
  });

  it('disables the button', () => {
    render(<Button disabled>Disabled</Button>);

    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('does not fire onClick when disabled', async () => {
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>No click</Button>);

    await userEvent.click(screen.getByRole('button'));

    expect(onClick).not.toHaveBeenCalled();
  });

  it('forwards ref', () => {
    const ref = createRef<HTMLButtonElement>();
    render(<Button ref={ref}>Ref</Button>);

    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
    expect(ref.current?.textContent).toBe('Ref');
  });

  it('merges custom className', () => {
    render(<Button className="my-custom-class">Custom</Button>);

    const btn = screen.getByRole('button');
    expect(btn.className).toContain('my-custom-class');
    expect(btn.className).toContain('bg-primary'); // still has default
  });

  it('passes through additional HTML attributes', () => {
    render(<Button data-testid="my-btn" type="submit">Submit</Button>);

    const btn = screen.getByTestId('my-btn');
    expect(btn).toHaveAttribute('type', 'submit');
  });
});
