'use client';

import { useEffect, useRef, useState } from 'react';

// ── A4 spotlight tour ────────────────────────────────────────────────────────
// Tiny in-repo tour — deliberately NO new dependencies (no react-joyride;
// framer-motion is landing-only per AGENTS.md). The spotlight is a positioned
// rounded div whose oversized box-shadow (0 0 0 9999px) darkens everything
// around the target; the target rect comes from getBoundingClientRect() of a
// [data-tour="…"] anchor. Purely visual: the onboarding-completed PATCH has
// already fired when the wizard closed — finishing or skipping the tour calls
// nothing but onClose.
//
// Behaviors: Напред advances (last step: Готово), Пропусни/Esc closes, step
// dots show progress, window resize/scroll re-measures, a missing anchor skips
// its step (never a broken spotlight on a blank screen). All measurement
// happens inside requestAnimationFrame / event callbacks (the react-compiler
// set-state-in-effect rule forbids synchronous setState in effect bodies).
//
// Input lockdown (2026-06-12): while the tour is open the ONLY interactive
// things are the tooltip's controls and Esc. The full-viewport catcher
// swallows every click (including inside the spotlight cutout — the
// highlighted element is shown, not clickable; clicking it does NOT advance);
// the document scroller (AppShell has no inner overflow container — the
// window/html is what scrolls) is locked with overflow:hidden, wheel/touchmove
// are preventDefault'ed via NATIVE non-passive listeners (React root wheel /
// touch listeners are passive — a React onWheel can't preventDefault), and a
// minimal focus trap keeps Tab inside the tooltip. overflow:hidden disables
// only USER scrolling — the per-step programmatic scrollIntoView still works
// (CSSOM: hidden boxes stay programmatically scrollable; verified live).

export interface TourStep {
  /** CSS selector of the anchor, e.g. '[data-tour="egn"]'. */
  selector: string;
  /** ONE sentence. */
  text: string;
}

const PAD = 8; // spotlight padding around the target rect

export default function SpotlightTour({
  steps,
  onClose,
}: {
  steps: TourStep[];
  onClose: () => void;
}) {
  const [idx, setIdx] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  // Which step the tooltip has been focused for — focus moves into the
  // tooltip once per step, not on every scroll/resize re-measure.
  const focusedForIdx = useRef(-1);

  // ── Scroll lock for the tour's whole life. The workspace scrolls the
  // DOCUMENT (AppShell: min-h-screen flex, no inner overflow container), so
  // the lock is overflow:hidden on <html>. Restores the exact prior inline
  // value AND the scroll position on unlock (belt: engaging the lock keeps
  // the position in Chromium, but put it back if an engine clamps it).
  useEffect(() => {
    const html = document.documentElement;
    const prevOverflow = html.style.overflow;
    const x = window.scrollX;
    const y = window.scrollY;
    html.style.overflow = 'hidden';
    if (window.scrollX !== x || window.scrollY !== y) window.scrollTo(x, y);
    return () => {
      const rx = window.scrollX;
      const ry = window.scrollY;
      html.style.overflow = prevOverflow;
      if (window.scrollX !== rx || window.scrollY !== ry) window.scrollTo(rx, ry);
    };
  }, []);

  // ── Wheel/touch are dead while the tour is open. NATIVE non-passive
  // listeners on the overlay root — React's delegated wheel/touch listeners
  // are passive, so a React handler's preventDefault is silently ignored.
  // The overlay root stays mounted across steps (rect=null between steps
  // only hides the spotlight + tooltip), so the lockdown never blinks.
  useEffect(() => {
    const node = overlayRef.current;
    if (!node) return;
    const block = (e: Event) => e.preventDefault();
    node.addEventListener('wheel', block, { passive: false });
    node.addEventListener('touchmove', block, { passive: false });
    return () => {
      node.removeEventListener('wheel', block);
      node.removeEventListener('touchmove', block);
    };
  }, []);

  // ── Keyboard: Tab cycles within the tooltip's controls; scroll keys are
  // swallowed unless focus is inside the tooltip (where Space/Enter activate
  // the focused button — that's a tour control, not page scrolling).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tooltip = tooltipRef.current;
      const inTooltip = !!tooltip && tooltip.contains(document.activeElement);
      if (e.key === 'Tab') {
        e.preventDefault();
        if (!tooltip) return; // between steps — nothing to focus yet
        const focusables = tooltip.querySelectorAll<HTMLElement>('button');
        if (focusables.length === 0) return;
        const list = [...focusables];
        const at = list.indexOf(document.activeElement as HTMLElement);
        const nextAt =
          at === -1
            ? 0
            : (at + (e.shiftKey ? -1 : 1) + list.length) % list.length;
        list[nextAt].focus();
        return;
      }
      const SCROLL_KEYS = [' ', 'PageDown', 'PageUp', 'ArrowDown', 'ArrowUp', 'Home', 'End'];
      if (!inTooltip && SCROLL_KEYS.includes(e.key)) e.preventDefault();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Re-binds per step (and per onClose identity — the parent passes an inline
  // closure; re-registering two listeners per parent render is cheap). All
  // setState happens inside rAF / event callbacks, never synchronously in the
  // effect body.
  useEffect(() => {
    let raf = 0;
    let disposed = false;

    const measure = () => {
      if (disposed) return;
      const el = document.querySelector(steps[idx]?.selector ?? '');
      if (!el) {
        // Anchor missing (layout changed?) — skip the step rather than
        // spotlighting nothing; close when nothing is left.
        if (idx < steps.length - 1) setIdx((i) => i + 1);
        else onClose();
        return;
      }
      setRect(el.getBoundingClientRect());
    };

    raf = requestAnimationFrame(() => {
      const el = document.querySelector(steps[idx]?.selector ?? '');
      if (el) el.scrollIntoView({ block: 'center' });
      // Second frame: measure AFTER the scroll has settled.
      raf = requestAnimationFrame(measure);
    });

    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [idx, steps, onClose]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Same preventDefault handshake as OnboardingWizard (see AGENTS.md "Esc
      // gotcha"): an inner control that consumed this Esc marks it
      // defaultPrevented, and same-node document listeners can't be shielded
      // by stopPropagation.
      if (e.key === 'Escape' && !e.defaultPrevented) onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Focus moves into the tooltip when a step renders (once per step — the
  // rect also changes on scroll/resize re-measures, which must not re-steal
  // focus from Пропусни if the doctor tabbed to it).
  useEffect(() => {
    if (!rect) return;
    if (focusedForIdx.current === idx) return;
    focusedForIdx.current = idx;
    const tooltip = tooltipRef.current;
    const primary = tooltip?.querySelector<HTMLElement>('button:last-of-type');
    primary?.focus();
  }, [idx, rect]);

  const next = () => {
    if (idx < steps.length - 1) {
      setRect(null); // hide until the next anchor is measured
      setIdx(idx + 1);
    } else {
      onClose();
    }
  };

  // Tooltip: below the spotlight when there's room, else above; clamped to
  // the viewport horizontally.
  const TOOLTIP_W = 320;
  const below = rect ? rect.bottom + PAD + 140 < window.innerHeight : true;
  const tooltipTop = rect && below ? rect.bottom + PAD + 12 : undefined;
  const tooltipBottom = rect && !below ? window.innerHeight - rect.top + PAD + 12 : undefined;
  const tooltipLeft = rect
    ? Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - TOOLTIP_W - 8))
    : 0;

  // The overlay root stays mounted from tour start to close — even between
  // steps (rect === null) the catcher + scroll/key locks keep the page inert;
  // only the spotlight and tooltip wait for the measurement.
  return (
    <div ref={overlayRef} className="fixed inset-0" style={{ zIndex: 60 }}>
      {/* Click-catcher: swallows EVERY click outside the tooltip — including
          inside the spotlight cutout (the box-shadow spotlight div is
          pointer-events:none, so this full-viewport layer is what any click
          lands on). It does NOT advance/close; mousedown is preventDefault'ed
          so a stray click can't even pull focus out of the tooltip. */}
      <div className="absolute inset-0" onMouseDown={(e) => e.preventDefault()} />

      {/* The spotlight: transparent window + giant shadow does the dimming. */}
      {rect && (
        <div
          style={{
            position: 'fixed',
            top: rect.top - PAD,
            left: rect.left - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
            borderRadius: 12,
            boxShadow: '0 0 0 9999px rgba(27, 42, 65, 0.62)',
            pointerEvents: 'none',
            transition: 'top 200ms ease, left 200ms ease, width 200ms ease, height 200ms ease',
          }}
        />
      )}

      {rect && (
      <div
        ref={tooltipRef}
        role="dialog"
        aria-modal="true"
        className="rounded-2xl shadow-2xl p-4"
        style={{
          position: 'fixed',
          top: tooltipTop,
          bottom: tooltipBottom,
          left: tooltipLeft,
          width: TOOLTIP_W,
          background: 'var(--color-bg-card)',
          zIndex: 61,
        }}
      >
        <p className="text-sm" style={{ color: 'var(--color-text)' }}>
          {steps[idx].text}
        </p>
        <div className="mt-3 flex items-center justify-between">
          <div className="flex items-center gap-1.5" aria-hidden="true">
            {steps.map((_, i) => (
              <span
                key={i}
                className="rounded-full"
                style={{
                  width: 6,
                  height: 6,
                  background: i === idx ? 'var(--color-brand)' : 'var(--color-border)',
                }}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="text-sm px-3 py-1.5 rounded-md"
              style={{ color: 'var(--color-text-muted)' }}
            >
              Пропусни
            </button>
            <button
              type="button"
              onClick={next}
              className="text-sm px-4 py-1.5 rounded-md font-medium text-white"
              style={{ background: 'var(--color-brand)' }}
            >
              {idx === steps.length - 1 ? 'Готово' : 'Напред'}
            </button>
          </div>
        </div>
      </div>
      )}
    </div>
  );
}
