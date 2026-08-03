'use client';

// Алергии — the note's allergy list, and the surface where field_notices land.
//
// ── Why this section did not exist ──────────────────────────────────────────
//
// `alergii` has been extracted since the beginning and rendered NOWHERE: not in
// the note, not in any exporter. The only consumer was lib/drug-safety.ts, which
// is gated off by NEXT_PUBLIC_CLINICAL_ALERTS. So an allergen the transcript
// never mentioned — mis-transcribed, or invented outright — was invisible to the
// doctor reviewing the note, on the one field where a wrong value travels
// furthest: it steers every future prescription.
//
// That is what makes the allergen-no-anchor notice the acceptance case for
// field_notices. There was nothing to attach a notice to, and nothing to notice.
//
// ── The line this component must not cross ──────────────────────────────────
//
// A notice states a fact about the DOCUMENT. It never states a fact about the
// PATIENT. „записан без опора в транскрипта" describes the record; „вероятно не
// е алергичен" would be a clinical judgement, and clinical alerts are OFF
// (2026-08-01 MDR ruling). This component is therefore not allowed to compose
// its own sentence: the predicate comes from `noticeLabel()`, which reads the
// frozen NOTICE_LABELS table keyed by a closed enum, and the subject comes from
// our own alergii[]. There is no path through which model-authored text or a
// severity could reach the screen.
//
// Consequently, and deliberately:
//   - no red, and no danger token anywhere in this file;
//   - no warning iconography — the mark is a quiet gold underline, the same
//     „AI несигурност" family as the inline uncertainty spans;
//   - no ordering by importance (that would itself be a clinical claim) —
//     notices render in document order;
//   - no approval gate. The doctor can confirm and export a note carrying
//     notices. This is advisory, exactly like uncertain_spans.

import { useMemo, useState } from 'react';
import ChipInput from './ChipInput';
import { noticeLabel, reanchorFieldNotices, noticeDismissKey } from '@/lib/field-notices';
import type { TranscribeFields, FieldNotice } from '@/lib/types';

// UI chrome — static copy, not clinical content, and not model-authored.
// The notice SENTENCE never appears here; it comes from noticeLabel().
const SECTION_TITLE = 'Алергии';
const FAMILY_LABEL  = 'AI несигурност';
const DISMISS_LABEL = 'Скрий бележката';
const EMPTY_HINT    = 'Няма записани алергии';

interface Props {
  /** Live (possibly edited) fields — the source of truth for what is displayed. */
  fields: TranscribeFields;
  /** The fields as the SERVER derived them. Notices are re-anchored from here
   *  against `fields`, so an edit can never leave an index pointing at a
   *  different allergen. The server does the same on /edit; this is the local
   *  mirror so the screen is correct between keystrokes, not after a round-trip. */
  serverFields: TranscribeFields | undefined;
  onChange: (next: string[]) => void;
  readOnly?: boolean;
}

export default function AllergiesSection({ fields, serverFields, onChange, readOnly }: Props) {
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());

  const allergens = useMemo(
    () => (Array.isArray(fields.alergii) ? fields.alergii : []),
    [fields.alergii],
  );

  // Re-anchor on every render rather than trusting the stored indices: the
  // doctor may have deleted or reordered rows since the server derived them.
  // A notice whose allergen text no longer exists is GONE — correcting the
  // field clears the notice, which is the whole point of "until resolved".
  const notices = useMemo(() => {
    if (!serverFields) return [];
    return reanchorFieldNotices(serverFields, fields);
  }, [serverFields, fields]);

  const liveNotices = useMemo(
    () => notices.filter((n) => !dismissed.has(noticeDismissKey(n, allergens))),
    [notices, dismissed, allergens],
  );

  // Which chips carry a live notice — drives the quiet mark on the chip itself,
  // so the notice is visibly KEYED to a row rather than floating under the list.
  const markedIndices = useMemo(
    () => new Set(liveNotices.map((n) => n.ref.index)),
    [liveNotices],
  );

  function dismiss(entry: FieldNotice) {
    setDismissed((prev) => new Set(prev).add(noticeDismissKey(entry, allergens)));
  }

  return (
    <section id="sec-alergii" className="mb-6">
      <div className="flex items-center gap-2 mb-2">
        <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
          {SECTION_TITLE}
        </h3>
      </div>

      {readOnly ? (
        <div
          className="rounded-md px-2 py-2 flex flex-wrap items-center gap-2 min-h-[44px]"
          style={{ background: 'white', border: '1px solid var(--color-border-mid)' }}
        >
          {allergens.length === 0 ? (
            <span className="text-sm" style={{ color: 'var(--color-text-hint)' }}>
              {EMPTY_HINT}
            </span>
          ) : (
            allergens.map((a, i) => (
              <span
                key={i}
                className="inline-flex items-center px-2 py-1 rounded-full text-xs"
                style={
                  markedIndices.has(i)
                    ? {
                        background: 'var(--color-warn-soft)',
                        color: 'var(--color-warn)',
                        // A dotted underline, not a border or a badge: it reads as
                        // "look again", not as "danger".
                        textDecoration: 'underline dotted',
                        textUnderlineOffset: '3px',
                      }
                    : { background: 'var(--color-brand-soft)', color: 'var(--color-brand)' }
                }
              >
                {a}
              </span>
            ))
          )}
        </div>
      ) : (
        <ChipInput
          value={allergens}
          onChange={onChange}
          placeholder="Добави алергия и натисни Enter"
        />
      )}

      {liveNotices.length > 0 && (
        <ul className="mt-2 space-y-1" aria-live="polite">
          {liveNotices.map((n, i) => {
            // noticeLabel returns null when the code is unknown or the row no
            // longer exists — an out-of-date notice can never name the wrong
            // allergen, it simply does not render.
            const text = noticeLabel(n, fields);
            if (!text) return null;
            return (
              <li
                key={`${n.code}-${n.ref.index}-${i}`}
                className="flex items-start gap-2 text-xs leading-relaxed"
                style={{ color: 'var(--color-text-muted)' }}
              >
                <span
                  className="mt-[2px] shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide"
                  style={{ background: 'var(--color-warn-soft)', color: 'var(--color-warn)' }}
                >
                  {FAMILY_LABEL}
                </span>
                <span className="flex-1">{text}</span>
                <button
                  type="button"
                  onClick={() => dismiss(n)}
                  className="shrink-0 underline opacity-70 hover:opacity-100"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  {DISMISS_LABEL}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
