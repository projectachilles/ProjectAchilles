/**
 * Label menu for agent tags: a searchable checklist of every tag in the fleet.
 * For the agents it acts on, each tag shows ✓ (all have it), – (some) or an
 * empty box (none); one click adds it to, or removes it from, all of them.
 * Typing a new name offers "Create". Used by the row "+ tag" button (one
 * agent) and the bulk "Tags" button (the selection).
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Check, Minus, Plus } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { TAG_RULE_HINT, normalizeTag, tagState, type TagChange, type TagCount } from './agentTagRules';

interface TagPickerProps {
  /** Every tag in use (fleet-wide), for suggestions. */
  allTags: TagCount[];
  /** The tags of each agent the picker acts on, one entry per agent. */
  agentTags: string[][];
  onChange: (change: TagChange) => Promise<void> | void;
  /** The trigger button. */
  children: ReactNode;
  align?: 'start' | 'end';
}

export function TagPicker({ allTags, agentTags, onChange, children, align = 'start' }: TagPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setQuery('');
      return;
    }
    // Radix focuses the menu itself on open; put the cursor in the search box.
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  // Fleet tags plus any legacy tag the agents carry that isn't in the list yet.
  const options = useMemo(() => {
    const names = new Set(allTags.map((t) => t.tag));
    for (const tags of agentTags) for (const t of tags) names.add(t);
    const q = query.trim().toLowerCase();
    return [...names].filter((n) => !q || n.toLowerCase().includes(q));
  }, [allTags, agentTags, query]);

  const created = normalizeTag(query);
  const canCreate = created !== null && !options.includes(created) && !allTags.some((t) => t.tag === created);

  async function apply(change: TagChange) {
    setBusy(true);
    try {
      await onChange(change);
    } finally {
      setBusy(false);
    }
  }

  function toggle(tag: string) {
    const { state } = tagState(tag, agentTags);
    void apply(state === 'all' ? { remove: [tag] } : { add: [tag] });
  }

  function create() {
    if (!created) return;
    setQuery('');
    void apply({ add: [created] });
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-72 bg-overlay p-0">
        <div className="border-b border-border p-2">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              // Keep typing in the box: the menu would treat letters as typeahead.
              if (e.key === 'Enter') {
                e.preventDefault();
                if (canCreate) create();
                else if (options.length === 1) toggle(options[0]);
              }
              if (e.key !== 'Escape' && e.key !== 'ArrowDown' && e.key !== 'Tab') e.stopPropagation();
            }}
            placeholder="Search or create a tag…"
            aria-label="Search or create a tag"
            className="h-8 w-full rounded-md border border-border bg-raised px-2.5 text-sm outline-none placeholder:text-faint focus-visible:outline-2 focus-visible:outline-accent"
          />
        </div>
        <div className={cn('max-h-64 overflow-y-auto p-1', busy && 'pointer-events-none opacity-60')} aria-busy={busy}>
          {options.map((tag) => {
            const { state, count } = tagState(tag, agentTags);
            return (
              <DropdownMenuItem
                key={tag}
                onSelect={(e) => {
                  e.preventDefault(); // stay open: tagging is often several clicks
                  toggle(tag);
                }}
                aria-checked={state === 'all' ? true : state === 'some' ? 'mixed' : false}
                role="menuitemcheckbox"
                className="gap-2"
              >
                <span
                  className={cn(
                    'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                    state === 'all' && 'border-accent bg-accent text-accent-foreground',
                    // outlined, so "some" never reads as "all" at a glance
                    state === 'some' && 'border-accent bg-accent-dim text-accent',
                    state === 'none' && 'border-faint',
                  )}
                  aria-hidden="true"
                >
                  {state === 'all' && <Check className="h-3 w-3" />}
                  {state === 'some' && <Minus className="h-3 w-3" />}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{tag}</span>
                {state === 'some' && agentTags.length > 1 && (
                  <span className="text-[11px] text-faint">
                    {count} of {agentTags.length}
                  </span>
                )}
              </DropdownMenuItem>
            );
          })}
          {canCreate && (
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                create();
              }}
              className="gap-2 text-accent"
            >
              <Plus className="h-4 w-4" />
              <span className="text-xs">
                Create <span className="font-mono">{created}</span>
              </span>
            </DropdownMenuItem>
          )}
          {options.length === 0 && !canCreate && (
            <p className="px-2 py-1.5 text-xs text-faint">{query ? TAG_RULE_HINT : 'No tags yet: type a name to create one'}</p>
          )}
        </div>
        <div className="border-t border-border px-3 py-2 text-[11px] text-faint">
          {agentTags.length > 1
            ? `✓ all · – some · click to add to / remove from all ${agentTags.length}`
            : 'Click to add or remove'}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
