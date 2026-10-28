// Same rule as the backend (services/agent/tagRules.ts): trimmed, lowercased,
// 1-32 characters of a-z 0-9 . _ : - starting with a letter or digit. Checked
// here so the picker can say why a name won't work before sending it.

export const TAG_RULE_HINT = 'Lowercase letters, digits and . _ : - (up to 32)';

export function normalizeTag(raw: string): string | null {
  const tag = raw.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9._:-]{0,31}$/.test(tag) ? tag : null;
}

export interface TagCount {
  tag: string;
  count: number;
}

export interface TagChange {
  add?: string[];
  remove?: string[];
}

export type TagState = 'all' | 'some' | 'none';

/** Whether every, some or none of the given agents carry a tag (the label-menu checkbox). */
export function tagState(tag: string, agentTags: string[][]): { state: TagState; count: number } {
  const count = agentTags.filter((tags) => tags.includes(tag)).length;
  const state: TagState = count === 0 ? 'none' : count === agentTags.length ? 'all' : 'some';
  return { state, count };
}

export interface TagSnapshot {
  id: string;
  tags: string[];
}

/**
 * Each agent's tags before a change, for Undo — exact lists, so Undo keeps the
 * order (the first tag is the agent's group) and legacy spellings. Null when an
 * agent isn't on the loaded page: its previous tags are unknown, so no Undo.
 */
export function tagSnapshot(agentIds: string[], agents: { id: string; tags: string[] }[]): TagSnapshot[] | null {
  const snapshot: TagSnapshot[] = [];
  for (const id of agentIds) {
    const agent = agents.find((a) => a.id === id);
    if (!agent) return null;
    snapshot.push({ id, tags: [...agent.tags] });
  }
  return snapshot;
}
