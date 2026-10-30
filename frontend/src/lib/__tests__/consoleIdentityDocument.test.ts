import { describe, it, expect } from 'vitest';
import { WORDMARK } from '../brand';
import { documentTitle, faviconDataUrl } from '../consoleIdentityDocument';

describe('documentTitle', () => {
  it('prefixes the code and names the page from the first segment', () => {
    expect(documentTitle('/agents/42', 'ACME')).toBe(`[ACME] Agents · ${WORDMARK}`);
    expect(documentTitle('/cli-auth', 'ACME')).toBe(`[ACME] Authorize CLI · ${WORDMARK}`);
  });

  it('returns null on the report page, which owns its title', () => {
    expect(documentTitle('/analytics/report', 'ACME')).toBeNull();
  });

  it('falls back to code and wordmark for unknown paths', () => {
    expect(documentTitle('/unknown', 'ACME')).toBe(`[ACME] ${WORDMARK}`);
  });
});

describe('faviconDataUrl', () => {
  it('renders the code on the colour', () => {
    const url = faviconDataUrl('ACME', '#a78bfa');
    expect(url.startsWith('data:image/svg+xml')).toBe(true);
    const svg = decodeURIComponent(url.slice(url.indexOf(',') + 1));
    expect(svg).toContain('ACME');
    expect(svg).toContain('#a78bfa');
  });

  it('uses the neutral fill when there is no colour', () => {
    const svg = decodeURIComponent(faviconDataUrl('AC', null).split(',').slice(1).join(','));
    expect(svg).toContain('#101713');
    expect(svg).toContain('#dce8de');
  });
});
