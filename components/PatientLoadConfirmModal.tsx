'use client';

import type { PatientSearchHit } from '@/lib/types';
import { formatDateBg } from '@/lib/date';
import { Dialog } from '@/components/ui/Dialog';

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
  const fullName = hit
    ? [hit.first_name, hit.middle_name, hit.last_name].filter(Boolean).join(' ')
    : '';

  return (
    <Dialog
      open={hit !== null}
      onClose={onCancel}
      title="Зареди пациент?"
      size="sm"
      showClose={false}
    >
      {hit && (
        <>
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
            {/* Same disambiguating meta line as PatientResultRow (DOB | ····last4 | type). */}
            <div className="flex items-center gap-x-2 text-sm mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
              <span>{hit.birth_date ? formatDateBg(hit.birth_date) : 'без дата на раждане'}</span>
              {hit.national_id_last4 && (
                <>
                  <span aria-hidden className="w-px h-3 self-center" style={{ background: 'var(--color-border)' }} />
                  <span>····{hit.national_id_last4}</span>
                </>
              )}
              {hit.national_id_type && hit.national_id_type !== 'none' && (
                <>
                  <span aria-hidden className="w-px h-3 self-center" style={{ background: 'var(--color-border)' }} />
                  <span>{hit.national_id_type.toUpperCase()}</span>
                </>
              )}
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
        </>
      )}
    </Dialog>
  );
}
