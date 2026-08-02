'use client';

import { useId, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

// One FAQ row. Replaces the native <details>/<summary> pair, which cannot
// animate its own disclosure — the browser flips `open` and the answer appears
// in a single frame. Guardrails:
//  - the answer stays MOUNTED and collapsed (height 0) rather than unmounting,
//    so the copy is in the SSR HTML and stays byte-identical to the FAQPage
//    JSON-LD in JsonLd.tsx.
//  - only the panel's own height/opacity animate (it owns the padding); no
//    sibling margin/padding is touched, so nothing above the FAQ reflows and
//    the sticky header never re-lays-out.
//  - prefers-reduced-motion → duration 0, i.e. instant show/hide.
//  - no JS → a <noscript> rule on the landing pages forces every panel open
//    (same trick as [data-reveal]); the inline collapsed style is why those
//    rules need !important.

const OPEN_S = 0.22;
const CLOSE_S = 0.2;
const EASE_OUT: [number, number, number, number] = [0, 0, 0.2, 1];
const EASE_IN: [number, number, number, number] = [0.4, 0, 1, 1];

export function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  const reduce = useReducedMotion();
  const id = useId();
  const questionId = `${id}-q`;
  const answerId = `${id}-a`;

  const transition = reduce
    ? { duration: 0 }
    : { duration: open ? OPEN_S : CLOSE_S, ease: open ? EASE_OUT : EASE_IN };

  return (
    <div
      className="rounded-[var(--lp-radius)] bg-white"
      style={{ border: '1px solid var(--lp-border)' }}
    >
      <h3>
        <button
          type="button"
          id={questionId}
          aria-expanded={open}
          aria-controls={answerId}
          onClick={() => setOpen((v) => !v)}
          className="flex w-full cursor-pointer items-center justify-between gap-4 px-5 py-4 text-left"
        >
          <span className="text-base font-semibold" style={{ color: 'var(--lp-heading)' }}>
            {q}
          </span>
          <motion.span
            className="lp-faq-chev shrink-0"
            style={{ color: 'var(--lp-accent)' }}
            aria-hidden="true"
            initial={false}
            animate={{ rotate: open ? 180 : 0 }}
            transition={transition}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </motion.span>
        </button>
      </h3>

      <motion.div
        id={answerId}
        role="region"
        aria-labelledby={questionId}
        className="lp-faq-panel"
        inert={!open}
        // The collapsed values are inline (not just an `initial` prop) so the
        // SSR markup already renders closed — otherwise every answer would
        // paint open and snap shut on hydration.
        style={{ overflow: 'hidden', height: 0, opacity: 0 }}
        initial={false}
        animate={{ height: open ? 'auto' : 0, opacity: open ? 1 : 0 }}
        transition={transition}
      >
        <p className="px-5 pb-5 text-base leading-relaxed" style={{ color: 'var(--lp-text-muted)' }}>
          {a}
        </p>
      </motion.div>
    </div>
  );
}
