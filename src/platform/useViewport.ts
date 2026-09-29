import { useEffect } from 'react';

/** Track usable CSS pixels, including a WebView/browser's on-screen keyboard. */
export function useViewport() {
  useEffect(() => {
    const root = document.documentElement;
    const viewport = window.visualViewport;
    let frame = 0;
    const update = () => {
      frame = 0;
      // Pinch zoom is a user magnification choice, not a smaller device layout.
      if (viewport && Math.abs(viewport.scale - 1) > 0.02) return;
      const width = viewport?.width || window.innerWidth;
      const height = viewport?.height || window.innerHeight;
      if (width <= 0 || height <= 0) return;
      root.style.setProperty('--app-viewport-width', `${width}px`);
      root.style.setProperty('--app-viewport-height', `${height}px`);
      root.style.setProperty('--app-viewport-top', `${viewport?.offsetTop || 0}px`);
      root.style.setProperty('--app-viewport-left', `${viewport?.offsetLeft || 0}px`);
      root.dataset.shortViewport = String(height <= 600);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    window.addEventListener('resize', schedule);
    viewport?.addEventListener('resize', schedule);
    viewport?.addEventListener('scroll', schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', schedule);
      viewport?.removeEventListener('resize', schedule);
      viewport?.removeEventListener('scroll', schedule);
      for (const key of ['width', 'height', 'top', 'left']) root.style.removeProperty(`--app-viewport-${key}`);
      delete root.dataset.shortViewport;
    };
  }, []);
}
