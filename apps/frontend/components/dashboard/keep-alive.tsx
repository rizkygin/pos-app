'use client';

import {
  Activity,
  Fragment,
  createContext,
  useContext,
  useLayoutEffect,
  useState,
  type ReactNode,
} from 'react';
import { usePathname } from 'next/navigation';

/**
 * Keep a page alive across dashboard navigation.
 *
 * Next unmounts a page when the user opens another menu, so coming back meant
 * a loading spinner and a page rebuilt from nothing: products re-rendered,
 * search and scroll gone, every request made again. For the cashier, a screen
 * a till sits on all day and leaves only to glance at something else, that
 * read as a hard refresh on every menu click.
 *
 * A page wrapped in <KeepAlive> hands its content to the <KeepAliveHost> in
 * the dashboard layout. Layouts are not unmounted by navigation, so the host
 * keeps that content mounted for as long as the dashboard is open and hides
 * it with React's <Activity> while another page is showing. Hidden is the
 * same as Next's own route preservation under Cache Components (not enabled
 * here, as it would change every page at once): state and DOM are kept,
 * effects are cleaned up while hidden and run again when shown. So anything
 * kept alive must treat "effect runs" as "shown again", not "first mount".
 *
 * Coming back shows the kept page at once. The route's own server render
 * still runs in the background, and when it arrives its fresh props are
 * handed over and applied to the same instance.
 *
 * The cost is server rendering: on a full page load the kept page renders on
 * the client, after hydration, and `fallback` is what shows until then.
 */

type Kept = { path: string; cacheKey: string; node: ReactNode };

const KeepAliveContext = createContext<((kept: Kept) => void) | null>(null);

export function KeepAliveHost({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [kept, setKept] = useState<Kept | null>(null);
  const showingKept = kept !== null && pathname === kept.path;

  return (
    <KeepAliveContext.Provider value={setKept}>
      {kept && (
        <Activity mode={showingKept ? 'visible' : 'hidden'}>
          {/* A different user or outlet starts fresh rather than inheriting
              the previous one's carts and drafts. */}
          <Fragment key={kept.cacheKey}>{kept.node}</Fragment>
        </Activity>
      )}
      {/* The route's own output: hidden, not removed, while the kept page is
          on screen. Removed, its <KeepAlive> could no longer hand over the
          fresh props; and what it shows meanwhile is the loading spinner,
          which is exactly what keeping the page alive is meant to skip.
          `contents` while visible, so the wrapper never touches the layout
          of the pages it holds. */}
      <div className={showingKept ? 'hidden' : 'contents'}>{children}</div>
    </KeepAliveContext.Provider>
  );
}

/**
 * Hand `children` to the host to be kept alive at `path`.
 *
 * Without a host above it, renders `children` in place like any page.
 */
export function KeepAlive({
  path,
  cacheKey,
  fallback = null,
  children,
}: {
  /** The pathname the kept content belongs to, e.g. "/dashboard/cashier". */
  path: string;
  /** Changing it discards the kept instance and mounts a fresh one. */
  cacheKey: string;
  /** Shown on a full page load until the kept content takes over. */
  fallback?: ReactNode;
  children: ReactNode;
}) {
  const register = useContext(KeepAliveContext);

  // Layout effect: the host takes over in the same frame, so a soft
  // navigation never paints the fallback.
  useLayoutEffect(() => {
    register?.({ path, cacheKey, node: children });
  }, [register, path, cacheKey, children]);

  return register ? fallback : children;
}
