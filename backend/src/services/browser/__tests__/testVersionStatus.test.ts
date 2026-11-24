import { describe, it, expect } from 'vitest';
import type {
  BuildVersionStamp,
  CurrentTestVersion,
  TaskTestVersion,
  TestVersionIdentity,
} from '../../../types/testVersion.js';
import { deriveStatus, resultStateForTest, resultVersionState } from '../testVersionStatus.js';
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
    currentOutputsHash: undefined,
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
          version: stamp({ commit: 'c0', fingerprint: 'old', source_hash: 'old' }),
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
          version: stamp({ commit: 'c0', fingerprint: 'old', source_hash: 'old' }),
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
          version: stamp({ commit: 'c0', fingerprint: 'old', shared_hash: 'old' }),
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
          version: stamp({ commit: 'c0', fingerprint: 'old', source_hash: 'old' }),
        },
        currentDepsHash: 'd2',
      }),
    );
    expect(r.reason).toBe('test_source_changed');
  });

  describe('embedded files the build produced (outputs hash)', () => {
    const withOutputs = (o: string | null) =>
      ({ exists: true, source: 'built', version: stamp({ outputs_hash: o }) }) as const;

    it('rebuild_needed / dependency_changed when the outputs hash differs', () => {
      expect(deriveStatus(input({ build: withOutputs('o1'), currentOutputsHash: 'o2' }))).toEqual({
        status: 'rebuild_needed',
        reason: 'dependency_changed',
      });
    });

    it('a stamped hash against none now (or the reverse) differs', () => {
      expect(deriveStatus(input({ build: withOutputs('o1'), currentOutputsHash: null })).status)
        .toBe('rebuild_needed');
      expect(deriveStatus(input({ build: withOutputs(null), currentOutputsHash: 'o1' })).status)
        .toBe('rebuild_needed');
    });

    it('up_to_date when the outputs hashes are equal (null included)', () => {
      expect(deriveStatus(input({ build: withOutputs('o1'), currentOutputsHash: 'o1' })))
        .toEqual({ status: 'up_to_date' });
      expect(deriveStatus(input({ build: withOutputs(null), currentOutputsHash: null })))
        .toEqual({ status: 'up_to_date' });
    });

    it('currentOutputsHash undefined: not compared', () => {
      expect(deriveStatus(input({ build: withOutputs('o1'), currentOutputsHash: undefined })))
        .toEqual({ status: 'up_to_date' });
    });

    it('a stamp written before outputs_hash existed: not compared', () => {
      expect(deriveStatus(input({ currentOutputsHash: 'o2' }))).toEqual({ status: 'up_to_date' });
    });

    it('a fingerprint difference still wins with its own reason', () => {
      const r = deriveStatus(
        input({
          build: {
            exists: true,
            source: 'built',
            version: stamp({ commit: 'c0', fingerprint: 'old', shared_hash: 'old', outputs_hash: 'o1' }),
          },
          currentOutputsHash: 'o2',
        }),
      );
      expect(r).toEqual({ status: 'rebuild_needed', reason: 'shared_changed' });
    });
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

describe('deriveStatus: a build from the commit synced now', () => {
  // The fingerprint rule changed between the build and now: the hashes differ
  // although no file did. With git, one commit is one set of files.
  const oldRule = (over: Partial<BuildVersionStamp> = {}): StatusInput['build'] => ({
    exists: true,
    source: 'built',
    version: stamp({ fingerprint: 'old', source_hash: 'old', ...over }),
  });

  it('up_to_date when the fingerprints differ but the commit is the same', () => {
    expect(deriveStatus(input({ build: oldRule() }))).toEqual({ status: 'up_to_date' });
  });

  it('rebuild_needed when the commit differs too', () => {
    expect(deriveStatus(input({ build: oldRule({ commit: 'c0' }) }))).toEqual({
      status: 'rebuild_needed',
      reason: 'test_source_changed',
    });
  });

  it('rebuild_needed without a commit on the build or on the synced side (no git)', () => {
    expect(deriveStatus(input({ build: oldRule({ commit: null }) })).status).toBe('rebuild_needed');
    expect(
      deriveStatus(input({ build: oldRule({ commit: null }), synced: identity({ commit: null }), hasGit: false })).status,
    ).toBe('rebuild_needed');
  });

  it('a build from changed source at the same commit stays unknown_build', () => {
    expect(deriveStatus(input({ build: oldRule({ modified: true }) }))).toEqual({
      status: 'unknown_build',
      reason: 'modified_source',
    });
  });

  it('the same commit still asks for a rebuild when an uploaded dependency changed', () => {
    expect(deriveStatus(input({ build: oldRule(), currentDepsHash: 'd2' }))).toEqual({
      status: 'rebuild_needed',
      reason: 'dependency_changed',
    });
  });

  it('the same commit still asks for a rebuild when a built embedded file changed', () => {
    expect(deriveStatus(input({ build: oldRule({ outputs_hash: 'o1' }), currentOutputsHash: 'o2' }))).toEqual({
      status: 'rebuild_needed',
      reason: 'dependency_changed',
    });
  });

  it('the same commit is not_checked while no published check has succeeded', () => {
    expect(deriveStatus(input({ build: oldRule(), publishedKnown: false })).status).toBe('not_checked');
  });
});

describe('deriveStatus never guesses up_to_date', () => {
  const builds: Array<[string, StatusInput['build']]> = [
    ['clean stamp', { exists: true, source: 'built', version: stamp() }],
    ['older stamp', { exists: true, source: 'built', version: stamp({ commit: 'c0', fingerprint: 'old' }) }],
    ['old rule, same commit', { exists: true, source: 'built', version: stamp({ fingerprint: 'old' }) }],
    ['old rule, no commit', { exists: true, source: 'built', version: stamp({ commit: null, fingerprint: 'old' }) }],
    ['other deps', { exists: true, source: 'built', version: stamp({ deps_hash: 'x' }) }],
    ['no build', { exists: false }],
    ['uploaded', { exists: true, source: 'uploaded' }],
    ['unstamped', { exists: true, source: 'built' }],
    ['modified', { exists: true, source: 'built', version: stamp({ modified: true }) }],
    ['outputs o1', { exists: true, source: 'built', version: stamp({ outputs_hash: 'o1' }) }],
    ['outputs null', { exists: true, source: 'built', version: stamp({ outputs_hash: null }) }],
  ];
  const currentOutputs: Array<string | null | undefined> = ['o1', 'o2', null, undefined];
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
            for (const currentOutputsHash of currentOutputs)
            it(`${bName} / synced ${synced ? 'set' : 'undefined'} / git ${hasGit} / known ${publishedKnown} / published ${pName} / outputs ${String(currentOutputsHash)}`, () => {
              const i: StatusInput = {
                build,
                synced,
                published,
                publishedKnown,
                hasGit,
                currentDepsHash: 'd1',
                currentOutputsHash,
              };
              const r = deriveStatus(i);
              if (r.status !== 'up_to_date') return;
              const v = build.version;
              expect(build.source).toBe('built');
              expect(v?.modified).toBe(false);
              expect(synced).toBeDefined();
              const sameFingerprint = v?.fingerprint === synced?.fingerprint;
              const sameCommit = !!v?.commit && v.commit === synced?.commit;
              expect(sameFingerprint || sameCommit).toBe(true);
              expect(v?.deps_hash).toBe(i.currentDepsHash);
              if (v?.outputs_hash !== undefined && currentOutputsHash !== undefined) {
                expect(v.outputs_hash).toBe(currentOutputsHash);
              }
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
    commit: 'c1',
    fingerprint: 'fp1',
    ...over,
  });
  const now = (over: Partial<CurrentTestVersion> = {}): CurrentTestVersion => ({ fingerprint: 'fp1', commit: 'c1', ...over });

  it('not_recorded when nothing is stored', () => {
    expect(resultVersionState(undefined, now())).toBe('not_recorded');
  });
  it('unknown without a recorded fingerprint', () => {
    expect(resultVersionState(rec({ fingerprint: undefined }), now())).toBe('unknown');
  });
  it('unknown without a synced version', () => {
    expect(resultVersionState(rec(), undefined)).toBe('unknown');
  });
  it('current when the fingerprints are equal', () => {
    expect(resultVersionState(rec(), now())).toBe('current');
    expect(resultVersionState(rec({ commit: 'c0' }), now())).toBe('current');
    expect(resultVersionState(rec({ commit: undefined }), now({ commit: null }))).toBe('current');
  });
  it('older when the fingerprint and the commit differ', () => {
    expect(resultVersionState(rec({ commit: 'c0' }), now({ fingerprint: 'fp2' }))).toBe('older');
  });
  it('current when the fingerprints differ but the commit is the one synced now', () => {
    // A fingerprint computed under an earlier rule: same commit, same files.
    expect(resultVersionState(rec(), now({ fingerprint: 'fp2' }))).toBe('current');
  });
  it('older when the fingerprints differ and either side has no commit', () => {
    expect(resultVersionState(rec({ commit: undefined }), now({ fingerprint: 'fp2' }))).toBe('older');
    expect(resultVersionState(rec(), now({ fingerprint: 'fp2', commit: null }))).toBe('older');
    expect(resultVersionState(rec({ commit: undefined }), now({ fingerprint: 'fp2', commit: null }))).toBe('older');
  });
  it('a commit without a fingerprint is never current: the stamp was not trusted', () => {
    expect(resultVersionState(rec({ fingerprint: undefined }), now())).toBe('unknown');
  });
});

describe('resultStateForTest', () => {
  const current = new Map<string, CurrentTestVersion>([['t1', { fingerprint: 'fp2', commit: 'c1' }]]);

  it('not_recorded without a version', () => {
    expect(resultStateForTest(undefined, 't1', current)).toBe('not_recorded');
  });
  it('unknown for a test that is not in the map, even at the same commit', () => {
    expect(resultStateForTest({ fingerprint: 'fp1', commit: 'c1' }, 'gone', current)).toBe('unknown');
  });
  it('current for the same commit, older for another', () => {
    expect(resultStateForTest({ fingerprint: 'fp1', commit: 'c1' }, 't1', current)).toBe('current');
    expect(resultStateForTest({ fingerprint: 'fp1', commit: 'c0' }, 't1', current)).toBe('older');
  });
});
