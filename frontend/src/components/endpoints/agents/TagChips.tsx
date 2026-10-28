/**
 * An agent's tags as chips. With edit rights each chip has an × and a
 * "+ tag" button opens the label menu for this agent; without, read-only.
 */

import { Plus, X } from 'lucide-react';
import { TagPicker } from './TagPicker';
import type { TagChange, TagCount } from './agentTagRules';

interface TagChipsProps {
  tags: string[];
  /** Omit for read-only chips. */
  onChange?: (change: TagChange) => Promise<void> | void;
  allTags: TagCount[];
  /** Names the agent in the remove buttons' labels. */
  agentName: string;
}

export function TagChips({ tags, onChange, allTags, agentName }: TagChipsProps) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tags.map((tag) => (
        <span
          key={tag}
          className="inline-flex h-[22px] items-center gap-1 rounded-full border border-border bg-raised pl-2 pr-1 font-mono text-[11px] text-foreground"
        >
          {tag}
          {onChange ? (
            <button
              type="button"
              onClick={() => void onChange({ remove: [tag] })}
              aria-label={`Remove tag ${tag} from ${agentName}`}
              className="flex h-4 w-4 items-center justify-center rounded-full text-faint transition-colors hover:bg-overlay hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          ) : (
            <span className="w-1" />
          )}
        </span>
      ))}
      {onChange && (
        <TagPicker allTags={allTags} agentTags={[tags]} onChange={onChange}>
          <button
            type="button"
            aria-label={`Add tag to ${agentName}`}
            className="inline-flex h-[22px] items-center gap-0.5 rounded-full border border-dashed border-border-strong px-2 text-[11px] text-faint transition-colors hover:border-accent/40 hover:text-accent"
          >
            <Plus className="h-3 w-3" /> tag
          </button>
        </TagPicker>
      )}
      {!onChange && tags.length === 0 && <span className="text-xs text-faint">—</span>}
    </div>
  );
}
