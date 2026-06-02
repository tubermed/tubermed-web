'use client';

// A2 — Patient after-visit summary modal ("Резюме за пациента").
//
// Opened from the result page top action bar AFTER the doctor confirms the
// review (the trigger button is gated the same way as the export buttons).
// On open it calls POST /api/consultations/:id/patient-summary, which builds a
// plain-language Bulgarian summary from the doctor-APPROVED note (and caches
// it, so re-opening is free). The doctor can copy it, print/PDF it for the
// patient, or regenerate it if they edited the note after the first run.
//
// The doctor can EDIT the summary body in-app before copy/print. The mandatory
// disclaimer is split off and shown as a FIXED, non-editable footer that is
// always re-appended to whatever is copied/printed — a free edit can never drop
// it (it stays the code-controlled invariant the backend guarantees). Edits are
// session-local: they shape the copy/print output but are NOT persisted to the
// server; "Регенерирай" or re-opening restores the generated text.

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { copyToClipboard, escapeHtml, openPdfPreview } from '@/lib/exporters';

interface PatientSummaryModalProps {
  isOpen: boolean;
  consultationId: string | null;
  onClose: () => void;
  /** Reuses the result page's Toast wiring for copy/print/error feedback. */
  onToast: (kind: 'success' | 'error', message: string) => void;
  /** Optional patient display name for the printable header. */
  patientName?: string;
}

type Phase =
  | { kind: 'loading' }
  | { kind: 'ready'; cached: boolean }
  | { kind: 'error'; message: string };

// Mirror of the backend's code-controlled disclaimer (lib/patient-summary.js),
// used ONLY as a fallback if a loaded summary somehow carries no disclaimer —
// normally we re-use the exact text the backend appended (see splitSummary).
const DISCLAIMER_FALLBACK =
  'Това резюме е информационно и не замества медицинска консултация. При въпроси или влошаване потърсете Вашия лекар.';

// Split a generated summary into editable body + fixed disclaimer. Backend
// appends `${body}\n\n${DISCLAIMER}`, so split at the blank line before the
// marker; fall back to the marker's own line if the model wrote it inline.
function splitSummary(full: string): { body: string; disclaimer: string } {
  const text = (full || '').trim();
  const idx = text.search(/не замества медицинска консултация/i);
  if (idx === -1) return { body: text, disclaimer: '' };
  const before = text.slice(0, idx);
  const para = before.lastIndexOf('\n\n');
  const cut = para !== -1 ? para : before.lastIndexOf('\n');
  if (cut === -1) {
    if (idx > 0) return { body: before.trim(), disclaimer: text.slice(idx).trim() };
    return { body: '', disclaimer: text };
  }
  return { body: text.slice(0, cut).trim(), disclaimer: text.slice(cut).trim() };
}

// The text the doctor copies / prints: edited body + the always-present
// disclaimer (the extracted one, or the fallback if none was found).
function composeFinal(body: string, disclaimer: string): string {
  const d = disclaimer || DISCLAIMER_FALLBACK;
  const b = body.trim();
  return b ? `${b}\n\n${d}` : d;
}

// Minimal, A5-friendly printable document. openPdfPreview injects the
// afterprint-close script + hides any `.actions` block (none here).
function buildPrintHtml(summary: string, patientName?: string): string {
  const dateStr = new Date().toLocaleDateString('bg-BG', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  const who = patientName ? `<div class="who">${escapeHtml(patientName)}</div>` : '';
  return `<!doctype html><html lang="bg"><head><meta charset="utf-8">
<title>Резюме за пациента</title>
<style>
  @page { size: A5; margin: 14mm; }
  body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; color: #1a1a2e; line-height: 1.5; max-width: 520px; margin: 0 auto; padding: 16px; }
  h1 { font-size: 18px; margin: 0 0 2px; }
  .who { color: #555; font-size: 13px; margin-bottom: 2px; }
  .date { color: #888; font-size: 12px; margin-bottom: 14px; }
  .text { white-space: pre-wrap; font-size: 14px; }
</style></head><body>
<h1>Резюме за пациента</h1>
${who}
<div class="date">${dateStr}</div>
<div class="text">${escapeHtml(summary)}</div>
</body></html>`;
}

export default function PatientSummaryModal({
  isOpen,
  consultationId,
  onClose,
  onToast,
  patientName,
}: PatientSummaryModalProps) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [regenerating, setRegenerating] = useState(false);
  // Editable body + the disclaimer split off the generated summary, plus the
  // pristine generated body so we can detect edits and offer a reset.
  const [draft, setDraft] = useState('');
  const [disclaimer, setDisclaimer] = useState('');
  const [originalBody, setOriginalBody] = useState('');
  // Guards the auto-fetch so opening doesn't double-fire under StrictMode.
  const fetchedForRef = useRef<string | null>(null);

  const load = useCallback(
    async (regenerate: boolean) => {
      if (!consultationId) return;
      if (regenerate) setRegenerating(true);
      else setPhase({ kind: 'loading' });
      try {
        const res = await api.generatePatientSummary(consultationId, { regenerate });
        const split = splitSummary(res.summary);
        setOriginalBody(split.body);
        setDraft(split.body);
        setDisclaimer(split.disclaimer);
        setPhase({ kind: 'ready', cached: res.cached });
      } catch (err) {
        const message =
          err instanceof ApiError
            ? err.message
            : 'Неуспешно генериране на резюмето. Опитайте отново.';
        setPhase({ kind: 'error', message });
      } finally {
        if (regenerate) setRegenerating(false);
      }
    },
    [consultationId],
  );

  // Auto-generate on first open per consultation. Re-opening the same one
  // returns the cached summary (no token spend).
  useEffect(() => {
    if (!isOpen || !consultationId) return;
    if (fetchedForRef.current === consultationId) return;
    fetchedForRef.current = consultationId;
    load(false);
  }, [isOpen, consultationId, load]);

  // Reset the guard when fully closed so a later re-open re-fetches the cache.
  useEffect(() => {
    if (!isOpen) fetchedForRef.current = null;
  }, [isOpen]);

  // Guard close when unsaved edits are present.
  const handleClose = useCallback(() => {
    const isEdited = draft.trim() !== originalBody.trim();
    if (isEdited && !window.confirm('Редакциите ще бъдат изгубени. Да затворя?')) return;
    onClose();
  }, [draft, originalBody, onClose]);

  // Esc to close.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, handleClose]);

  if (!isOpen) return null;

  const edited = draft.trim() !== originalBody.trim();
  const finalText = composeFinal(draft, disclaimer);
  const canExport = phase.kind === 'ready' && draft.trim().length > 0;

  async function handleCopy() {
    const ok = await copyToClipboard(finalText);
    onToast(
      ok ? 'success' : 'error',
      ok ? '✓ Резюмето е копирано' : 'Копирането не е възможно в този браузър',
    );
  }

  function handlePrint() {
    const opened = openPdfPreview(buildPrintHtml(finalText, patientName), { autoPrint: true });
    if (!opened) {
      onToast('error', 'Изскачащият прозорец е блокиран — разрешете го за този сайт');
    }
  }

  function handleRegenerate() {
    if (
      edited &&
      !window.confirm(
        'Регенерирането ще замени редакциите ви с ново резюме от бележката. Да продължа?',
      )
    ) {
      return;
    }
    load(true);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 no-print"
      style={{ background: 'rgba(15, 23, 42, 0.45)' }}
      onClick={handleClose}
    >
      <div
        className="bg-white rounded-2xl border w-full max-w-lg max-h-[85vh] flex flex-col shadow-xl"
        style={{ borderColor: 'var(--color-border)' }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Резюме за пациента"
      >
        {/* Header */}
        <div
          className="flex items-center justify-between gap-3 px-5 py-4 border-b"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <div className="flex items-center gap-2">
            <span aria-hidden="true">📄</span>
            <h2 className="text-lg font-semibold" style={{ color: 'var(--color-ink)' }}>
              Резюме за пациента
            </h2>
          </div>
          <button
            onClick={handleClose}
            aria-label="Затвори"
            className="w-8 h-8 rounded-md flex items-center justify-center text-lg transition hover:bg-[var(--color-bg)]"
            style={{ color: 'var(--color-text-hint)' }}
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {phase.kind === 'loading' && (
            <div className="py-10 text-center text-sm" style={{ color: 'var(--color-text-muted)' }}>
              Генериране на резюмето…
            </div>
          )}

          {phase.kind === 'error' && (
            <div className="py-6">
              <div
                className="text-sm px-3 py-3 rounded-md mb-3"
                style={{ background: 'var(--color-danger-soft)', color: 'var(--color-red)' }}
              >
                {phase.message}
              </div>
              <button
                onClick={() => load(false)}
                className="px-3 py-2 rounded-md text-sm font-medium text-white transition hover:opacity-90"
                style={{ background: 'var(--gradient-brand)' }}
              >
                Опитай отново
              </button>
            </div>
          )}

          {phase.kind === 'ready' && (
            <div className="flex flex-col gap-3">
              <label
                className="text-xs font-medium"
                style={{ color: 'var(--color-text-hint)' }}
              >
                Текст за пациента — можете да редактирате преди печат/копиране
              </label>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={10}
                className="w-full text-sm leading-relaxed rounded-md border px-3 py-2 resize-y focus:outline-none"
                style={{
                  borderColor: 'var(--color-border-mid)',
                  color: 'var(--color-text)',
                  minHeight: '12rem',
                }}
                placeholder="Текстът на резюмето…"
              />
              {edited && (
                <>
                  <p className="text-xs" style={{ color: 'var(--color-text-hint)' }}>
                    Редакциите са временни — не се записват на сървъра.
                  </p>
                  <button
                    onClick={() => setDraft(originalBody)}
                    className="self-start text-xs underline"
                    style={{ color: 'var(--color-text-hint)' }}
                  >
                    Възстанови генерирания текст
                  </button>
                </>
              )}
              {/* Fixed, non-editable disclaimer — ALWAYS added to copy/print */}
              <div
                className="text-xs rounded-md px-3 py-2"
                style={{ background: 'var(--color-bg)', color: 'var(--color-text-muted)' }}
              >
                <span className="font-medium">Забележка (добавя се автоматично): </span>
                {disclaimer || DISCLAIMER_FALLBACK}
              </div>
            </div>
          )}
        </div>

        {/* Footer actions */}
        {phase.kind === 'ready' && (
          <div
            className="flex items-center justify-between gap-2 px-5 py-3 border-t flex-wrap"
            style={{ borderColor: 'var(--color-border)' }}
          >
            <button
              onClick={handleRegenerate}
              disabled={regenerating}
              className="px-3 py-1.5 rounded-md text-sm font-medium border transition hover:bg-[var(--color-bg)] disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ borderColor: 'var(--color-border-mid)', color: 'var(--color-text-muted)' }}
              title="Генерирай наново от текущата бележка"
            >
              {regenerating ? '↻ …' : '↻ Регенерирай'}
            </button>
            <div className="flex items-center gap-2">
              <button
                onClick={handlePrint}
                disabled={!canExport}
                className="px-3 py-1.5 rounded-md text-sm font-medium border transition hover:bg-[var(--color-bg)] disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ borderColor: 'var(--color-border-mid)', color: 'var(--color-text-muted)' }}
              >
                ⎙ Печат
              </button>
              <button
                onClick={handleCopy}
                disabled={!canExport}
                className="px-3 py-1.5 rounded-md text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: 'var(--gradient-brand)' }}
              >
                ⧉ Копирай
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
