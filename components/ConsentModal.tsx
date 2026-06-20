'use client';

// ConsentModal — single source of truth for the patient consent-to-record gate.
// ─────────────────────────────────────────────────────────────────────────────
// Used by /app/scribe in TWO places (Gates 1 and 2):
//
//   Gate 1  — opens automatically on /app/scribe mount when consent has not
//             yet been recorded for the active consultation. Blocks the entire
//             screen so the doctor cannot reach the QR or PC-mic controls
//             before consent is captured.
//
//   Gate 2  — opens when a transcription request returns HTTP 403 with the
//             missing-consent error (see isMissingConsentError in lib/api),
//             so a stale-tab / edge-case bypass of Gate 1 lands on the same
//             pop-up rather than a raw error toast.
//
// Both gates render the SAME component instance with the SAME wording — the
// consent text lives in exactly one place (CONSENT_TEXT below).
//
// Visual / interaction:
//   - Shared <Dialog> (Radix): focus-trap + scroll-lock + role=dialog/aria-modal.
//   - One checkbox the doctor must tick.
//   - Confirm button stays disabled until the checkbox is ticked.
//   - HARD GATE — `dismissible={false}`: NO backdrop-click, Esc, or close button.
//     The doctor cannot bypass consent; the parent closes it after success.
//   - On confirm: calls api.recordConsent. Success → onConsented (parent
//     proceeds). Failure → onError so the parent's existing Toast wires it
//     up; modal stays open for retry.

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import type { ConsentResponse } from '@/lib/types';
import { Dialog } from '@/components/ui/Dialog';

// PLACEHOLDER — final wording must be reviewed by a GDPR/medical-law professional before production.
export const CONSENT_TEXT =
  'Потвърждавам, че пациентът е информиран и е дал съгласие за аудиозапис на консултацията.';

interface ConsentModalProps {
  /** The pending consultation. Passed to POST /api/consultations/:id/consent. */
  consultationId: string;
  /** Parent-controlled visibility. */
  open: boolean;
  /** Fired after the backend confirms consent (idempotent or fresh). The
   *  parent should mark consent recorded and close the modal. */
  onConsented: (response: ConsentResponse) => void;
  /** Network / backend failure during recordConsent. Parent shows the Toast;
   *  modal stays open so the doctor can retry. */
  onError: (message: string) => void;
}

export default function ConsentModal({
  consultationId,
  open,
  onConsented,
  onError,
}: ConsentModalProps) {
  const [checked, setChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Reset the checkbox each time the modal re-opens so consent must be
  // explicitly re-ticked rather than reusing a stale tick from a prior open.
  useEffect(() => {
    if (open) {
      setChecked(false);
      setSubmitting(false);
    }
  }, [open]);

  const handleConfirm = useCallback(async () => {
    if (!checked || submitting) return;
    setSubmitting(true);
    try {
      const response = await api.recordConsent(consultationId);
      onConsented(response);
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'неизвестна грешка';
      onError('Записването на съгласието не успя: ' + msg);
      setSubmitting(false);   // allow retry; modal stays open
    }
  }, [checked, submitting, consultationId, onConsented, onError]);

  return (
    <Dialog
      open={open}
      onClose={() => {}}
      title="Съгласие за аудиозапис"
      size="md"
      dismissible={false}
    >
      <div
        className="p-5 border-b"
        style={{ borderColor: 'var(--color-border)' }}
      >
        <h2
          className="text-lg font-semibold"
          style={{ color: 'var(--color-ink)' }}
        >
          Съгласие за аудиозапис
        </h2>
        <p
          className="text-sm mt-1"
          style={{ color: 'var(--color-text-muted)' }}
        >
          Преди да започнете записа, потвърдете, че пациентът е информиран.
        </p>
      </div>

      <div className="px-5 py-4">
        <label
          className="flex items-start gap-3 cursor-pointer select-none"
          style={{ color: 'var(--color-text)' }}
        >
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            disabled={submitting}
            className="mt-0.5 w-5 h-5 flex-shrink-0 cursor-pointer"
            style={{ accentColor: 'var(--color-brand)' }}
            aria-describedby="consent-modal-text"
          />
          <span
            id="consent-modal-text"
            className="text-sm leading-relaxed"
          >
            {CONSENT_TEXT}
          </span>
        </label>
      </div>

      <div
        className="px-5 py-4 flex items-center justify-end gap-2 border-t"
        style={{ borderColor: 'var(--color-border)' }}
      >
        <button
          type="button"
          onClick={handleConfirm}
          disabled={!checked || submitting}
          className="text-sm px-4 py-2 rounded-md font-medium transition disabled:opacity-40 disabled:cursor-not-allowed"
          style={{
            background: 'var(--color-brand)',
            color: 'white',
          }}
        >
          {submitting ? 'Записва се…' : 'Потвърждавам'}
        </button>
      </div>
    </Dialog>
  );
}
