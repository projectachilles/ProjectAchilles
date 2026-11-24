/**
 * What a registered agent version was made from, read back from its release
 * notes. Build from source writes them in one fixed form (the backend's
 * `buildReleaseNotes`): "Built from source (<os>/<arch>) at <commit>", plus
 * "(source says <v>)" when the code on the server was another version than the
 * one typed for the build. An uploaded binary carries whatever the uploader
 * typed, so anything that is not exactly that form is plain notes.
 */
export type VersionSource =
  | { kind: 'source'; commit: string | null; sourceVersion: string | null }
  | { kind: 'notes'; notes: string }
  | { kind: 'none' };

const BUILT_FROM_SOURCE = /^Built from source \([^()]+\)(?: at ([0-9a-f]{7,40}))?(?: \(source says ([^()]+)\))?$/;

export function describeVersionSource(releaseNotes: string | null | undefined): VersionSource {
  const notes = (releaseNotes ?? '').trim();
  if (!notes) return { kind: 'none' };
  const match = BUILT_FROM_SOURCE.exec(notes);
  if (!match) return { kind: 'notes', notes };
  return { kind: 'source', commit: match[1] ?? null, sourceVersion: match[2] ?? null };
}
