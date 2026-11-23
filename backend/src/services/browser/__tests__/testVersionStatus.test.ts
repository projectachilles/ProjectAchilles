import { describe, it, expect } from 'vitest';
import type {
  BuildVersionStamp,
  TaskTestVersion,
  TestVersionIdentity,
} from '../../../types/testVersion.js';
import { deriveStatus, resultVersionState } from '../testVersionStatus.js';
import type { StatusInput } from '../testVersionStatus.js';

function identity(over: Partial<TestVersionIdentity> = {}): TestVersionIdentity {
  return {
    fingerprint: 'fp1',
    source_hash: 'src1',
    shared_hash: 'sh1',
    test_tree: 'tree1',
    commit: 'c1',
    commit_date: '2026-01-01T00:00:00Z',
    provenance: 'upstream',
    ...over,
  };
}

function stamp(over: Partial<BuildVersionStamp> = {}): BuildVersionStamp {
  return { ...identity(), deps_hash: 'd1', modified: false, binaries: {}, ...over };
}

function input(over: Partial<StatusInput> = {}): StatusInput {
  return {
    build: { exists: true, source: 'built', version: stamp() },
    synced: identity(),
    published: identity(),
    publishedKnown: true,
    hasGit: true,
    currentDepsHash: 'd1',
    ...over,
  };
}

describe('deriveStatus', () => {
  it('not_built when there is no build', () => {
    expect(deriveStatus(input({ build: { exists: false } }))).toEqual({ status: 'not_built' });
  });

  it('not_built with updateNote when a newer version is published', () => {
    const r = deriveStatus(
      input({ build: { exists: false }, published: identity({ fingerprint: 'fp2' }) }),
    );
    expect(r).toEqual({ status: 'not_built', updateNote: true });
  });

  it('uploaded', () => {
    expect(deriveStatus(input({ build: { exists: true, source: 'uploaded' } }))).toEqual({
      status: 'uploaded',
    });
  });

  it('unknown_build / no_stamp when built without a stamp', () => {
    expect(deriveStatus(input({ build: { exists: true, source: 'built' } }))).toEqual({
      status: 'unknown_build',
      reason: 'no_stamp',
    });
  });

  it('unknown_build / modified_source when the stamp is modified', () => {
    const r = deriveStatus(
      input({ build: { exists: true, source: 'built', version: stamp({ modified: true }) } }),
    );
    expect(r).toEqual({ status: 'unknown_build', reason: 'modified_source' });
  });

  it('unknown_build with no reason when there is no synced identity', () => {
    expect(deriveStatus(input({ synced: undefined }))).toEqual({ status: 'unknown_build' });
  });

  it('update_available / test_source_changed', () => {
    const r = deriveStatus(
      input({ published: identity({ fingerprint: 'fp2', source_hash: 'src2' }) }),
    );
    expect(r).toEqual({ status: 'update_available', reason: 'test_source_changed' });
  });

  it('update_available / shared_changed', () => {
    const r = deriveStatus(
      input({ published: identity({ fingerprint: 'fp2', shared_hash: 'sh2' }) }),
    );
    expect(r).toEqual({ status: 'update_available', reason: 'shared_changed' });
  });

  it('both hashes differ -> test_source_changed', () => {
    const r = deriveStatus(
      input({
        published: identity({ fingerprint: 'fp2', source_hash: 'src2', shared_hash: 'sh2' }),
      }),
    );
    expect(r.reason).toBe('test_source_changed');
  });

  it('update_available / documentation_changed when only the tree differs', () => {
    const r = deriveStatus(input({ published: identity({ test_tree: 'tree2' }) }));
    expect(r).toEqual({ status: 'update_available', reason: 'documentation_changed' });
  });

  it('update_available wins over rebuild_needed', () => {
    const r = deriveStatus(
      input({
        build: {
          exists: true,
          source: 'built',
          version: stamp({ fingerprint: 'old', source_hash: 'old' }),
        },
        published: identity({ fingerprint: 'fp2', source_hash: 'src2' }),
      }),
    );
    expect(r.status).toBe('update_available');
  });

  it('rebuild_needed / test_source_changed when the build is older than synced', () => {
    const r = deriveStatus(
      input({
        build: {
          exists: true,
          source: 'built',
          version: stamp({ fingerprint: 'old', source_hash: 'old' }),
        },
      }),
    );
    expect(r).toEqual({ status: 'rebuild_needed', reason: 'test_source_changed' });
  });

  it('rebuild_needed / shared_changed', () => {
    const r = deriveStatus(
      input({
        build: {
          exists: true,
          source: 'built',
          version: stamp({ fingerprint: 'old', shared_hash: 'old' }),
        },
      }),
    );
    expect(r).toEqual({ status: 'rebuild_needed', reason: 'shared_changed' });
  });

  it('rebuild_needed / dependency_changed on a different deps hash', () => {
    expect(deriveStatus(input({ currentDepsHash: 'd2' }))).toEqual({
      status: 'rebuild_needed',
      reason: 'dependency_changed',
    });
  });

  it('dependency_changed when deps_hash null vs a hash, and the reverse', () => {
    const nullStamp = input({
      build: { exists: true, source: 'built', version: stamp({ deps_hash: null }) },
    });
    expect(deriveStatus(nullStamp).reason).toBe('dependency_changed');
    expect(deriveStatus(input({ currentDepsHash: null })).reason).toBe('dependency_changed');
  });

  it('null deps hash equals null', () => {
    const r = deriveStatus(
      input({
        build: { exists: true, source: 'built', version: stamp({ deps_hash: null }) },
        currentDepsHash: null,
      }),
    );
    expect(r).toEqual({ status: 'up_to_date' });
  });

  it('fingerprint difference takes precedence over dependency change', () => {
    const r = deriveStatus(
      input({
        build: {
          exists: true,
          source: 'built',
          version: stamp({ fingerprint: 'old', source_hash: 'old' }),
        },
        currentDepsHash: 'd2',
      }),
    );
    expect(r.reason).toBe('test_source_changed');
  });

  it('up_to_date when built = synced = published', () => {
    expect(deriveStatus(input())).toEqual({ status: 'up_to_date' });
  });

  it('up_to_date without git, ignoring published', () => {
    const r = deriveStatus(
      input({ hasGit: false, published: undefined, publishedKnown: false }),
    );
    expect(r).toEqual({ status: 'up_to_date' });
  });

  it('without git never reports update_available', () => {
    const r = deriveStatus(
      input({ hasGit: false, published: identity({ fingerprint: 'fp2' }) }),
    );
    expect(r.status).toBe('up_to_date');
  });

  it('not_checked when git is on but no check has succeeded', () => {
    const r = deriveStatus(input({ publishedKnown: false, published: undefined }));
    expect(r).toEqual({ status: 'not_checked' });
  });

  it('test removed upstream after a successful check counts as published = synced', () => {
    expect(deriveStatus(input({ published: undefined, publishedKnown: true }))).toEqual({
      status: 'up_to_date',
    });
  });

  it('updateNote is only set on not_built', () => {
    expect(deriveStatus(input({ published: identity({ fingerprint: 'fp2' }) })).updateNote)
      .toBeUndefined();
  });

  it('not_built without git or without a known check has no updateNote', () => {
    const pub = identity({ fingerprint: 'fp2' });
    expect(deriveStatus(input({ build: { exists: false }, hasGit: false, published: pub })))
      .toEqual({ status: 'not_built' });
    expect(
      deriveStatus(
        input({ build: { exists: false }, publishedKnown: false, published: pub }),
      ),
    ).toEqual({ status: 'not_built' });
  });
});

describe('deriveStatus never guesses up_to_date', () => {
  const builds: Array<[string, StatusInput['build']]> = [
    ['clean stamp', { exists: true, source: 'built', version: stamp() }],
    ['older stamp', { exists: true, source: 'built', version: stamp({ fingerprint: 'old' }) }],
    ['other deps', { exists: true, source: 'built', version: stamp({ deps_hash: 'x' }) }],
    ['no build', { exists: false }],
    ['uploaded', { exists: true, source: 'uploaded' }],
    ['unstamped', { exists: true, source: 'built' }],
    ['modified', { exists: true, source: 'built', version: stamp({ modified: true }) }],
  ];
  const synceds = [identity(), undefined];
  const publisheds: Array<[string, TestVersionIdentity | undefined]> = [
    ['equal', identity()],
    ['fingerprint differs', identity({ fingerprint: 'fp2' })],
    ['tree differs', identity({ test_tree: 'tree2' })],
    ['undefined', undefined],
  ];

  for (const [bName, build] of builds)
    for (const synced of synceds)
      for (const hasGit of [true, false])
        for (const publishedKnown of [true, false])
          for (const [pName, published] of publisheds)
            it(`${bName} / synced ${synced ? 'set' : 'undefined'} / git ${hasGit} / known ${publishedKnown} / published ${pName}`, () => {
              const i: StatusInput = {
                build,
                synced,
                published,
                publishedKnown,
                hasGit,
                currentDepsHash: 'd1',
              };
              const r = deriveStatus(i);
              if (r.status !== 'up_to_date') return;
              const v = build.version;
              expect(build.source).toBe('built');
              expect(v?.modified).toBe(false);
              expect(synced).toBeDefined();
              expect(v?.fingerprint).toBe(synced?.fingerprint);
              expect(v?.deps_hash).toBe(i.currentDepsHash);
              if (hasGit) {
                expect(publishedKnown).toBe(true);
                // a test missing from a successful check counts as published = synced
                const p = published ?? synced;
                expect(p?.fingerprint).toBe(synced?.fingerprint);
                expect(p?.test_tree).toBe(synced?.test_tree);
              }
            });
});

describe('resultVersionState', () => {
  const rec = (over: Partial<TaskTestVersion> = {}): TaskTestVersion => ({
    built_at: '2026-01-01T00:00:00Z',
    build_source: 'built',
    fingerprint: 'fp1',
    ...over,
  });

  it('not_recorded when nothing is stored', () => {
    expect(resultVersionState(undefined, 'fp1')).toBe('not_recorded');
  });
  it('unknown without a recorded fingerprint', () => {
    expect(resultVersionState(rec({ fingerprint: undefined }), 'fp1')).toBe('unknown');
  });
  it('unknown without a synced fingerprint', () => {
    expect(resultVersionState(rec(), undefined)).toBe('unknown');
  });
  it('current when equal', () => {
    expect(resultVersionState(rec(), 'fp1')).toBe('current');
  });
  it('older when different', () => {
    expect(resultVersionState(rec(), 'fp2')).toBe('older');
  });
});
