import { describe, it, expect, vi, afterEach } from 'vitest';
import { copyText } from '../clipboard';

describe('copyText', () => {
  const original = navigator.clipboard;
  afterEach(() => {
    Object.defineProperty(navigator, 'clipboard', { value: original, configurable: true });
    vi.restoreAllMocks();
  });

  it('uses the Clipboard API when it exists', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    expect(await copyText('hello')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('hello');
  });

  it('falls back to execCommand on plain-HTTP pages, where navigator.clipboard is missing', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    let copied = '';
    document.execCommand = vi.fn(() => {
      copied = document.querySelector('textarea')?.value ?? '';
      return true;
    });
    expect(await copyText('line 1\nline 2')).toBe(true);
    expect(copied).toBe('line 1\nline 2');
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('reports failure when neither path works', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    document.execCommand = vi.fn(() => false);
    expect(await copyText('x')).toBe(false);
  });
});
