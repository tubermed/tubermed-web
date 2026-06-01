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
// The mandatory disclaimer is appended server-side and is part of `summary`, so
// it is always present in whatever the doctor copies or prints.

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { copyToClipboard, openPdfPreview } from '@/lib/exporters';

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
  | { kind: 'ready'; summary: string; cached: boolean }
  | { kind: 'error'; message: string };

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
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
  // Guards the auto-fetch so opening doesn't double-fire under StrictMode.
  const fetchedForRef = useRef<string | null>(null);

  const load = useCallback(
    async (regenerate: boolean) => {
      if (!consultationId) return;
      if (regenerate) setRegenerating(true);
      else setPhase({ kind: 'loading' });
      try {
        const res = await api.generatePatientSummary(consultationId, { regenerate });
        setPhase({ kind: 'ready', summary: res.summary, cached: res.cached });
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

  // Esc to close.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const summary = phase.kind === 'ready' ? phase.summary : '';

  async function handleCopy() {
    const ok = await copyToClipboard(summary);
    onToast(
      ok ? 'success' : 'error',
      ok ? '✓ Резюмето е копирано' : 'Копирането не е възможно в този браузър',
    );
  }

  function handlePrint() {
    const opened = openPdfPreview(buildPrintHtml(summary, patientName), { autoPrint: true });
    if (!opened) {
      onToast('error', 'Изскачащият прозорец е блокиран — разрешете го за този сайт');
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 no-print"
      style={{ background: 'rgba(15, 23, 42, 0.45)' }}
      onClick={onClose}
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
            onClick={onClose}
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
            <div
              className="text-sm leading-relaxed whitespace-pre-wrap"
              style={{ color: 'var(--color-text)' }}
            >
              {phase.summary}
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
              onClick={() => load(true)}
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
                className="px-3 py-1.5 rounded-md text-sm font-medium border transition hover:bg-[var(--color-bg)]"
                style={{ borderColor: 'var(--color-border-mid)', color: 'var(--color-text-muted)' }}
              >
                ⎙ Печат
              </button>
              <button
                onClick={handleCopy}
                className="px-3 py-1.5 rounded-md text-sm font-medium text-white transition hover:opacity-90"
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
