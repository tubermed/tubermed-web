'use client';

import { useCallback, useMemo, useState } from 'react';
import { dobFromEgn, genderFromEgn } from '@/lib/egn';
import { ageFromBirthDate } from '@/lib/age';
import ChipInput from './ChipInput';
import MkbPicker from './MkbPicker';
import type {
  CreatePatientPayload,
  Gender,
  NationalIdType,
  PatientSummary,
  VisitType,
  Locale,
} from '@/lib/types';

// ── Form state shape (everything the page edits in one place) ───────────────
export interface PatientFormState {
  // Identification
  national_id_type: NationalIdType;
  national_id: string;
  first_name: string;
  middle_name: string;
  last_name: string;
  birth_date: string;        // YYYY-MM-DD
  gender: Gender | '';

  // Clinical context
  insurance_status: string;
  allergies: string[];
  chronic_conditions: string[];

  // Visit
  visit_type: VisitType | '';
  chief_complaint: string;

  // Documentation
  language: Locale;
}

export const EMPTY_FORM: PatientFormState = {
  national_id_type: 'egn',
  national_id: '',
  first_name: '',
  middle_name: '',
  last_name: '',
  birth_date: '',
  gender: '',
  insurance_status: 'nzok',
  allergies: [],
  chronic_conditions: [],
  visit_type: '',
  chief_complaint: '',
  language: 'bg',
};

export function fromPatient(p: PatientSummary): PatientFormState {
  return {
    national_id_type:   p.national_id_type,
    national_id:        '',                                    // never prefill plaintext
    first_name:         p.first_name,
    middle_name:        p.middle_name ?? '',
    last_name:          p.last_name,
    birth_date:         p.birth_date ?? '',
    gender:             p.gender ?? '',
    insurance_status:   p.insurance_status ?? 'nzok',
    allergies:          [...p.allergies],
    chronic_conditions: [...p.chronic_conditions],
    visit_type:         '',
    chief_complaint:    '',
    language:           'bg',
  };
}

export function toCreatePayload(s: PatientFormState, force = false): CreatePatientPayload {
  return {
    national_id_type:   s.national_id_type,
    national_id:        s.national_id_type === 'none' ? undefined : s.national_id || undefined,
    first_name:         s.first_name.trim(),
    middle_name:        s.middle_name.trim() || null,
    last_name:          s.last_name.trim(),
    birth_date:         s.birth_date || null,
    gender:             (s.gender || null) as Gender | null,
    allergies:          s.allergies,
    chronic_conditions: s.chronic_conditions,
    insurance_status:   s.insurance_status || null,
    force,
  };
}

interface PatientFormProps {
  state: PatientFormState;
  onChange: (next: PatientFormState) => void;
  /** True when the form is bound to an existing patient (different submit semantics). */
  isExistingPatient?: boolean;
  /** Cleared when the doctor clicks "Започни запис" / "Запази чернова" */
  isSaving?: boolean;
  onSaveDraft: () => void;
  onStartVisit: () => void;
}

export default function PatientForm({
  state,
  onChange,
  isExistingPatient,
  isSaving,
  onSaveDraft,
  onStartVisit,
}: PatientFormProps) {
  const set = useCallback(
    <K extends keyof PatientFormState>(key: K, value: PatientFormState[K]) =>
      onChange({ ...state, [key]: value }),
    [state, onChange]
  );

  // Atomic multi-field setter — needed so ЕГН-driven derivation can update
  // national_id + birth_date + gender in a single React update. Calling `set`
  // three times in the same tick clobbers because each call closes over the
  // pre-update `state`.
  const setMany = useCallback(
    (partial: Partial<PatientFormState>) => onChange({ ...state, ...partial }),
    [state, onChange]
  );

  const age = useMemo(() => ageFromBirthDate(state.birth_date), [state.birth_date]);

  // Mirrors IdentificationSection's `egnInvalid`: true ONLY when type is ЕГН,
  // exactly 10 digits are entered, AND those digits can't decode to a real past
  // birth date — the unambiguously-bad, format-derivable-impossible case. A
  // partial (<10-digit) ЕГН is neither valid nor invalid here, so it stays
  // submittable as a draft; non-ЕГН types ('lnch'/'foreign'/'none') are
  // unaffected because the `=== 'egn'` guard keeps this false for them.
  const egnInvalid =
    state.national_id_type === 'egn' &&
    state.national_id.length === 10 &&
    dobFromEgn(state.national_id) === null;
  const canSubmit = Boolean(state.first_name.trim() && state.last_name.trim() && !egnInvalid);

  return (
    <div className="flex flex-col gap-6">
      <IdentificationSection state={state} set={set} setMany={setMany} age={age} />
      <ClinicalContextSection state={state} set={set} />
      <VisitTypeSection state={state} set={set} />
      <ChiefComplaintSection state={state} set={set} />
      <DocumentationSection state={state} set={set} />

      <div
        className="flex items-center justify-between gap-3 px-6 py-4 rounded-xl"
        style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}
      >
        <button
          type="button"
          onClick={onSaveDraft}
          disabled={!canSubmit || isSaving}
          className="text-sm px-4 py-2 rounded-md font-medium disabled:opacity-50"
          style={{
            background: 'transparent',
            color: 'var(--color-brand)',
            border: '1px solid var(--color-brand)',
          }}
        >
          {isExistingPatient ? 'Запази промените' : 'Запази чернова'}
        </button>
        <button
          type="button"
          onClick={onStartVisit}
          disabled={!canSubmit || isSaving}
          className="text-sm px-5 py-2.5 rounded-md text-white font-medium transition hover:opacity-95 disabled:opacity-50"
          style={{ background: 'var(--gradient-brand)' }}
        >
          Започни запис →
        </button>
      </div>
    </div>
  );
}

// ── Section: Идентификация ──────────────────────────────────────────────────
type SetFn = <K extends keyof PatientFormState>(key: K, value: PatientFormState[K]) => void;

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      className="rounded-xl"
      style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}
    >
      <div className="px-6 pt-5 pb-2">
        <h3
          className="text-[10px] uppercase tracking-[0.22em] font-semibold"
          style={{ color: 'var(--color-text-hint)' }}
        >
          {title}
        </h3>
      </div>
      <div className="px-6 pb-5">{children}</div>
    </section>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="block text-xs mb-1.5"
      style={{ color: 'var(--color-text-muted)' }}
    >
      {children}
    </span>
  );
}

function inputClass() {
  return 'w-full px-3 py-2 rounded-md outline-none text-sm';
}
function inputStyle(): React.CSSProperties {
  return { background: 'white', border: '1px solid var(--color-border-mid)', color: 'var(--color-text)' };
}

function IdentificationSection({
  state, set, setMany, age,
}: {
  state: PatientFormState;
  set: SetFn;
  setMany: (partial: Partial<PatientFormState>) => void;
  age: number | null;
}) {
  // Validity derivation — runs every render so we never display stale flags.
  const isEgn       = state.national_id_type === 'egn';
  const ten         = state.national_id.length === 10;
  const derivedDob  = isEgn && ten ? dobFromEgn(state.national_id) : null;
  const egnInvalid  = isEgn && ten && derivedDob === null;
  const egnValid    = isEgn && ten && derivedDob !== null;

  // Handles every keystroke on the ЕГН input. For type='egn' specifically:
  // re-derives DOB + gender on every change. When DOB can't be parsed (length
  // < 10 OR digits 1–6 aren't a real calendar date), both birth_date and
  // gender are cleared in the same React update so we never display a gender
  // derived from a garbage ЕГН.
  function handleNationalIdChange(raw: string) {
    const cleaned = raw.replace(/\s/g, '');
    if (state.national_id_type !== 'egn') {
      setMany({ national_id: cleaned });
      return;
    }
    const dob = cleaned.length === 10 ? dobFromEgn(cleaned) : null;
    if (dob === null) {
      setMany({ national_id: cleaned, birth_date: '', gender: '' });
    } else {
      const g = genderFromEgn(cleaned) ?? '';
      setMany({ national_id: cleaned, birth_date: dob, gender: g });
    }
  }

  return (
    <SectionCard title="Идентификация">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <label>
          <FieldLabel>Име</FieldLabel>
          <input className={inputClass()} style={inputStyle()}
                 value={state.first_name} onChange={(e) => set('first_name', e.target.value)} />
        </label>
        <label>
          <FieldLabel>Презиме</FieldLabel>
          <input className={inputClass()} style={inputStyle()}
                 value={state.middle_name} onChange={(e) => set('middle_name', e.target.value)} />
        </label>
        <label>
          <FieldLabel>Фамилия</FieldLabel>
          <input className={inputClass()} style={inputStyle()}
                 value={state.last_name} onChange={(e) => set('last_name', e.target.value)} />
        </label>

        <label>
          <FieldLabel>Тип на ИД</FieldLabel>
          <select className={inputClass()} style={inputStyle()}
                  value={state.national_id_type}
                  onChange={(e) => set('national_id_type', e.target.value as NationalIdType)}>
            <option value="egn">ЕГН</option>
            <option value="lnch">ЛНЧ</option>
            <option value="foreign">Чужд документ</option>
            <option value="none">Без идентификатор</option>
          </select>
        </label>

        <label className="md:col-span-1">
          <FieldLabel>{state.national_id_type === 'egn' ? 'ЕГН' : state.national_id_type === 'lnch' ? 'ЛНЧ' : 'Идентификатор'}</FieldLabel>
          <span className="relative block">
            <input
              className={`${inputClass()} font-[family-name:var(--font-jetbrains)] tracking-wider pr-7`}
              style={{
                ...inputStyle(),
                borderColor: egnInvalid ? 'var(--color-red)' : 'var(--color-border-mid)',
              }}
              value={state.national_id}
              onChange={(e) => handleNationalIdChange(e.target.value)}
              disabled={state.national_id_type === 'none'}
              inputMode={state.national_id_type === 'egn' || state.national_id_type === 'lnch' ? 'numeric' : 'text'}
              maxLength={state.national_id_type === 'egn' || state.national_id_type === 'lnch' ? 10 : undefined}
              placeholder={state.national_id_type === 'none' ? '—' : '10 цифри'}
              aria-invalid={egnInvalid || undefined}
            />
            {egnValid && (
              <span
                aria-hidden
                className="absolute right-2 top-1/2 -translate-y-1/2 text-sm"
                style={{ color: 'var(--color-ok)' }}
                title="Валидно ЕГН"
              >✓</span>
            )}
          </span>
          {egnInvalid && (
            <span className="block text-xs mt-1" style={{ color: 'var(--color-red)' }} role="alert">
              Невалидно ЕГН — датата на раждане не може да бъде извлечена.
            </span>
          )}
        </label>

        <div className="grid grid-cols-2 gap-3 md:col-span-1">
          <label>
            <FieldLabel>Възраст</FieldLabel>
            <div
              className={`${inputClass()} flex items-center font-[family-name:var(--font-jetbrains)]`}
              style={{ ...inputStyle(), background: 'var(--color-border-light)', color: 'var(--color-text-muted)' }}
            >
              {age !== null ? `${age} г.` : '—'}
            </div>
          </label>
          <label>
            <FieldLabel>Пол</FieldLabel>
            <select
              className={inputClass()}
              style={inputStyle()}
              value={state.gender}
              onChange={(e) => set('gender', e.target.value as Gender | '')}
            >
              <option value="">—</option>
              <option value="male">мъж</option>
              <option value="female">жена</option>
              <option value="other">друг</option>
              <option value="unknown">неизвестен</option>
            </select>
          </label>
        </div>

        <label className="md:col-span-3">
          <FieldLabel>Дата на раждане (опционално — се запълва автоматично от ЕГН)</FieldLabel>
          <input
            type="date"
            className={`${inputClass()} font-[family-name:var(--font-jetbrains)]`}
            style={inputStyle()}
            value={state.birth_date}
            onChange={(e) => set('birth_date', e.target.value)}
          />
        </label>
      </div>
    </SectionCard>
  );
}

// ── Section: Клиничен контекст ──────────────────────────────────────────────
function ClinicalContextSection({ state, set }: { state: PatientFormState; set: SetFn }) {
  const [mkbOpen, setMkbOpen] = useState(false);
  return (
    <SectionCard title="Клиничен контекст">
      <div className="flex flex-col gap-4">
        <label className="md:max-w-sm">
          <FieldLabel>Здравно осигуряване</FieldLabel>
          <select className={inputClass()} style={inputStyle()}
                  value={state.insurance_status}
                  onChange={(e) => set('insurance_status', e.target.value)}>
            <option value="nzok">НЗОК</option>
            <option value="private">Частно</option>
            <option value="uninsured">Без осигуровка</option>
          </select>
        </label>

        <div>
          <FieldLabel>Алергии</FieldLabel>
          <ChipInput
            value={state.allergies}
            onChange={(next) => set('allergies', next)}
            placeholder="напр. пеницилин, НСПВС…"
          />
        </div>

        <div>
          <FieldLabel>Хронични състояния</FieldLabel>
          <ChipInput
            value={state.chronic_conditions}
            onChange={(next) => set('chronic_conditions', next)}
            placeholder="напр. Хипертония, Диабет тип 2…"
            trailing={
              <button
                type="button"
                onClick={() => setMkbOpen(true)}
                className="text-xs px-2 py-1 rounded-md"
                style={{ color: 'var(--color-brand)', border: '1px solid var(--color-brand)' }}
              >
                + Избери от МКБ-10
              </button>
            }
          />
        </div>
      </div>

      <MkbPicker
        isOpen={mkbOpen}
        onClose={() => setMkbOpen(false)}
        onPick={(code, term) => {
          const formatted = `${code} — ${term}`;
          if (!state.chronic_conditions.includes(formatted)) {
            set('chronic_conditions', [...state.chronic_conditions, formatted]);
          }
          setMkbOpen(false);
        }}
        title="Избор на хронично състояние"
      />
    </SectionCard>
  );
}

// ── Section: Тип на посещението ─────────────────────────────────────────────
const VISIT_TYPES: Array<{ value: VisitType; label: string }> = [
  { value: 'first',      label: 'Първичен' },
  { value: 'followup',   label: 'Контролен' },
  { value: 'urgent',     label: 'Спешен' },
  { value: 'preventive', label: 'Профилактичен' },
  { value: 'remote',     label: 'Дистанционен' },
];

function VisitTypeSection({ state, set }: { state: PatientFormState; set: SetFn }) {
  return (
    <SectionCard title="Тип на посещението">
      <div className="flex flex-wrap gap-2">
        {VISIT_TYPES.map((t) => {
          const isActive = state.visit_type === t.value;
          return (
            <button
              key={t.value}
              type="button"
              onClick={() => set('visit_type', isActive ? '' : t.value)}
              className="px-4 py-2 rounded-full text-sm font-medium transition"
              style={{
                background:  isActive ? 'var(--color-brand)' : 'transparent',
                color:       isActive ? 'white' : 'var(--color-text-muted)',
                border:      `1px solid ${isActive ? 'var(--color-brand)' : 'var(--color-border-mid)'}`,
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>
    </SectionCard>
  );
}

// ── Section: Главна жалба ───────────────────────────────────────────────────
function ChiefComplaintSection({ state, set }: { state: PatientFormState; set: SetFn }) {
  return (
    <SectionCard title="Главна жалба">
      <textarea
        className="w-full px-3 py-2 rounded-md outline-none text-sm leading-relaxed resize-y"
        style={{ ...inputStyle(), minHeight: '92px' }}
        value={state.chief_complaint}
        onChange={(e) => set('chief_complaint', e.target.value)}
        placeholder="напр. Болки в гърдите от 2 дни, задух при усилие…"
        maxLength={1000}
      />
      <div className="text-[10px] mt-1 text-right" style={{ color: 'var(--color-text-hint)' }}>
        {state.chief_complaint.length} / 1000
      </div>
    </SectionCard>
  );
}

// ── Section: Документация ───────────────────────────────────────────────────
function DocumentationSection({ state, set }: { state: PatientFormState; set: SetFn }) {
  return (
    <SectionCard title="Документация">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <label>
          <FieldLabel>Език</FieldLabel>
          <select className={inputClass()} style={inputStyle()}
                  value={state.language}
                  onChange={(e) => set('language', e.target.value as Locale)}
                  disabled>
            <option value="bg">Български</option>
          </select>
        </label>
      </div>
    </SectionCard>
  );
}
