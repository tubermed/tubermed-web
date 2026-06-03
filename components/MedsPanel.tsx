'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Medication, MedsReview } from '@/lib/types';
import type { SafetyAlert } from '@/lib/drug-safety';
import { getIalDataSync, loadIal } from '@/lib/ial-meds';
import MedsPicker from './MedsPicker';
import { copyToClipboard } from '@/lib/exporters';
import { MED_COMPONENT_LABELS, type MedComponent } from '@/lib/meds-review';

// The four components offered for inline fill / dismiss in a med row. `inn`
// (the drug name) is one of the five required components but is NOT inline-
// dismissable — a nameless medication must be named (via the picker) or removed,
// never "intentionally omitted" — so it is handled by the row title + the gate,
// not here.
const MED_INLINE_COMPONENTS: MedComponent[] = ['form', 'dose', 'regimen', 'duration'];

interface MedsPanelProps {
  meds: Medication[];
  onChange: (next: Medication[]) => void;
  /** Per-med completeness marker (Bug 2). Index-aligned to `meds`. Drives the
   *  yellow "needs input" fields and which components show a dismissal chip. */
  medsReview?: MedsReview;
  /** Toggle a component's "intentionally open" dismissal for med at `index`.
   *  Never writes a value into the medication — records the choice only. */
  onDismiss: (index: number, component: string) => void;
  terapiaText: string;
  inlineCriticals: SafetyAlert[];
  lastRemovedName: string | null;
  onClearRemovedHint: () => void;
  /** True when the doctor hasn't confirmed the review yet — gates the
   *  copy-all button. The row click → edit flow stays available either way. */
  isLocked: boolean;
  /** Toast callback shared with the rest of /app/scribe/result. */
  notifyCopy: (ok: boolean) => void;
  /** Fires once per successful copy click. The parent forwards to
   *  api.logMedsCopied — one analytics event per click, fired immediately
   *  rather than batched at export, so a doctor who copies meds and walks
   *  away without exporting is still recorded. `medCount` is 1 for a
   *  per-row copy and the total number of medications joined into the
   *  buffer for the copy-all button. */
  onMedsCopied?: (scope: 'single' | 'all', medCount: number) => void;
}

const NOT_SPECIFIED = 'не е посочена';

function isMissingField(v: string | undefined): boolean {
  if (!v) return true;
  const t = v.trim();
  return !t || t.toLowerCase() === NOT_SPECIFIED;
}

export default function MedsPanel({
  meds,
  onChange,
  medsReview,
  onDismiss,
  terapiaText,
  inlineCriticals,
  lastRemovedName,
  onClearRemovedHint,
  isLocked,
  notifyCopy,
  onMedsCopied,
}: MedsPanelProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  // null → append mode; number → editing that index (replace on confirm)
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [ialReady, setIalReady] = useState(!!getIalDataSync());

  // Watch for IAL load so Rx/БЛП badges update on existing cards
  useEffect(() => {
    if (ialReady) return;
    let cancelled = false;
    loadIal()
      .then(() => {
        if (!cancelled) setIalReady(true);
      })
      .catch(() => {
        // silently fail; badges will keep their default
      });
    return () => {
      cancelled = true;
    };
  }, [ialReady]);

  function openForAdd() {
    setEditingIndex(null);
    setPickerOpen(true);
  }

  function openForEdit(i: number) {
    setEditingIndex(i);
    setPickerOpen(true);
  }

  function closePicker() {
    setPickerOpen(false);
    setEditingIndex(null);
  }

  // Picker emits a Medication. Parent owns the decision: append when
  // editingIndex is null, replace-at-index otherwise. The replacement is
  // unconditional — even if the doctor chose a different INN in the menu,
  // it overwrites the row that was tapped.
  function handlePick(med: Medication) {
    if (editingIndex === null) {
      onChange([...meds, med]);
    } else {
      const idx = editingIndex;
      onChange(meds.map((m, i) => (i === idx ? med : m)));
    }
    closePicker();
  }

  function removeAt(i: number) {
    onChange(meds.filter((_, idx) => idx !== i));
  }

  // Fill one component of the med at `index` (Bug 2 inline yellow field). The
  // parent recomputes meds_review, so a filled component drops out of `missing`
  // and its yellow field disappears.
  function fillComponent(index: number, component: string, value: string) {
    onChange(meds.map((m, i) => (i === index ? { ...m, [component]: value } : m)));
  }

  const copyAllText = useMemo(() => buildCopyAllText(meds), [meds]);

  async function copyAllMeds() {
    if (isLocked || !copyAllText) return;
    const ok = await copyToClipboard(copyAllText);
    notifyCopy(ok);
    // Only count successful copies — failed clipboard writes shouldn't be
    // billed as engagement.
    if (ok && onMedsCopied) onMedsCopied('all', meds.length);
  }

  const showTherapyHint =
    !!lastRemovedName &&
    terapiaText.toLowerCase().includes(lastRemovedName.toLowerCase());

  const editingMed = editingIndex !== null ? meds[editingIndex] : undefined;

  return (
    <>
      <div
        id="sec-meds-panel"
        className="bg-white rounded-2xl border p-4"
        style={{ borderColor: 'var(--color-border)' }}
      >
        <div className="flex items-center justify-between mb-3">
          <div
            className="text-xs uppercase tracking-wider font-medium"
            style={{ color: 'var(--color-text-hint)' }}
          >
            Медикаменти
          </div>
          {meds.length > 0 && (
            <span
              className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
              style={{
                background: 'var(--color-brand-soft)',
                color: 'var(--color-brand)',
              }}
            >
              {meds.length}
            </span>
          )}
        </div>

        {/* Inline critical alerts */}
        {inlineCriticals.length > 0 && (
          <div className="mb-3 space-y-1">
            {inlineCriticals.map((a, i) => (
              <div
                key={i}
                className="flex items-start gap-2 px-2 py-1.5 rounded-md text-[11px] leading-tight"
                style={{ background: 'var(--color-danger-soft)', color: 'var(--color-danger)' }}
              >
                <span className="flex-shrink-0">🚨</span>
                <div>
                  <div className="font-semibold uppercase tracking-wide text-[10px]">
                    Внимание
                  </div>
                  <div className="mt-0.5">{a.message}</div>
                  {a.action && (
                    <div
                      className="mt-1 pt-1 text-[10.5px] leading-snug border-t"
                      style={{
                        borderColor: 'currentColor',
                        opacity: 0.85,
                      }}
                    >
                      <span className="font-medium">Действие:</span> {a.action}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {meds.length === 0 && (
          <div
            className="text-xs py-2 mb-2"
            style={{ color: 'var(--color-text-hint)' }}
          >
            AI не откри медикаменти.
          </div>
        )}

        <div className="space-y-1.5 mb-3">
          {meds.map((m, i) => {
            const review = medsReview?.meds?.[i];
            return (
              <MedRow
                key={i}
                med={m}
                missing={review?.missing ?? []}
                dismissed={review?.dismissed ?? []}
                triggered={isMedTriggered(m, inlineCriticals)}
                onClick={() => openForEdit(i)}
                onRemove={() => removeAt(i)}
                onFill={(component, value) => fillComponent(i, component, value)}
                onDismissComponent={(component) => onDismiss(i, component)}
                isLocked={isLocked}
                notifyCopy={notifyCopy}
                onCopied={onMedsCopied}
              />
            );
          })}
        </div>

        {meds.length > 0 && (
          <button
            type="button"
            onClick={copyAllMeds}
            disabled={isLocked || !copyAllText}
            aria-disabled={isLocked || !copyAllText}
            title={
              isLocked
                ? 'Достъпно след потвърждаване на прегледа'
                : 'Копирай всички медикаменти, по един на ред'
            }
            className="w-full mb-3 py-2 rounded-md text-xs font-medium border transition hover:bg-[var(--color-bg)] disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
            style={{
              borderColor: 'var(--color-border-mid)',
              color: 'var(--color-text-muted)',
              background: 'white',
            }}
          >
            <span aria-hidden="true">{isLocked ? '🔒' : '⧉'}</span>
            <span>Копирай медикаментите</span>
          </button>
        )}

        {showTherapyHint && (
          <div
            className="mb-3 p-2.5 rounded-md"
            style={{
              background: 'var(--color-gold-soft)',
              borderColor: 'var(--color-gold)',
              borderWidth: 1,
            }}
          >
            <div
              className="text-[11px] leading-snug mb-2"
              style={{ color: 'var(--color-text)' }}
            >
              <span
                className="font-semibold"
                style={{ color: 'var(--color-gold)' }}
              >
                ⚠ Актуализирайте Терапия
              </span>
              <br />
              Премахнатото лекарство все още фигурира в текста.
            </div>
            <button
              onClick={onClearRemovedHint}
              className="w-full py-1.5 rounded text-[11px] font-semibold text-white transition hover:opacity-90"
              style={{ background: 'var(--color-gold)' }}
            >
              Разбрах
            </button>
          </div>
        )}

        <button
          onClick={openForAdd}
          className="w-full py-2 rounded-md text-xs font-medium border-2 border-dashed transition hover:bg-[var(--color-brand-light)]"
          style={{
            borderColor: 'var(--color-border-mid)',
            color: 'var(--color-text-muted)',
          }}
        >
          + Добави медикамент
        </button>
      </div>

      <MedsPicker
        isOpen={pickerOpen}
        onClose={closePicker}
        onPick={handlePick}
        initialMed={editingMed}
      />
    </>
  );
}

// Build the plain-text payload for "Копирай медикаментите".
// One line per medication. Format: `{inn} - {route} от {dose}, {regimen} за {duration}`
// with empty fields (including the literal "не е посочена") dropped so the
// line stays grammatical. Never auto-fills.
export function formatMedLine(m: Medication): string {
  const inn = (m.inn || '').trim();
  if (!inn) return '';
  const form = isMissingField(m.form) ? '' : (m.form as string).trim();
  const route = isMissingField(m.route) ? '' : (m.route as string).trim();
  const dose = isMissingField(m.dose) ? '' : (m.dose as string).trim();
  const regimen = isMissingField(m.regimen)
    ? ''
    : (m.regimen as string).trim();
  const duration = isMissingField(m.duration)
    ? ''
    : (m.duration as string).trim();

  let descriptor = '';
  if (route && dose) descriptor = `${route} от ${dose}`;
  else if (route) descriptor = route;
  else if (dose) descriptor = dose;

  let line = inn;
  if (form) line += ` ${form}`;
  if (descriptor) line += ` - ${descriptor}`;
  if (regimen) line += `, ${regimen}`;
  if (duration) line += ` за ${duration}`;
  return line;
}

function buildCopyAllText(meds: Medication[]): string {
  return meds.map(formatMedLine).filter(Boolean).join('\n');
}

// Returns the Rx/БЛП status of a named drug if found in the IAL register.
// Falls back to `true` (assume Rx) if IAL isn't loaded yet or no match.
function lookupRx(name: string): boolean {
  const data = getIalDataSync();
  if (!data || !name) return true;
  const lower = name.trim().toLowerCase();
  const m = data.find(
    (e) => e.i.toLowerCase() === lower || e.b.toLowerCase() === lower
  );
  return m ? m.r : true;
}

function isMedTriggered(med: Medication, criticals: SafetyAlert[]): boolean {
  const name = (med.inn || '').toLowerCase();
  if (!name) return false;
  return criticals.some((a) =>
    a.triggers.some((t) => name.includes(t.toLowerCase()))
  );
}

function MedRow({
  med,
  missing,
  dismissed,
  triggered,
  onClick,
  onRemove,
  onFill,
  onDismissComponent,
  isLocked,
  notifyCopy,
  onCopied,
}: {
  med: Medication;
  /** Required components currently empty for this med (Bug 2). */
  missing: string[];
  /** Components the doctor consciously dismissed ("intentionally open"). */
  dismissed: string[];
  triggered: boolean;
  /** Whole row is the edit affordance — fires unless an inner control (inline
   *  field, dismiss/undo, remove ×, copy) was hit (all stop propagation). */
  onClick: () => void;
  onRemove: () => void;
  /** Inline fill of one missing component. */
  onFill: (component: string, value: string) => void;
  /** Toggle one component's dismissal. */
  onDismissComponent: (component: string) => void;
  /** Disables the per-row copy until the review is confirmed. */
  isLocked: boolean;
  /** Shared Toast callback — true = success, false = failure. */
  notifyCopy: (ok: boolean) => void;
  /** Optional analytics hook — fires only on successful copy. */
  onCopied?: (scope: 'single' | 'all', medCount: number) => void;
}) {
  const rx = lookupRx(med.inn);
  const copyText = formatMedLine(med);
  // Components needing input now (missing AND not dismissed) vs. consciously
  // dismissed-but-empty. `inn` is excluded from inline handling (see
  // MED_INLINE_COMPONENTS) — a missing name is surfaced in the title + gate.
  const needsInput = MED_INLINE_COMPONENTS.filter(
    (c) => missing.includes(c) && !dismissed.includes(c)
  );
  const dismissedOpen = MED_INLINE_COMPONENTS.filter(
    (c) => dismissed.includes(c) && missing.includes(c)
  );

  async function handleCopy(e: React.MouseEvent) {
    e.stopPropagation();
    if (isLocked || !copyText) return;
    const ok = await copyToClipboard(copyText);
    notifyCopy(ok);
    if (ok && onCopied) onCopied('single', 1);
  }

  function handleRemove(e: React.MouseEvent) {
    e.stopPropagation();
    onRemove();
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      title="Кликни за редакция"
      className="flex items-stretch gap-2 px-2.5 py-2 rounded-md border cursor-pointer group transition hover:bg-[var(--color-brand-light)] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
      style={{
        background: triggered ? 'var(--color-danger-soft)' : 'var(--color-bg-card)',
        borderColor: triggered ? 'var(--color-danger)' : 'var(--color-border)',
      }}
    >
      <div className="flex-1 min-w-0 self-center">
        <div
          className="flex items-start gap-1.5 min-w-0"
          style={{
            color: triggered ? 'var(--color-red)' : 'var(--color-text)',
          }}
        >
          <span
            className="text-[9px] font-bold px-1.5 py-0.5 rounded flex-shrink-0"
            style={{
              background: rx ? 'var(--color-brand)' : 'var(--color-ok-soft)',
              color: rx ? 'white' : 'var(--color-ok)',
            }}
            title={rx ? 'Изисква рецепта' : 'Без лекарско предписание'}
          >
            {rx ? 'Rx' : 'БЛП'}
          </span>
          <div className="text-sm font-medium leading-snug min-w-0 break-words [overflow-wrap:anywhere]">
            {triggered && <span className="mr-1">🚨</span>}
            {med.inn || (
              <span style={{ color: 'var(--color-gold)' }}>
                ⚠ {NOT_SPECIFIED}
              </span>
            )}
          </div>
        </div>
        {/* Filled component summary — only the components that HAVE a value
            (missing ones are surfaced as yellow needs-input fields below, never
            as a passive "не е посочено"). */}
        <div
          className="text-[11px] mt-0.5 leading-snug"
          style={{ color: 'var(--color-text-muted)' }}
        >
          <FilledSummary med={med} />
        </div>

        {/* Yellow "needs input" fields — one editable field per missing,
            undismissed component (Bug 2). Fill clears it; "Пропусни" dismisses
            it without ever writing a value. Editable regardless of isLocked —
            the gate disables ONLY approve/export, never editing. */}
        {needsInput.length > 0 && (
          <div
            className="mt-1.5 space-y-1"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            {needsInput.map((c) => (
              <NeedsInputField
                key={c}
                label={MED_COMPONENT_LABELS[c]}
                onFill={(v) => onFill(c, v)}
                onDismiss={() => onDismissComponent(c)}
              />
            ))}
          </div>
        )}

        {/* Consciously dismissed components — subtle, with an undo. No value is
            ever recorded into the medication. */}
        {dismissedOpen.length > 0 && (
          <div
            className="mt-1 flex flex-wrap gap-1"
            onClick={(e) => e.stopPropagation()}
          >
            {dismissedOpen.map((c) => (
              <DismissedChip
                key={c}
                label={MED_COMPONENT_LABELS[c]}
                onUndo={() => onDismissComponent(c)}
              />
            ))}
          </div>
        )}
      </div>
      <div className="flex flex-col items-center justify-center gap-1 flex-shrink-0">
        <button
          type="button"
          onClick={handleCopy}
          disabled={isLocked || !copyText}
          aria-disabled={isLocked || !copyText}
          aria-label="Копирай медикамента"
          title={
            isLocked
              ? 'Достъпно след потвърждаване на прегледа'
              : 'Копирай реда'
          }
          className="w-9 h-9 rounded-md border flex items-center justify-center text-base transition hover:bg-[var(--color-bg)] disabled:opacity-40 disabled:cursor-not-allowed"
          style={{
            borderColor: 'var(--color-border-mid)',
            color: 'var(--color-text-muted)',
            background: 'white',
          }}
        >
          <span aria-hidden="true">
            {isLocked ? '🔒' : '⧉'}
          </span>
        </button>
        <button
          type="button"
          onClick={handleRemove}
          aria-label="Премахни"
          title="Премахни медикамента"
          className="w-9 h-9 rounded-md flex items-center justify-center text-2xl leading-none transition hover:bg-[var(--color-danger-soft)]"
          style={{ color: 'var(--color-text-muted)' }}
        >
          ×
        </button>
      </div>
    </div>
  );
}

// Renders only the FILLED components (form · dose · regimen · route · duration),
// dot-separated. Missing components are NOT shown here — they appear as yellow
// needs-input fields. A med with nothing filled yet shows a quiet em dash.
function FilledSummary({ med }: { med: Medication }) {
  const parts = [med.form, med.dose, med.regimen, med.route, med.duration]
    .map((v) => (isMissingField(v) ? '' : (v as string).trim()))
    .filter(Boolean);
  if (parts.length === 0) {
    return <span style={{ color: 'var(--color-text-hint)' }}>—</span>;
  }
  return (
    <>
      {parts.map((p, i) => (
        <span key={i}>
          {i > 0 && <Sep />}
          {p}
        </span>
      ))}
    </>
  );
}

// Yellow "needs input" field for one missing component (Bug 2). Buffers
// keystrokes in local state and commits on blur / Enter — so the field does NOT
// vanish mid-typing when the parent recomputes meds_review. Committing a
// non-empty value fills the component (clearing the flag); "Пропусни" records a
// conscious dismissal WITHOUT writing any value.
function NeedsInputField({
  label,
  onFill,
  onDismiss,
}: {
  label: string;
  onFill: (value: string) => void;
  onDismiss: () => void;
}) {
  const [val, setVal] = useState('');
  function commit() {
    const t = val.trim();
    if (t) onFill(t); // empty → leave missing; the field persists for next time
  }
  return (
    <div
      className="flex items-center gap-1.5 px-2 py-1.5 rounded-md"
      style={{
        background: 'var(--color-gold-soft)',
        border: '1px solid var(--color-gold)',
      }}
    >
      <span
        className="text-[10px] font-semibold flex-shrink-0"
        style={{ color: 'var(--color-gold)' }}
        title="липсва — попълнете или пропуснете"
      >
        ⚠ {label}
      </span>
      <input
        type="text"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          }
        }}
        onBlur={commit}
        placeholder="впишете…"
        aria-label={`Впишете ${label}`}
        className="flex-1 min-w-0 px-2 py-1 rounded text-xs border outline-none bg-white"
        style={{ borderColor: 'var(--color-gold)' }}
      />
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDismiss();
        }}
        title="Отбележи като съзнателно пропуснато"
        className="text-[10px] px-1.5 py-1 rounded flex-shrink-0 transition hover:bg-white"
        style={{ color: 'var(--color-text-muted)' }}
      >
        Пропусни
      </button>
    </div>
  );
}

// A component the doctor consciously dismissed — shown subtly, clickable to
// undo (re-surface the yellow field). Never reflects a written value.
function DismissedChip({
  label,
  onUndo,
}: {
  label: string;
  onUndo: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onUndo();
      }}
      title="Върни към попълване"
      className="text-[10px] px-1.5 py-0.5 rounded inline-flex items-center gap-1 transition hover:opacity-80"
      style={{
        background: 'var(--color-bg)',
        color: 'var(--color-text-hint)',
        border: '1px solid var(--color-border)',
      }}
    >
      <span>{label}: пропуснато</span>
      <span aria-hidden="true">↺</span>
    </button>
  );
}

function Sep() {
  return (
    <span style={{ color: 'var(--color-border-mid)' }}> · </span>
  );
}
