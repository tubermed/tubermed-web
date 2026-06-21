// Calm-clinical note conventions — the approved "calm_result" house style.
//
// A document section reads as a section via an accent TICK + an optional small
// navy ICON + a ~14px UPPERCASE letter-spaced navy LABEL + a HAIRLINE divider +
// breathing room — NOT a boxed card. The label reads as a TITLE (text-sm, not the
// quieter text-xs) and the icon returns the per-section glyph, so sections no
// longer blur into one block. Elevation + saturated red stay RESERVED for the
// drug-safety rail / critical alert, so the note itself stays calm and scannable.
//
//   ▌ [icon] ТЕРАПИЯ                  ← NoteSectionHead: tick + icon + label (+ action)
//   ───────────────────────────────   ← hairline (--color-hairline)
//   <content — tight rows>
//
// Contrast (WCAG AA, on white): label uses --color-heading #274C77 (≈8:1).
// Keep clinical BODY text on --color-text #1C2733 / --color-text-muted #586472
// (≈6:1) — never --color-text-hint #8893A1 (≈3.1:1, fails AA for text).

import type { ReactNode } from 'react';

export function NoteSectionHead({
  title,
  icon,
  action,
}: {
  title: string;
  /** Optional small leading icon (e.g. a subsection flask/clipboard). */
  icon?: ReactNode;
  /** Optional right-aligned controls (e.g. виж източника / copy) — stay button-like. */
  action?: ReactNode;
}) {
  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 min-h-[24px]">
        <span
          aria-hidden
          className="inline-block flex-shrink-0 rounded-full"
          style={{ width: 3, height: 16, background: 'var(--color-accent)' }}
        />
        {icon && (
          <span
            aria-hidden
            className="inline-flex flex-shrink-0 items-center"
            style={{ color: 'var(--color-heading)' }}
          >
            {icon}
          </span>
        )}
        <span
          className="text-sm font-semibold uppercase tracking-wider"
          style={{ color: 'var(--color-heading)' }}
        >
          {title}
        </span>
        {action && (
          <div className="ml-auto flex items-center gap-2 flex-shrink-0">{action}</div>
        )}
      </div>
      <div
        className="mt-2"
        style={{ borderBottom: '1px solid var(--color-hairline)' }}
      />
    </div>
  );
}

export default NoteSectionHead;
