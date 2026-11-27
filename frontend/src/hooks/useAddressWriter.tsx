import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

/**
 * Writes a page's address so that no write erases another.
 *
 * React Router's `setSearchParams(fn)` hands `fn` the address of the last
 * render, not the result of a write still on its way. Two writers that run
 * before the page redraws (an effect syncing the filters, a click, a list
 * writing its selected run) each start from the same address, and the last one
 * wins: a bar clicked on the activity strip was lost that way, and so was a new
 * date range.
 *
 * This writer remembers the addresses it asked for that the page has not drawn
 * yet, and starts every write from the last of them. It lets go of them as the
 * page catches up, and forgets them all when someone else navigates (a link, the
 * back button), so it never brings back an address the user left.
 *
 * Every writer of a page's address should go through one writer: wrap the page
 * in `AddressWriterProvider`. Write from effects and event handlers, not from
 * layout effects (the location it compares with is the committed one, updated
 * in a layout effect of the provider, which runs after its children's).
 */
export interface AddressWriter {
  /** Change the address's search parameters. The callback edits the parameters in place. */
  update(change: (next: URLSearchParams) => void, options?: { replace?: boolean }): void;
}

/**
 * What is still on its way once a location is drawn. The same location as last
 * time (the page drew something else): everything. A new one that is among the
 * addresses asked for: what was asked after it. Any other: nothing, someone
 * else navigated.
 */
export function stillPending(
  pending: string[],
  seenKey: string | null,
  drawn: { key: string; search: string },
): string[] {
  if (drawn.key === seenKey) return pending;
  const at = pending.lastIndexOf(drawn.search);
  return at >= 0 ? pending.slice(at + 1) : [];
}

function useWriter(): AddressWriter {
  const location = useLocation();
  const navigate = useNavigate();
  // The committed location and navigate function, for writes made from effects and event handlers.
  const committed = useRef(location);
  const go = useRef(navigate);
  useLayoutEffect(() => {
    committed.current = location;
    go.current = navigate;
  });
  /** Searches asked for and not drawn yet, oldest first. */
  const pending = useRef<string[]>([]);
  /** The key of the location the pending list was last compared with. */
  const seen = useRef<string | null>(null);

  const update = useCallback<AddressWriter['update']>((change, options = {}) => {
    const now = committed.current;
    pending.current = stillPending(pending.current, seen.current, now);
    seen.current = now.key;
    const from = pending.current.length > 0 ? pending.current[pending.current.length - 1] : now.search;
    const next = new URLSearchParams(from);
    change(next);
    const query = next.toString();
    const search = query ? `?${query}` : '';
    if (search === from) return;
    pending.current.push(search);
    // As setSearchParams does: the same path, this search.
    go.current(`?${query}`, { replace: options.replace });
  }, []);

  return useMemo(() => ({ update }), [update]);
}

const AddressWriterContext = createContext<AddressWriter | null>(null);

/** One writer for every hook and component of a page that writes its address. */
export function AddressWriterProvider({ children }: { children: ReactNode }) {
  const writer = useWriter();
  return <AddressWriterContext.Provider value={writer}>{children}</AddressWriterContext.Provider>;
}

/** The page's writer; outside a provider, a writer of this hook's own (same rules). */
export function useAddressWriter(): AddressWriter {
  const shared = useContext(AddressWriterContext);
  const own = useWriter();
  return shared ?? own;
}
