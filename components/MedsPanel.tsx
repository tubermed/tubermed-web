'use client';

import { useState } from 'react';
import type { Medication } from '@/lib/types';
import type { SafetyAlert } from '@/lib/drug-safety';

interface MedsPanelProps {
  meds: Medication[];
  onChange: (next: Medication[]) => void;
  terapiaText: string;
  inlineCriticals: SafetyAlert[];
  lastRemovedName: string | null;
  onClearRemovedHint: () => void;
}

export default function MedsPanel({
  meds,
  onChange,
  terapiaText,
  inlineCriticals,
  lastRemovedName,
  onClearRemovedHint,
}: MedsPanelProps) {
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDose, setNewDose] = useState('');

  function commitAdd() {
    const name = newName.trim();
    if (!name) return;
    const dose = newDose.trim();
    onChange([...meds, { inn: name, dose: dose || undefined }]);
    setNewName('');
    setNewDose('');
    setAddOpen(false);
  }

  function removeAt(i: number) {
    onChange(meds.filter((_, idx) => idx !== i));
  }

  const showTherapyHint =
    !!lastRemovedName &&
    terapiaText.toLowerCase().includes(lastRemovedName.toLowerCase());

  return (
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
              style={{
                background: '#FDECEA',
                color: 'var(--color-red)',
              }}
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
          className="text-xs italic py-2 mb-2"
          style={{ color: 'var(--color-text-hint)' }}
        >
          AI не откри медикаменти.
        </div>
      )}

      <div className="space-y-1.5 mb-3">
        {meds.map((m, i) => (
          <MedChip
            key={i + ':' + m.inn}
            med={m}
            onRemove={() => removeAt(i)}
            triggered={isMedTriggered(m, inlineCriticals)}
          />
        ))}
      </div>

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
            <span className="font-semibold" style={{ color: 'var(--color-gold)' }}>
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

      {addOpen ? (
        <div
          className="border rounded-md p-2 space-y-2 mb-2"
          style={{ borderColor: 'var(--color-brand)' }}
        >
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitAdd();
              if (e.key === 'Escape') {
                setAddOpen(false);
                setNewName('');
                setNewDose('');
              }
            }}
            placeholder="Име на лекарство"
            className="w-full px-2 py-1.5 rounded text-sm border outline-none"
            style={{ borderColor: 'var(--color-border-mid)' }}
          />
          <input
            value={newDose}
            onChange={(e) => setNewDose(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitAdd();
            }}
            placeholder="Дозировка (по желание)"
            className="w-full px-2 py-1.5 rounded text-sm border outline-none"
            style={{ borderColor: 'var(--color-border-mid)' }}
          />
          <div className="flex gap-1">
            <button
              onClick={commitAdd}
              disabled={!newName.trim()}
              className="flex-1 py-1.5 rounded text-xs font-medium text-white transition hover:opacity-90 disabled:opacity-40"
              style={{ background: 'var(--gradient-brand)' }}
            >
              + Добави
            </button>
            <button
              onClick={() => {
                setAddOpen(false);
                setNewName('');
                setNewDose('');
              }}
              className="px-3 py-1.5 rounded text-xs transition hover:bg-[var(--color-bg)]"
              style={{ color: 'var(--color-text-muted)' }}
            >
              Откажи
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setAddOpen(true)}
          className="w-full py-2 rounded-md text-xs font-medium border-2 border-dashed transition hover:bg-[var(--color-brand-light)]"
          style={{
            borderColor: 'var(--color-border-mid)',
            color: 'var(--color-text-muted)',
          }}
        >
          + Добави медикамент
        </button>
      )}
    </div>
  );
}

function isMedTriggered(med: Medication, criticals: SafetyAlert[]): boolean {
  const name = (med.inn || '').toLowerCase();
  if (!name) return false;
  return criticals.some((a) =>
    a.triggers.some((t) => name.includes(t.toLowerCase()))
  );
}

function MedChip({
  med,
  onRemove,
  triggered,
}: {
  med: Medication;
  onRemove: () => void;
  triggered: boolean;
}) {
  return (
    <div
      className="flex items-start gap-2 px-2.5 py-2 rounded-md border group"
      style={{
        background: triggered ? '#FDECEA' : 'var(--color-bg-card)',
        borderColor: triggered
          ? 'var(--color-red)'
          : 'var(--color-border)',
      }}
    >
      <div className="flex-1 min-w-0">
        <div
          className="text-sm font-medium leading-tight truncate"
          style={{
            color: triggered ? 'var(--color-red)' : 'var(--color-text)',
          }}
        >
          {triggered && <span className="mr-1">🚨</span>}
          {med.inn}
        </div>
        {(med.dose || med.regimen) && (
          <div
            className="text-[11px] mt-0.5"
            style={{
              color: triggered
                ? 'var(--color-red)'
                : 'var(--color-text-muted)',
            }}
          >
            {[med.dose, med.regimen, med.route, med.duration]
              .filter(Boolean)
              .join(' · ')}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <span
          className="text-[9px] font-bold px-1.5 py-0.5 rounded"
          style={{
            background: 'var(--color-brand)',
            color: 'white',
          }}
          title="Изисква рецепта"
        >
          Rx
        </span>
        <button
          onClick={onRemove}
          aria-label="Премахни"
          className="w-6 h-6 rounded flex items-center justify-center text-sm opacity-0 group-hover:opacity-100 transition"
          style={{ color: 'var(--color-text-hint)' }}
        >
          ×
        </button>
      </div>
    </div>
  );
}
