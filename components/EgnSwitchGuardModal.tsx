'use client';

import { useEffect } from 'react';

interface EgnSwitchGuardModalProps {
  /** Non-null while the guard is active. */
  open: boolean;
  /** "Име Фамилия" of the loaded patient whose edits are at risk. */
  patientName: string;
  /** Bulgarian labels of the fields that were changed. */
  changedLabels: string[];
  /** Disables the save button while the PATCH is in flight. */
  saving: boolean;
  /** Save the pending edits, then let the ЕГН change proceed. */
  onSave: () => void;
  /** Revert the ЕГН field, keep the patient loaded and the edits intact. */
  onCancel: () => void;
}

export default function EgnSwitchGuardModal({
  open,
  patientName,
  changedLabels,
  saving,
  onSave,
  onCancel,
}: EgnSwitchGuardModalProps) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onCancel(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

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
          <h2 className="text-lg font-semibold" style={{ color: 'var(--color-ink)' }}>
            Незапазени промени
          </h2>
          <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>
            Направени са промени по {patientName}:
          </p>
        </div>

        <div className="px-5 py-3">
          <ul className="list-disc pl-5 space-y-1">
            {changedLabels.map((label) => (
              <li key={label} className="text-sm" style={{ color: 'var(--color-text)' }}>
                {label}
              </li>
            ))}
          </ul>
          <p className="text-sm mt-3" style={{ color: 'var(--color-text-muted)' }}>
            Смяната на ЕГН ще зареди друг пациент и тези промени ще се изгубят.
          </p>
        </div>

        <div className="px-5 py-4 flex items-center justify-end gap-2 border-t" style={{ borderColor: 'var(--color-border)' }}>
          <button
            onClick={onCancel}
            disabled={saving}
            className="text-sm px-3 py-2 rounded-md disabled:opacity-50"
            style={{ color: 'var(--color-text-muted)' }}
          >
            Отказ
          </button>
          <button
            onClick={onSave}
            disabled={saving}
            className="text-sm px-4 py-2 rounded-md font-medium text-white disabled:opacity-50"
            style={{ background: 'var(--color-brand)' }}
          >
            Запази промените
          </button>
        </div>
      </div>
    </div>
  );
}
