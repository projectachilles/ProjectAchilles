import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Link } from 'react-router-dom';
import { StreamRow } from '../StreamRow';

describe('StreamRow', () => {
  it('renders name, trailing and meta slots', () => {
    render(<StreamRow name="BitLocker Check" trailing="exit 101" meta={<span>host-1</span>} />);
    expect(screen.getByText('BitLocker Check')).toBeInTheDocument();
    expect(screen.getByText('exit 101')).toBeInTheDocument();
    expect(screen.getByText('host-1')).toBeInTheDocument();
  });

  it('puts meta in a wrapper that spans the full row below md', () => {
    render(<StreamRow name="n" meta={<span>host-1</span>} />);
    const wrapper = screen.getByText('host-1').parentElement!;
    expect(wrapper.className).toContain('basis-full');
    expect(wrapper.className).toContain('md:contents');
  });

  it('renders as another element and forwards its props', () => {
    render(
      <MemoryRouter>
        <StreamRow as={Link} to="/tasks/1" name="Go" />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Go' })).toHaveAttribute('href', '/tasks/1');
  });

  it('merges className onto the root', () => {
    const { container } = render(<StreamRow name="n" className="py-1" />);
    expect(container.firstElementChild!.className).toContain('py-1');
    expect(container.firstElementChild!.className).toContain('flex-wrap');
  });
});
