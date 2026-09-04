import { useEffect } from 'react';

/**
 * Scroll reveal for `[data-reveal]` and `[data-grow]` elements inside
 * `.landing-page`. Marks an element with `data-in` once 15% of it enters the
 * viewport (IntersectionObserver), with a getBoundingClientRect fallback on
 * scroll/resize so nothing is left invisible if the observer misses a frame.
 * A MutationObserver picks up elements React mounts later (language switch).
 */
export function useReveal() {
  useEffect(() => {
    const selector = '.landing-page [data-reveal]:not([data-in]), .landing-page [data-grow]:not([data-in])';
    const seen = new WeakSet<Element>();

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.setAttribute('data-in', '1');
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.15 }
    );

    const observeAll = () => {
      document.querySelectorAll(selector).forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.top < window.innerHeight && r.bottom > 0) {
          el.setAttribute('data-in', '1');
          return;
        }
        if (seen.has(el)) return;
        seen.add(el);
        io.observe(el);
      });
    };

    let pending = false;
    const onScroll = () => {
      if (pending) return;
      pending = true;
      setTimeout(() => {
        pending = false;
        observeAll();
      }, 80);
    };

    observeAll();
    const mo = new MutationObserver(observeAll);
    mo.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });

    return () => {
      io.disconnect();
      mo.disconnect();
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);
}
