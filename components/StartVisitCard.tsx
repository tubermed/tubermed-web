'use client';

// The identity-free visit start card (/app/new-visit). Replaces the former
// patient form: a visit stages with nothing but its own context — visit type,
// document template, optional chief complaint — and one primary action.
// There is deliberately NO doctor-typed identifier field anywhere on it; the
// visit's label everywhere else in the app is auto-generated (time + type +
// complaint + diagnosis).

import { Icon, type IconName } from '@/components/ui/Icon';
import { NoteSectionHead } from './ui/NoteSection';
import { Button } from './ui/Button';
import type { NoteType, VisitType } from '@/lib/types';

export interface StartVisitState {
  visit_type: VisitType | '';
  note_type: NoteType;
  chief_complaint: string;
}

export const EMPTY_START_VISIT: StartVisitState = {
  visit_type: '',
  note_type: 'consultation',
  chief_complaint: '',
};

const VISIT_TYPES: Array<{ value: VisitType; label: string }> = [
  { value: 'first',      label: 'Първичен' },
  { value: 'followup',   label: 'Контролен' },
  { value: 'urgent',     label: 'Спешен' },
  { value: 'preventive', label: 'Профилактичен' },
  { value: 'remote',     label: 'Дистанционен' },
];

// The document template (note_type). 'consultation' = Амбулаторен лист
// (default); 'echo' = Ехокардиография — a structured readout with NO
// diagnosis/МКБ shape. Always set (no empty state).
const NOTE_TYPES: Array<{ value: NoteType; label: string }> = [
  { value: 'consultation', label: 'Амбулаторен лист' },
  { value: 'echo',         label: 'Ехокардиография' },
];

interface StartVisitCardProps {
  state: StartVisitState;
  onChange: (next: StartVisitState) => void;
  onStartVisit: () => void;
  isSaving: boolean;
}

export default function StartVisitCard({ state, onChange, onStartVisit, isSaving }: StartVisitCardProps) {
  const set = <K extends keyof StartVisitState>(key: K, value: StartVisitState[K]) =>
    onChange({ ...state, [key]: value });

  return (
    <div data-tour="visit-context" className="flex flex-col gap-6">
      <CardSection title="Тип на посещението" icon="stethoscope">
        <PillRow
          options={VISIT_TYPES}
          isActive={(v) => state.visit_type === v}
          onPick={(v) => set('visit_type', state.visit_type === v ? '' : v)}
        />
      </CardSection>

      <CardSection title="Шаблон на документа" icon="stethoscope">
        <PillRow
          options={NOTE_TYPES}
          isActive={(v) => state.note_type === v}
          onPick={(v) => set('note_type', v)}
        />
      </CardSection>

      <CardSection title="Повод за посещението" icon="message-square">
        <textarea
          className="nv-field nv-field--area leading-relaxed"
          value={state.chief_complaint}
          onChange={(e) => set('chief_complaint', e.target.value)}
          placeholder="напр. Болки в гърдите от 2 дни, задух при усилие…"
          maxLength={1000}
        />
        <div className="text-[10px] mt-1 text-right" style={{ color: 'var(--color-text-muted)' }}>
          {state.chief_complaint.length} / 1000
        </div>
      </CardSection>

      <div
        className="nv-card-enter flex items-center justify-end gap-3 px-5 py-4 rounded-2xl border"
        style={{
          background: 'var(--color-bg-surface)',
          borderColor: 'var(--color-border)',
          boxShadow: 'var(--shadow-card)',
        }}
      >
        <Button
          variant="primary"
          data-tour="start"
          onClick={onStartVisit}
          disabled={isSaving}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0014 0M12 18.5V21" />
          </svg>
          Започни запис
        </Button>
      </div>
    </div>
  );
}

// Same calm-clinical form-group treatment as the former patient form: one
// hairline sheet headed by NoteSectionHead, keeping the .nv-card-enter entrance.
function CardSection({ title, icon, children }: { title: string; icon?: IconName; children: React.ReactNode }) {
  return (
    <section
      className="nv-card-enter bg-white rounded-2xl border p-6 sm:p-8"
      style={{ borderColor: 'var(--color-border)', boxShadow: 'var(--shadow-card)' }}
    >
      <NoteSectionHead title={title} icon={icon ? <Icon name={icon} /> : undefined} />
      {children}
    </section>
  );
}

function PillRow<V extends string>({
  options,
  isActive,
  onPick,
}: {
  options: Array<{ value: V; label: string }>;
  isActive: (v: V) => boolean;
  onPick: (v: V) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((t) => {
        const active = isActive(t.value);
        return (
          <button
            key={t.value}
            type="button"
            onClick={() => onPick(t.value)}
            className="px-4 py-2 rounded-full text-sm font-medium transition focus-ring"
            style={{
              background:  active ? 'var(--color-brand)' : 'transparent',
              color:       active ? 'white' : 'var(--color-text-muted)',
              border:      `1px solid ${active ? 'var(--color-brand)' : 'var(--color-border-mid)'}`,
            }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
