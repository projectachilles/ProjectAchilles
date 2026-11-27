import { describe, it, expect } from 'vitest';
import { act, render, renderHook } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate, useNavigationType, useSearchParams } from 'react-router-dom';
import { StrictMode, Suspense, useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { AddressWriterProvider, stillPending, useAddressWriter } from '../useAddressWriter';

// One writer for a page's address: a write starts from what was last asked for,
// not from the address of the last render, so two writes never erase each other.

function setup(search = '?tab=executions', opts: { provider?: boolean; entries?: string[] } = {}) {
  const entries = opts.entries ?? [`/analytics${search}`];
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
      {opts.provider === false ? children : <AddressWriterProvider>{children}</AddressWriterProvider>}
    </MemoryRouter>
  );
  const { result, rerender } = renderHook(
    () => {
      const [other, setOther] = useState(0);
      return {
        writer: useAddressWriter(),
        second: useAddressWriter(),
        raw: useSearchParams()[1],
        location: useLocation(),
        navigationType: useNavigationType(),
        navigate: useNavigate(),
        other,
        setOther,
      };
    },
    { wrapper },
  );
  const params = () => Object.fromEntries(new URLSearchParams(result.current.location.search));
  const set = (key: string, value: string) => (p: URLSearchParams) => { p.set(key, value); };
  return { result, rerender, params, set };
}

describe('stillPending: what is still on its way once a location is drawn', () => {
  const PENDING = ['?a=1', '?a=1&b=2', '?a=1&b=2&c=3'];

  it('keeps everything while the location drawn is the one already seen', () => {
    expect(stillPending(PENDING, 'k0', { key: 'k0', search: '' })).toBe(PENDING);
  });

  it('drops what was asked up to the address drawn, and keeps what was asked after it', () => {
    expect(stillPending(PENDING, 'k0', { key: 'k1', search: '?a=1' })).toEqual(['?a=1&b=2', '?a=1&b=2&c=3']);
    expect(stillPending(PENDING, 'k0', { key: 'k1', search: '?a=1&b=2&c=3' })).toEqual([]);
  });

  it('drops everything when the address drawn is none it asked for', () => {
    expect(stillPending(PENDING, 'k0', { key: 'k1', search: '?tab=dashboard' })).toEqual([]);
  });

  it('takes the last time an address was asked for, when it was asked for twice', () => {
    expect(stillPending(['?a=1', '?b=2', '?a=1', '?c=3'], 'k0', { key: 'k1', search: '?a=1' })).toEqual(['?c=3']);
  });
});

describe('useAddressWriter', () => {
  it('lands two writes made in one tick, where the router\'s own setter keeps only the last', () => {
    const raw = setup();
    act(() => {
      raw.result.current.raw((p) => { const n = new URLSearchParams(p); n.set('a', '1'); return n; }, { replace: true });
      raw.result.current.raw((p) => { const n = new URLSearchParams(p); n.set('b', '2'); return n; }, { replace: true });
    });
    // The setter this replaces: the second write started from the same address as the first.
    expect(raw.params()).toEqual({ tab: 'executions', b: '2' });

    const { result, params, set } = setup();
    act(() => {
      result.current.writer.update(set('a', '1'), { replace: true });
      result.current.writer.update(set('b', '2'), { replace: true });
    });

    expect(params()).toEqual({ tab: 'executions', a: '1', b: '2' });
  });

  it('shares what is pending between every hook under one provider', () => {
    const { result, params, set } = setup();

    act(() => {
      result.current.writer.update(set('a', '1'), { replace: true });
      result.current.second.update(set('b', '2'), { replace: true });
    });

    expect(params()).toEqual({ tab: 'executions', a: '1', b: '2' });
  });

  it('starts from the drawn address once it has caught up', () => {
    const { result, params, set } = setup();
    act(() => result.current.writer.update(set('a', '1'), { replace: true }));
    expect(params()).toEqual({ tab: 'executions', a: '1' });

    act(() => result.current.writer.update((p) => { p.delete('a'); }, { replace: true }));
    act(() => result.current.writer.update(set('b', '2'), { replace: true }));

    expect(params()).toEqual({ tab: 'executions', b: '2' });
  });

  it('forgets what was pending when someone else navigates, and never brings it back', () => {
    const { result, params, set } = setup();

    act(() => {
      result.current.writer.update(set('a', '1'), { replace: true });
      // A link in the page, in the same tick.
      result.current.navigate('/analytics?tab=dashboard');
    });
    act(() => result.current.writer.update(set('b', '2'), { replace: true }));

    expect(params()).toEqual({ tab: 'dashboard', b: '2' });
  });

  it('forgets it on the back button too', () => {
    const { result, params, set } = setup('', { entries: ['/analytics?tab=dashboard', '/analytics?tab=executions'] });

    act(() => result.current.writer.update(set('a', '1'), { replace: true }));
    act(() => result.current.navigate(-1));
    act(() => result.current.writer.update(set('b', '2'), { replace: true }));

    expect(params()).toEqual({ tab: 'dashboard', b: '2' });
  });

  it('takes a navigation back to the very same address as someone else\'s', () => {
    // Same search, new entry: a link to the page as it is. What was pending before it is gone.
    const { result, params, set } = setup();

    act(() => {
      result.current.writer.update(set('a', '1'), { replace: true });
      result.current.navigate('/analytics?tab=executions');
    });
    act(() => result.current.writer.update(set('b', '2'), { replace: true }));

    expect(params()).toEqual({ tab: 'executions', b: '2' });
  });

  it('does not navigate for a write that changes nothing', () => {
    const { result, set } = setup('?tab=executions&a=1');
    const before = result.current.location;

    act(() => result.current.writer.update(set('a', '1'), { replace: true }));

    expect(result.current.location).toBe(before);
  });

  it('replaces the entry, or adds one, as asked', () => {
    const { result, set } = setup();

    act(() => result.current.writer.update(set('a', '1'), { replace: true }));
    expect(result.current.navigationType).toBe('REPLACE');

    act(() => result.current.writer.update(set('b', '2')));
    expect(result.current.navigationType).toBe('PUSH');
  });

  it('keeps the path', () => {
    const { result, set } = setup();
    act(() => result.current.writer.update(set('a', '1'), { replace: true }));
    expect(result.current.location.pathname).toBe('/analytics');
  });

  it('writes an empty address as no search at all', () => {
    const { result } = setup('?tab=executions');
    act(() => result.current.writer.update((p) => { p.delete('tab'); }, { replace: true }));
    expect(result.current.location.search).toBe('');
  });

  it('keeps one identity across renders, so it can be a dependency', () => {
    const { result, set } = setup();
    const first = result.current.writer;

    act(() => result.current.writer.update(set('a', '1'), { replace: true }));
    act(() => result.current.setOther(2));

    expect(result.current.writer).toBe(first);
  });

  it('works without a provider, for a hook used on its own', () => {
    const { result, params, set } = setup('?tab=executions', { provider: false });

    act(() => {
      result.current.writer.update(set('a', '1'), { replace: true });
      result.current.writer.update(set('b', '2'), { replace: true });
    });

    expect(params()).toEqual({ tab: 'executions', a: '1', b: '2' });
  });
});

describe('under StrictMode, which runs every effect twice in development', () => {
  it('writes an effect\'s change once, and keeps the history as it was', () => {
    const entries = ['/analytics?tab=dashboard', '/analytics?tab=executions'];
    const wrapper = ({ children }: { children: ReactNode }) => (
      <StrictMode>
        <MemoryRouter initialEntries={entries} initialIndex={1}>
          <AddressWriterProvider>{children}</AddressWriterProvider>
        </MemoryRouter>
      </StrictMode>
    );
    const keys = new Set<string>();
    const { result } = renderHook(
      () => {
        const writer = useAddressWriter();
        const location = useLocation();
        useEffect(() => {
          writer.update((p) => { p.set('date', '7d'); }, { replace: true });
        }, [writer]);
        keys.add(location.key);
        return { location, navigate: useNavigate() };
      },
      { wrapper },
    );

    expect(Object.fromEntries(new URLSearchParams(result.current.location.search))).toEqual({ tab: 'executions', date: '7d' });
    // The first location and one navigation: the effect ran twice, the second run found the change already asked for.
    expect(keys.size).toBe(2);
    // Replaced, not pushed: back still leads to the entry before.
    act(() => result.current.navigate(-1));
    expect(result.current.location.search).toBe('?tab=dashboard');
  });
});

describe('while a navigation is held', () => {
  // A navigation the page cannot draw yet (a part of it suspends, as a lazy one does): the page keeps
  // drawing the old address, and other state changes draw with it. A write made then must start from
  // the address on its way, not from the one on screen.
  let release: (() => void) | null = null;
  let held: Promise<void> | null = null;
  function HoldsOn({ param }: { param: string }) {
    const { search } = useLocation();
    if (held && new URLSearchParams(search).has(param)) throw held;
    return null;
  }
  type Seen = { writer: ReturnType<typeof useAddressWriter>; search: string; navigate: ReturnType<typeof useNavigate>; setOther: (n: number) => void; other: number };
  function Probe({ seen }: { seen: Partial<Seen> }) {
    const writer = useAddressWriter();
    const { search } = useLocation();
    const navigate = useNavigate();
    const [other, setOther] = useState(0);
    // What is committed, not what a held render tried.
    useLayoutEffect(() => { Object.assign(seen, { writer, search, navigate, setOther, other }); });
    return null;
  }
  function setup() {
    held = new Promise<void>((resolve) => { release = () => { held = null; resolve(); }; });
    const seen: Partial<Seen> = {};
    render(
      <MemoryRouter initialEntries={['/analytics?tab=executions']}>
        <AddressWriterProvider>
          <Suspense fallback={<p>loading</p>}>
            <Probe seen={seen} />
            <HoldsOn param="a" />
          </Suspense>
        </AddressWriterProvider>
      </MemoryRouter>,
    );
    return seen as Seen;
  }

  it('starts from the held address when the page draws something else first', async () => {
    const seen = setup();
    act(() => seen.writer.update((p) => { p.set('a', '1'); }, { replace: true }));
    expect(seen.search).toBe('?tab=executions');

    // Another state change draws the page, still with the old address.
    act(() => seen.setOther(1));
    expect(seen.other).toBe(1);
    expect(seen.search).toBe('?tab=executions');
    act(() => seen.writer.update((p) => { p.set('b', '2'); }, { replace: true }));
    await act(async () => { release!(); await new Promise((r) => setTimeout(r, 0)); });

    expect(seen.search).toBe('?tab=executions&a=1&b=2');
  });
});

describe('a write the router refuses', () => {
  // The router ignores a navigation asked for before the page has mounted (from a layout effect
  // at mount). The writer must not remember it either, or the next write would bring it back.
  it('is forgotten, not carried into the next write', () => {
    const seen: { writer?: ReturnType<typeof useAddressWriter>; search?: string } = {};
    function TooEarly() {
      const writer = useAddressWriter();
      useLayoutEffect(() => { writer.update((p) => { p.set('early', '1'); }, { replace: true }); }, [writer]);
      return null;
    }
    function Probe() {
      const writer = useAddressWriter();
      const { search } = useLocation();
      useLayoutEffect(() => { Object.assign(seen, { writer, search }); });
      return null;
    }
    render(
      <MemoryRouter initialEntries={['/analytics?tab=executions']}>
        <AddressWriterProvider><TooEarly /><Probe /></AddressWriterProvider>
      </MemoryRouter>,
    );
    expect(seen.search).toBe('?tab=executions');

    act(() => seen.writer!.update((p) => { p.set('b', '2'); }, { replace: true }));

    expect(seen.search).toBe('?tab=executions&b=2');
  });
});
