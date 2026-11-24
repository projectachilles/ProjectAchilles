import { describe, it, expect } from 'vitest';
import { describeVersionSource } from '../agentVersionSource';

describe('describeVersionSource', () => {
  it('reads the commit of a build from source', () => {
    expect(describeVersionSource('Built from source (windows/amd64) at 87c9bfd')).toEqual({
      kind: 'source',
      commit: '87c9bfd',
      sourceVersion: null,
    });
  });

  it('reads the version the source had when it differs from the typed one', () => {
    expect(describeVersionSource('Built from source (linux/amd64) at f34959f (source says 0.7.4)')).toEqual({
      kind: 'source',
      commit: 'f34959f',
      sourceVersion: '0.7.4',
    });
  });

  it('accepts a build with no recorded commit', () => {
    expect(describeVersionSource('Built from source (windows/amd64)')).toEqual({
      kind: 'source',
      commit: null,
      sourceVersion: null,
    });
    expect(describeVersionSource('Built from source (windows/amd64) (source says 0.7.2)')).toEqual({
      kind: 'source',
      commit: null,
      sourceVersion: '0.7.2',
    });
  });

  it('treats any other text as plain notes, never as a commit', () => {
    expect(describeVersionSource('Release binary from GitHub')).toEqual({
      kind: 'notes',
      notes: 'Release binary from GitHub',
    });
    // Typed notes that only look like the build format.
    expect(describeVersionSource('Built from source at home at abc1234')).toEqual({
      kind: 'notes',
      notes: 'Built from source at home at abc1234',
    });
    expect(describeVersionSource('Built from source (windows/amd64) at 87c9bfd and patched')).toEqual({
      kind: 'notes',
      notes: 'Built from source (windows/amd64) at 87c9bfd and patched',
    });
  });

  it('reports empty or missing notes as none', () => {
    expect(describeVersionSource('')).toEqual({ kind: 'none' });
    expect(describeVersionSource('   ')).toEqual({ kind: 'none' });
    expect(describeVersionSource(undefined)).toEqual({ kind: 'none' });
    expect(describeVersionSource(null)).toEqual({ kind: 'none' });
  });
});
