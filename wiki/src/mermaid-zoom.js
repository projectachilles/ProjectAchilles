/**
 * Mermaid diagram click-to-fullscreen.
 *
 * Attaches a click handler to every `.docusaurus-mermaid-container`
 * that clones the SVG into a fullscreen overlay. Close with click
 * or ESC. Runs automatically on every route change via Docusaurus
 * client module lifecycle.
 */

const OVERLAY_CLASS = 'mermaid-fullscreen-overlay';

function closeOverlay() {
  const overlay = document.querySelector(`.${OVERLAY_CLASS}`);
  if (overlay) {
    overlay.remove();
    document.body.style.overflow = '';
  }
}

function openFullscreen(svg) {
  // Prevent duplicate overlays
  closeOverlay();

  const overlay = document.createElement('div');
  overlay.className = OVERLAY_CLASS;

  const hint = document.createElement('span');
  hint.className = 'mermaid-fullscreen-hint';
  hint.textContent = 'Click anywhere or press ESC to close';
  overlay.appendChild(hint);

  const clone = svg.cloneNode(true);
  // Remove fixed dimensions so the SVG scales to fit the viewport
  clone.removeAttribute('width');
  clone.removeAttribute('height');
  clone.removeAttribute('style');
  overlay.appendChild(clone);

  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';

  overlay.addEventListener('click', closeOverlay);
}

function attachHandlers() {
  const containers = document.querySelectorAll('.docusaurus-mermaid-container');
  containers.forEach((container) => {
    if (container.dataset.zoomAttached) return;
    container.dataset.zoomAttached = 'true';

    container.addEventListener('click', () => {
      const svg = container.querySelector('svg');
      if (svg) openFullscreen(svg);
    });
  });
}

function handleKeydown(e) {
  if (e.key === 'Escape') closeOverlay();
}

// Docusaurus client module lifecycle hook — runs after every navigation
export function onRouteDidUpdate() {
  // Mermaid renders asynchronously; wait for SVGs to appear
  setTimeout(attachHandlers, 600);
  // Catch late renders (complex diagrams)
  setTimeout(attachHandlers, 1500);
}

// Global ESC handler (registered once)
if (typeof window !== 'undefined') {
  document.addEventListener('keydown', handleKeydown);
}
