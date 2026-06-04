'use client';

import { useEffect } from 'react';
import Lenis from 'lenis';

// Inertia smooth-scroll, SCOPED to the landing. Mounted only inside landing
// pages (app/page.tsx, app/privacy), so it sets up on those routes and tears
// down on navigation away — the logged-in workspace app's scrolling is never
// touched. Guardrails: disabled under prefers-reduced-motion, paused when the
// tab is hidden, and fully destroyed on unmount.
export function LenisProvider({ children }: { children?: React.ReactNode }) {
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return; // native scroll, no smoothing

    const lenis = new Lenis({
      duration: 1.1,
      easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
      syncTouch: false, // keep native touch scrolling on mobile
    });

    let rafId = 0;
    let running = true;
    const raf = (time: number) => {
      lenis.raf(time);
      if (running) rafId = requestAnimationFrame(raf);
    };
    rafId = requestAnimationFrame(raf);

    // Pause the rAF loop when the tab is backgrounded.
    const onVisibility = () => {
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(rafId);
      } else if (!running) {
        running = true;
        rafId = requestAnimationFrame(raf);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    // Smooth in-page anchor jumps with a sticky-header offset. Anchors that
    // point elsewhere (e.g. '/#how' from /privacy) fall through to native nav.
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey) return;
      const target = e.target as HTMLElement | null;
      const a = target?.closest('a[href^="#"]') as HTMLAnchorElement | null;
      if (!a) return;
      const hash = a.getAttribute('href');
      if (!hash || hash === '#') return;
      const el = document.querySelector(hash);
      if (!el) return;
      e.preventDefault();
      lenis.scrollTo(el as HTMLElement, { offset: -80 });
    };
    document.addEventListener('click', onClick);

    return () => {
      running = false;
      cancelAnimationFrame(rafId);
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('click', onClick);
      lenis.destroy();
    };
  }, []);

  return <>{children ?? null}</>;
}
