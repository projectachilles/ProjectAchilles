import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Badge } from '../Badge';

describe('Badge success/warning use tokens, not raw tailwind colors', () => {
  it('success variant references the --success token', () => {
    const { container } = render(<Badge variant="success">ok</Badge>);
    const cls = container.firstElementChild?.className ?? '';
    expect(cls).not.toMatch(/green-500/);
    expect(cls).toMatch(/\[var\(--success\)\]|text-success|bg-success/);
  });

  it('warning variant references the --warning token', () => {
    const { container } = render(<Badge variant="warning">warn</Badge>);
    const cls = container.firstElementChild?.className ?? '';
    expect(cls).not.toMatch(/yellow-500/);
    expect(cls).toMatch(/\[var\(--warning\)\]|text-warning|bg-warning/);
  });
});
