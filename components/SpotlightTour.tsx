'use client';

import { useEffect, useState } from 'react';

// ── A4 spotlight tour ────────────────────────────────────────────────────────
// Tiny in-repo tour — deliberately NO new dependencies (no react-joyride;
// framer-motion is landing-only per AGENTS.md). The spotlight is a positioned
// rounded div whose oversized box-shadow (0 0 0 9999px) darkens everything
// around the target; the target rect comes from getBoundingClientRect() of a
// [data-tour="…"] anchor. Purely visual: the onboarding-completed PATCH has
// already fired when the wizard closed — finishing or skipping the tour calls
// nothing but onClose.
//
// Behaviors: Напред advances (last step: Готово), Пропусни/Esc/overlay-click
// closes, step dots show progress, window resize/scroll re-measures, a missing
// anchor skips its step (never a broken spotlight on a blank screen). All
// measurement happens inside requestAnimationFrame / event callbacks (the
// react-compiler set-state-in-effect rule forbids synchronous setState in
// effect bodies).

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
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!rect) return null;

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
  const below = rect.bottom + PAD + 140 < window.innerHeight;
  const tooltipTop = below ? rect.bottom + PAD + 12 : undefined;
  const tooltipBottom = below ? undefined : window.innerHeight - rect.top + PAD + 12;
  const tooltipLeft = Math.min(
    Math.max(8, rect.left),
    Math.max(8, window.innerWidth - TOOLTIP_W - 8)
  );

  return (
    <div className="fixed inset-0" style={{ zIndex: 60 }}>
      {/* Click-catcher: the page is view-only during the tour; a click
          anywhere advances. Sits under the tooltip so its buttons win. */}
      <div className="absolute inset-0" onClick={next} />

      {/* The spotlight: transparent window + giant shadow does the dimming. */}
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

      <div
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
        onClick={(e) => e.stopPropagation()}
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
    </div>
  );
}
