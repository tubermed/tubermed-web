'use client';

import { useEffect } from 'react';
import type { PatientSearchHit } from '@/lib/types';
import { formatDateBg } from '@/lib/date';

interface PatientLoadConfirmModalProps {
  /** The patient picked from the NAME typeahead, or null when the modal is closed. */
  hit: PatientSearchHit | null;
  /** Load this patient's full record into the form. */
  onConfirm: () => void;
  /** Dismiss without loading — the caller keeps the typed name and reopens the
   *  dropdown so the doctor can pick a different row. */
  onCancel: () => void;
}

// Confirm-before-load for the NAME typeahead ONLY. Name search is fuzzy /
// transliteration-aware and names are NOT unique, so a pick is ambiguous — the
// doctor confirms the exact person before their record (incl. allergies /
// chronic conditions, which feed the drug-safety engine) loads. The full-ЕГН
// path is an exact hash match and auto-loads with no confirm (see EgnField).
export default function PatientLoadConfirmModal({ hit, onConfirm, onCancel }: PatientLoadConfirmModalProps) {
  useEffect(() => {
    if (!hit) return;
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onCancel(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [hit, onCancel]);

  if (!hit) return null;

  const fullName = [hit.first_name, hit.middle_name, hit.last_name].filter(Boolean).join(' ');
  // Same disambiguating meta line as PatientResultRow (DOB · ····last4 · type).
  const meta = [
    hit.birth_date ? formatDateBg(hit.birth_date) : 'без дата на раждане',
    hit.national_id_last4 ? `····${hit.national_id_last4}` : null,
    hit.national_id_type && hit.national_id_type !== 'none' ? hit.national_id_type.toUpperCase() : null,
  ].filter(Boolean).join(' · ');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(27, 42, 65, 0.55)' }}
      onClick={onCancel}
    >
      <div
        className="rounded-2xl shadow-2xl max-w-md w-full"
        style={{ background: 'var(--color-bg-card)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 border-b" style={{ borderColor: 'var(--color-border)' }}>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--color-ink)' }}>
            Зареди пациент?
          </h2>
          <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>
            Имената съвпадат приблизително — потвърдете, че това е търсеният пациент.
          </p>
        </div>

        <div className="px-5 py-4">
          <div className="text-base font-medium" style={{ color: 'var(--color-text)' }}>
            {fullName || '—'}
          </div>
          <div className="text-sm mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
            {meta}
          </div>
        </div>

        <div className="px-5 py-4 flex items-center justify-end gap-2 border-t" style={{ borderColor: 'var(--color-border)' }}>
          <button
            type="button"
            onClick={onCancel}
            className="text-sm px-3 py-2 rounded-md"
            style={{ color: 'var(--color-text-muted)' }}
          >
            Отказ
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="text-sm px-4 py-2 rounded-md font-medium text-white"
            style={{ background: 'var(--color-brand)' }}
          >
            Зареди данни
          </button>
        </div>
      </div>
    </div>
  );
}
