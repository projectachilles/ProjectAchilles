import { describe, it, expect, afterEach } from 'vitest';
import { SettingsService } from '../settings.js';

describe('SettingsService write-index env settings', () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });

  it('defaults writeIndexPrefix and writeIndexRollover when env unset', () => {
    process.env.ELASTICSEARCH_NODE = 'http://localhost:9200';
    delete process.env.ELASTICSEARCH_WRITE_INDEX_PREFIX;
    delete process.env.ELASTICSEARCH_WRITE_INDEX_ROLLOVER;
    const s = new SettingsService().getSettings();
    expect(s.writeIndexPrefix).toBe('achilles-results-');
    expect(s.writeIndexRollover).toBe('none');
  });

  it('reads write-index env vars and clamps unknown rollover to none', () => {
    process.env.ELASTICSEARCH_NODE = 'http://localhost:9200';
    process.env.ELASTICSEARCH_WRITE_INDEX_PREFIX = 'foo-';
    process.env.ELASTICSEARCH_WRITE_INDEX_ROLLOVER = 'weekly';
    const s = new SettingsService().getSettings();
    expect(s.writeIndexPrefix).toBe('foo-');
    expect(s.writeIndexRollover).toBe('none');
  });

  it('accepts daily rollover', () => {
    process.env.ELASTICSEARCH_NODE = 'http://localhost:9200';
    process.env.ELASTICSEARCH_WRITE_INDEX_ROLLOVER = 'daily';
    expect(new SettingsService().getSettings().writeIndexRollover).toBe('daily');
  });
});
