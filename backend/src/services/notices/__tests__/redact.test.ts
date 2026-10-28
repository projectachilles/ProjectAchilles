import { describe, it, expect } from 'vitest';
import { redactDeliveryError, redactNoticeListItem } from '../redact.js';

describe('redactDeliveryError', () => {
  it('turns address lists into counts', () => {
    expect(redactDeliveryError('rejected: a@x.test, b@x.test')).toBe('2 recipients rejected');
    expect(redactDeliveryError('not accepted: a@x.test')).toBe('1 recipient not accepted');
  });

  it('keeps the address-free line and hides other server text', () => {
    expect(redactDeliveryError('no recipients accepted')).toBe('no recipients accepted');
    expect(redactDeliveryError('Invalid login: 535 relay@x.test')).toBe('delivery failed');
    expect(redactDeliveryError(null)).toBeNull();
  });
});

describe('redactNoticeListItem', () => {
  it('drops recipients and keeps the rest of the row', () => {
    const row = { id: 'n', state: 'sent', recipients: '["a@x.test"]', last_error: null, held_tasks: 0 };
    expect(redactNoticeListItem(row)).toEqual({ id: 'n', state: 'sent', last_error: null, held_tasks: 0 });
  });
});
