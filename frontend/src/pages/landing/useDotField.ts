import { useEffect, type RefObject } from 'react';

const ACCENT = '31,63,224';

/**
 * Hero dot field: a grid of 1.2px accent squares every `gap` px whose alpha
 * breathes on a slow sine wave (0.06–0.18) and which brighten to ~0.7 and grow
 * to ~4px within 220px of the cursor. Mouse position is tracked on `hostRef`
 * (the hero section) since the canvas itself is pointer-events: none.
 * Honors prefers-reduced-motion by drawing a single static frame.
 */
export function useDotField(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  hostRef: RefObject<HTMLElement | null>,
  gap = 28
) {
  useEffect(() => {
    const c = canvasRef.current;
    const host = hostRef.current;
    if (!c || !host) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;

    let w = 0;
    let h = 0;
    let cols = 0;
    let rows = 0;
    let cells: number[] = [];

    const resize = () => {
      w = c.width = c.offsetWidth;
      h = c.height = c.offsetHeight;
      cols = Math.ceil(w / gap);
      rows = Math.ceil(h / gap);
      cells = Array.from({ length: cols * rows }, () => Math.random());
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(c);

    let mx = -1e4;
    let my = -1e4;
    const onMove = (e: MouseEvent) => {
      const r = c.getBoundingClientRect();
      mx = e.clientX - r.left;
      my = e.clientY - r.top;
    };
    host.addEventListener('mousemove', onMove);

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let t = 0;
    let raf = 0;

    const draw = () => {
      if (c.width !== c.offsetWidth || c.height !== c.offsetHeight) resize();
      t += 0.012;
      ctx.clearRect(0, 0, w, h);
      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
          const x = i * gap + gap / 2;
          const y = j * gap + gap / 2;
          const k = i * rows + j;
          const wave = Math.sin(t * 1.6 + i * 0.22 + j * 0.31) * 0.5 + 0.5;
          const d = Math.hypot(x - mx, y - my);
          const near = Math.max(0, 1 - d / 220);
          const a = 0.06 + wave * 0.12 * cells[k] + near * 0.7;
          const s = 1.2 + near * 3;
          ctx.fillStyle = `rgba(${ACCENT},${Math.min(a, 1)})`;
          ctx.fillRect(x - s / 2, y - s / 2, s, s);
        }
      }
      if (!reduced) raf = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      host.removeEventListener('mousemove', onMove);
    };
  }, [canvasRef, hostRef, gap]);
}
