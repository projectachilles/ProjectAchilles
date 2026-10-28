import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { normalizeTag, tagSnapshot, tagState } from '../agentTagRules';
import { TagPicker } from '../TagPicker';
import { TagChips } from '../TagChips';

const allTags = [
  { tag: 'cs-falcon', count: 6 },
  { tag: 's1', count: 4 },
  { tag: 'finance', count: 2 },
];

describe('agent tag rules', () => {
  it('normalizes like the backend', () => {
    expect(normalizeTag('  CS-Falcon ')).toBe('cs-falcon');
    expect(normalizeTag('two words')).toBeNull();
    expect(normalizeTag('x'.repeat(33))).toBeNull();
  });

  it('reports all / some / none across agents', () => {
    const agents = [['a', 'b'], ['a']];
    expect(tagState('a', agents)).toEqual({ state: 'all', count: 2 });
    expect(tagState('b', agents)).toEqual({ state: 'some', count: 1 });
    expect(tagState('c', agents)).toEqual({ state: 'none', count: 0 });
  });

  it('snapshots exact previous tags for Undo, or nothing when an agent is off the page', () => {
    const page = [
      { id: 'a1', tags: ['s1', 'Finance'] },
      { id: 'a2', tags: [] },
    ];
    const snap = tagSnapshot(['a1', 'a2'], page);
    expect(snap).toEqual([{ id: 'a1', tags: ['s1', 'Finance'] }, { id: 'a2', tags: [] }]);
    page[0].tags.push('later');
    expect(snap?.[0].tags).toEqual(['s1', 'Finance']);
    expect(tagSnapshot(['a1', 'elsewhere'], page)).toBeNull();
  });
});

describe('TagPicker (label menu)', () => {
  async function open(agentTags: string[][], onChange = vi.fn()) {
    const user = userEvent.setup();
    render(
      <TagPicker allTags={allTags} agentTags={agentTags} onChange={onChange}>
        <button type="button">Tags</button>
      </TagPicker>,
    );
    await user.click(screen.getByRole('button', { name: 'Tags' }));
    return { user, onChange };
  }
  const item = (name: string) => screen.getByRole('menuitemcheckbox', { name: new RegExp(`^${name}`) });

  it('shows ✓ / – / empty for the selected agents', async () => {
    await open([['cs-falcon', 'finance'], ['cs-falcon'], ['s1', 'cs-falcon']]);
    expect(item('cs-falcon').getAttribute('aria-checked')).toBe('true');
    expect(item('finance').getAttribute('aria-checked')).toBe('mixed');
    expect(within(item('finance')).getByText('1 of 3')).toBeTruthy();
    expect(item('s1').getAttribute('aria-checked')).toBe('mixed');
  });

  it('adds a partly-applied tag to every agent, and removes one they all have', async () => {
    const { user, onChange } = await open([['cs-falcon', 'finance'], ['cs-falcon']]);
    await user.click(item('finance'));
    expect(onChange).toHaveBeenLastCalledWith({ add: ['finance'] });
    await user.click(item('cs-falcon'));
    expect(onChange).toHaveBeenLastCalledWith({ remove: ['cs-falcon'] });
  });

  it('creates a new tag from the search box with Enter, normalized', async () => {
    const { user, onChange } = await open([[]]);
    await user.type(screen.getByRole('textbox', { name: /search or create/i }), ' Pilot-Group {Enter}');
    expect(onChange).toHaveBeenCalledWith({ add: ['pilot-group'] });
  });

  it('explains the rule instead of offering an invalid name', async () => {
    const { user, onChange } = await open([[]]);
    await user.type(screen.getByRole('textbox', { name: /search or create/i }), 'two words');
    expect(screen.queryByText(/^Create/)).toBeNull();
    expect(screen.getByText(/lowercase letters, digits/i)).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('TagChips', () => {
  it('removes a tag with its × button', async () => {
    const onChange = vi.fn();
    render(<TagChips tags={['cs-falcon', 'finance']} allTags={allTags} agentName="SB11199" onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Remove tag finance from SB11199' }));
    expect(onChange).toHaveBeenCalledWith({ remove: ['finance'] });
    expect(screen.getByRole('button', { name: 'Add tag to SB11199' })).toBeTruthy();
  });

  it('is read-only without edit rights', () => {
    render(<TagChips tags={['cs-falcon']} allTags={allTags} agentName="SB11199" />);
    expect(screen.getByText('cs-falcon')).toBeTruthy();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});
