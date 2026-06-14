'use client';

import type { PatientSearchHit } from '@/lib/types';
import { formatDateBg } from '@/lib/date';

// Shared patient-result row — the single source of truth for how a matched
// patient is presented in a dropdown. Used by BOTH the top-bar PatientSearch
// and the new-visit form's ЕГН auto-match dropdown, so a matched patient looks
// identical no matter how it was found (avatar initial · name · birthdate ·
// ····last4 · ID-type tag). Presentational only — the caller owns the click.
export default function PatientResultRow({
  hit,
  onClick,
}: {
  hit: PatientSearchHit;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left px-3 py-2 flex items-center gap-3 hover:bg-[var(--color-brand-light)]"
    >
      <span
        className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0"
        style={{ background: 'var(--color-brand-soft)', color: 'var(--color-brand)' }}
      >
        {(hit.first_name[0] || '?').toUpperCase()}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-medium truncate" style={{ color: 'var(--color-text)' }}>
          {[hit.first_name, hit.middle_name, hit.last_name].filter(Boolean).join(' ')}
        </span>
        <span className="block text-xs" style={{ color: 'var(--color-text-muted)' }}>
          {hit.birth_date ? formatDateBg(hit.birth_date) : 'без дата на раждане'}
          {hit.national_id_last4 ? ` · ····${hit.national_id_last4}` : ''}
          {hit.national_id_type && hit.national_id_type !== 'none' ? ` · ${hit.national_id_type.toUpperCase()}` : ''}
        </span>
      </span>
    </button>
  );
}
