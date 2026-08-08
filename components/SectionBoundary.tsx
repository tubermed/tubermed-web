'use client';

// ─────────────────────────────────────────────────────────────────────────────
// SectionBoundary — a formatting problem may cost one section, never the visit
// ─────────────────────────────────────────────────────────────────────────────
// On 2026-08-08 a note whose `izsledvania` was `[]` instead of `""` took the
// whole result page down: one `.trim()` on one field, and the doctor lost the
// entire консултация — every other section, the diagnosis, the transcript, the
// export buttons. The note itself was fine. Nine rows in the live database can
// still do it, and four of them are approved or sealed, so they cannot be
// rewritten: /edit answers 409 `note_sealed`, with no unlock, by design.
//
// lib/note-normalize.ts is the fix for the shapes we know about. This is the
// seatbelt for the ones we do not. A React render error inside a section is
// caught here and that section alone is replaced with a marker; its siblings,
// the header, the transcript viewer and the export controls all still render.
//
// It is NOT a substitute for the write boundary in tubermed-backend
// lib/note-shape.js. A section that renders a problem marker is still a section
// the doctor cannot read — this only buys back the other nine.
//
// Error boundaries have to be class components; there is no hook form.
// ─────────────────────────────────────────────────────────────────────────────

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Icon } from './ui/Icon';

interface Props {
  /** Bulgarian section name, shown in the marker so the doctor knows what is
   *  missing rather than just that something is. */
  title: string;
  children: ReactNode;
}

interface State {
  failed: boolean;
}

export class SectionBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Section name and error message only. `error.message` on a shape failure
    // is a type complaint ("… .trim is not a function") and carries no clinical
    // text; the component stack is structural. Never log the field VALUE — this
    // console line can reach Sentry.
    console.error(
      `[section] "${this.props.title}" failed to render — ${error?.message ?? 'unknown'}`,
      info?.componentStack?.split('\n')[1]?.trim() ?? ''
    );
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div
        className="rounded-lg border px-4 py-3"
        style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}
      >
        <div
          className="text-sm font-semibold flex items-center gap-2 mb-1"
          style={{ color: 'var(--color-text-muted)' }}
        >
          <Icon name="alert-triangle" /> {this.props.title} — секцията не може да бъде показана
        </div>
        <div className="text-xs leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
          Съдържанието на тази секция е в неочакван формат. Останалата част от
          прегледа и транскрипцията са налични. Ако секцията съдържа продиктуван
          текст, вземете го от транскрипцията и го въведете отново.
        </div>
      </div>
    );
  }
}
