import { describe, it, expect } from 'vitest';
import { describeAutoResolveReceipt } from '../autoResolveReceipt';

describe('describeAutoResolveReceipt', () => {
  it('only a real, error-free enabled receipt reads as resolved by Achilles', () => {
    expect(describeAutoResolveReceipt({ auto_resolved: true, auto_resolve_mode: 'enabled' })).toEqual({ label: 'Auto-resolved by Achilles', tone: 'resolved' });
  });

  it('a dry run says it would resolve, and changed nothing', () => {
    expect(describeAutoResolveReceipt({ auto_resolved: true, auto_resolve_mode: 'dry_run' })).toEqual({ label: 'Auto-resolve dry run: would resolve', tone: 'info' });
  });

  it('a skip-forever receipt names the reason instead of claiming a resolve', () => {
    expect(describeAutoResolveReceipt({ auto_resolved: true, auto_resolve_mode: 'enabled', auto_resolve_error: 'not_found' })?.label).toBe('Auto-resolve skipped: alert not found in the console');
    expect(describeAutoResolveReceipt({ auto_resolved: true, auto_resolve_mode: 'enabled', auto_resolve_error: 'not_applied' })?.label).toBe('Auto-resolve skipped: the console applied no change');
    expect(describeAutoResolveReceipt({ auto_resolved: true, auto_resolve_mode: 'enabled', auto_resolve_error: '409: conflict' })).toEqual({ label: 'Auto-resolve skipped: 409: conflict', tone: 'info' });
  });

  it('no receipt, or an unknown mode, shows nothing', () => {
    expect(describeAutoResolveReceipt({})).toBeNull();
    expect(describeAutoResolveReceipt({ auto_resolved: true, auto_resolve_mode: null })).toBeNull();
  });
});
