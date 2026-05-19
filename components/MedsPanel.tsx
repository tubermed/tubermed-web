'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Medication } from '@/lib/types';
import type { SafetyAlert } from '@/lib/drug-safety';
import { getIalDataSync, loadIal } from '@/lib/ial-meds';
import MedsPicker from './MedsPicker';
import { copyToClipboard } from '@/lib/exporters';

interface MedsPanelProps {
  meds: Medication[];
  onChange: (next: Medication[]) => void;
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
          {meds.map((m, i) => (
            <MedRow
              key={i}
              med={m}
              triggered={isMedTriggered(m, inlineCriticals)}
              onClick={() => openForEdit(i)}
              onRemove={() => removeAt(i)}
              isLocked={isLocked}
              notifyCopy={notifyCopy}
              onCopied={onMedsCopied}
            />
          ))}
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
  triggered,
  onClick,
  onRemove,
  isLocked,
  notifyCopy,
  onCopied,
}: {
  med: Medication;
  triggered: boolean;
  /** Whole row is the edit affordance — fires unless the remove × or copy
   *  button was hit (both stop propagation). */
  onClick: () => void;
  onRemove: () => void;
  /** Disables the per-row copy until the review is confirmed. */
  isLocked: boolean;
  /** Shared Toast callback — true = success, false = failure. */
  notifyCopy: (ok: boolean) => void;
  /** Optional analytics hook — fires only on successful copy. */
  onCopied?: (scope: 'single' | 'all', medCount: number) => void;
}) {
  const rx = lookupRx(med.inn);
  const copyText = formatMedLine(med);

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
          className="flex items-center gap-1.5 min-w-0"
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
          <div className="text-sm font-medium leading-tight truncate min-w-0">
            {triggered && <span className="mr-1">🚨</span>}
            {med.inn || (
              <span style={{ color: 'var(--color-gold)' }}>
                ⚠ {NOT_SPECIFIED}
              </span>
            )}
          </div>
        </div>
        <div
          className="text-[11px] mt-0.5 leading-snug"
          style={{ color: 'var(--color-text-muted)' }}
        >
          <Slot value={med.dose} />
          <Sep />
          <Slot value={med.regimen} />
          <Sep />
          <Slot value={med.route} />
          <Sep />
          <Slot value={med.duration} />
        </div>
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

function Slot({ value }: { value: string | undefined }) {
  if (isMissingField(value)) {
    return (
      <span
        style={{ color: 'var(--color-gold)', fontWeight: 600 }}
        title="липсва — попълни"
      >
        ⚠ {NOT_SPECIFIED}
      </span>
    );
  }
  return <span>{(value || '').trim()}</span>;
}

function Sep() {
  return (
    <span style={{ color: 'var(--color-border-mid)' }}> · </span>
  );
}
