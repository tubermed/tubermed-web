'use client';

import { useEffect } from 'react';
import type { DedupConflict, PatientSearchHit } from '@/lib/types';
import { formatDateBg } from '@/lib/date';

interface DedupModalProps {
  conflict: DedupConflict | null;
  /** Doctor confirmed one of the existing patients is the same. */
  onUseExisting: (hit: PatientSearchHit) => void;
  /** Doctor insists on a new record — caller should re-POST with force=true. */
  onForceCreate: () => void;
  onCancel: () => void;
}

export default function DedupModal({ conflict, onUseExisting, onForceCreate, onCancel }: DedupModalProps) {
  useEffect(() => {
    if (!conflict) return;
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onCancel(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [conflict, onCancel]);

  if (!conflict) return null;

  // name+dob hit → "use existing" is the primary CTA
  // name_only    → "create new" is the primary CTA (weaker dupe signal)
  const useExistingPrimary = conflict.matched_on === 'name+dob';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(27, 42, 65, 0.55)' }}
      onClick={onCancel}
    >
      <div
        className="rounded-2xl shadow-2xl max-w-lg w-full"
        style={{ background: 'var(--color-bg-card)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 border-b" style={{ borderColor: 'var(--color-border)' }}>
          <h2
            className="text-lg font-semibold"
            style={{ color: 'var(--color-ink)' }}
          >
            Възможни дубликати
          </h2>
          <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>
            {conflict.matched_on === 'name+dob'
              ? 'Намерени са пациенти със същото име и дата на раждане.'
              : 'Намерен е пациент със същото име (датата на раждане не е въведена).'}
          </p>
        </div>

        <ul className="px-5 py-3 max-h-[260px] overflow-y-auto">
          {conflict.possible_duplicates.map((hit) => (
            <li
              key={hit.id}
              className="flex items-center justify-between gap-3 py-2 border-b last:border-b-0"
              style={{ borderColor: 'var(--color-border-light)' }}
            >
              <div className="min-w-0">
                <div className="text-sm font-medium truncate" style={{ color: 'var(--color-text)' }}>
                  {[hit.first_name, hit.middle_name, hit.last_name].filter(Boolean).join(' ')}
                </div>
                <div className="flex items-center gap-x-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  <span>{hit.birth_date ? formatDateBg(hit.birth_date) : 'без дата на раждане'}</span>
                  {hit.national_id_last4 && (
                    <>
                      <span aria-hidden className="w-px h-3 self-center" style={{ background: 'var(--color-border)' }} />
                      <span>····{hit.national_id_last4}</span>
                    </>
                  )}
                </div>
              </div>
              <button
                onClick={() => onUseExisting(hit)}
                className="text-xs px-3 py-1.5 rounded-md font-medium flex-shrink-0"
                style={{
                  background: useExistingPrimary ? 'var(--color-brand)' : 'transparent',
                  color: useExistingPrimary ? 'white' : 'var(--color-brand)',
                  border: `1px solid var(--color-brand)`,
                }}
              >
                Това е същият
              </button>
            </li>
          ))}
        </ul>

        <div className="px-5 py-4 flex items-center justify-between gap-2 border-t" style={{ borderColor: 'var(--color-border)' }}>
          <button
            onClick={onCancel}
            className="text-sm px-3 py-2 rounded-md"
            style={{ color: 'var(--color-text-muted)' }}
          >
            Отказ
          </button>
          <button
            onClick={onForceCreate}
            className="text-sm px-4 py-2 rounded-md font-medium"
            style={{
              background: useExistingPrimary ? 'transparent' : 'var(--color-brand)',
              color:      useExistingPrimary ? 'var(--color-brand)' : 'white',
              border:     `1px solid var(--color-brand)`,
            }}
          >
            Не, създай нов
          </button>
        </div>
      </div>
    </div>
  );
}
