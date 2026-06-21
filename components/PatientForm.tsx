'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { dobFromEgn, genderFromEgn, isValidEgnChecksum } from '@/lib/egn';
import { ageFromBirthDate } from '@/lib/age';
import { dobError } from '@/lib/date';
import { api } from '@/lib/api';
import { Icon } from '@/components/ui/Icon';
import ChipInput from './ChipInput';
import MkbPicker from './MkbPicker';
import PatientResultRow from './PatientResultRow';
import PatientLoadConfirmModal from './PatientLoadConfirmModal';
import { NoteSectionHead } from './ui/NoteSection';
import { FieldLabel } from './ui/Field';
import { Button } from './ui/Button';
import DateInputBg from './ui/DateInputBg';
import type {
  CreatePatientPayload,
  Gender,
  NationalIdType,
  PatientSearchHit,
  PatientSummary,
  VisitType,
  Locale,
} from '@/lib/types';

// Debounce for the form's ЕГН auto-lookup — same spirit as PatientSearch's.
const EGN_LOOKUP_DEBOUNCE_MS = 250;
// Debounce for the name typeahead (Име/Презиме/Фамилия). Slightly longer than
// the ЕГН lookup: name fuzzy search is broader and fires across three fields.
const NAME_LOOKUP_DEBOUNCE_MS = 280;
// Minimum combined name-query length before the typeahead fires — avoids
// querying on a single stray letter.
const NAME_MIN_QUERY_LEN = 2;

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

// Fields whose change counts as a real, user-made patient-record edit for the
// dirty-tracker (drives the ЕГН-switch guard + the "Незапазени промени" modal),
// paired with their Bulgarian labels.
// DELIBERATELY ABSENT:
//   - national_id — it's the value being changed, never compared.
//   - birth_date / gender — these are DERIVED from the ЕГН (dobFromEgn /
//     genderFromEgn), never a user edit. Tracking them caused an off-by-one in
//     the guard: dropping a digit clears birth_date+gender, which then read as
//     "changed" vs the loaded patient on the NEXT keystroke and fired a spurious
//     guard. They must never count as dirty or appear in the modal. They are
//     still PATCHed by persistPatient — exclusion here only affects edit-tracking.
const EDITABLE_FIELD_LABELS: Array<{ key: keyof PatientFormState; label: string }> = [
  { key: 'first_name',         label: 'Име' },
  { key: 'middle_name',        label: 'Презиме' },
  { key: 'last_name',          label: 'Фамилия' },
  { key: 'allergies',          label: 'Алергии' },
  { key: 'chronic_conditions', label: 'Хронични заболявания' },
  { key: 'insurance_status',   label: 'Здравен статус' },
];

const sortedJoin = (arr: string[]) => [...arr].sort().join(' ');

// Bulgarian labels of the editable fields whose form value differs from the
// loaded patient. Baseline is fromPatient(patient) so the normalization
// (null→'', insurance default) matches exactly how the form was populated.
// Arrays compared order-insensitively by content, not reference.
export function changedEditableLabels(form: PatientFormState, patient: PatientSummary): string[] {
  const baseline = fromPatient(patient);
  const labels: string[] = [];
  for (const { key, label } of EDITABLE_FIELD_LABELS) {
    const a = form[key];
    const b = baseline[key];
    const differs = Array.isArray(a) && Array.isArray(b)
      ? sortedJoin(a) !== sortedJoin(b)
      : a !== b;
    if (differs) labels.push(label);
  }
  return labels;
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
  /** The loaded patient record (null for a fresh draft). Carries the id + ЕГН
   *  last-4 the masked-on-load display and RevealEgnButton need. */
  selectedPatient?: PatientSummary | null;
  /** Cleared when the doctor clicks "Започни запис" / "Запази чернова" */
  isSaving?: boolean;
  onSaveDraft: () => void;
  onStartVisit: () => void;
  /** Doctor clicked the ЕГН-field auto-match row. `typedEgn` is the exact ЕГН
   *  the doctor entered (the lookup key) — the caller re-applies it after load. */
  onEgnMatchLoad?: (hit: PatientSearchHit, typedEgn: string) => void;
  /** Doctor picked a row from the name typeahead dropdown — load that patient. */
  onNamePick?: (hit: PatientSearchHit) => void;
  /** Clear the loaded patient and return to the empty NEW-patient state. */
  onClearSelection?: () => void;
}

export default function PatientForm({
  state,
  onChange,
  isExistingPatient,
  selectedPatient,
  isSaving,
  onSaveDraft,
  onStartVisit,
  onEgnMatchLoad,
  onNamePick,
  onClearSelection,
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

  // Age only when the DOB is valid — an errored date (future or not-a-real-day)
  // shows „—", never a misleading number (e.g. 31.02.2000 must not read „26 г.").
  const age = useMemo(
    () => (dobError(state.birth_date) ? null : ageFromBirthDate(state.birth_date)),
    [state.birth_date],
  );
  // Validate a manually-typed DOB (value-based, so input-agnostic). Empty is OK
  // (birth_date is optional); an ЕГН-derived DOB never trips this (dobFromEgn
  // already excludes future / impossible dates before it reaches state).
  const birthError = useMemo(() => dobError(state.birth_date), [state.birth_date]);

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
  const canSubmit = Boolean(state.first_name.trim() && state.last_name.trim() && !egnInvalid && !birthError);

  return (
    <div className="flex flex-col gap-6">
      <IdentificationSection
        state={state}
        set={set}
        setMany={setMany}
        age={age}
        birthError={birthError}
        isExistingPatient={isExistingPatient}
        selectedPatient={selectedPatient}
        onEgnMatchLoad={onEgnMatchLoad}
        onNamePick={onNamePick}
        onClearSelection={onClearSelection}
      />
      <ClinicalContextSection state={state} set={set} />
      {/* Layout-neutral wrapper (same flex/gap as the parent) — the A4
          spotlight tour highlights visit type + chief complaint as ONE step. */}
      <div data-tour="visit-context" className="flex flex-col gap-6">
        <VisitTypeSection state={state} set={set} />
        <ChiefComplaintSection state={state} set={set} />
      </div>
      <DocumentationSection state={state} set={set} />

      <div
        className="nv-card-enter flex items-center justify-between gap-3 px-5 py-4 rounded-2xl border"
        style={{
          background: 'var(--color-bg-surface)',
          borderColor: 'var(--color-border)',
          boxShadow: 'var(--shadow-card)',
        }}
      >
        <Button
          variant="secondary"
          onClick={onSaveDraft}
          disabled={!canSubmit || isSaving}
        >
          {isExistingPatient ? 'Запази промените' : 'Запази чернова'}
        </Button>
        <Button
          variant="primary"
          data-tour="start"
          onClick={onStartVisit}
          disabled={!canSubmit || isSaving}
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

// ── Section: Идентификация ──────────────────────────────────────────────────
type SetFn = <K extends keyof PatientFormState>(key: K, value: PatientFormState[K]) => void;

// Calm-clinical form group — replaces the elevated tinted-header SectionCard
// (no navy icon tile, no #8893A1 subtitle). One hairline sheet (whisper shadow)
// headed by NoteSectionHead (tick + UPPERCASE navy label + hairline), matching
// the result/scribe house style. KEEPS the .nv-card-enter entrance + per-card
// stacking context the in-card name dropdown / DOB popover depend on, and passes
// `data-tour` straight through (the SpotlightTour "egn" anchor). overflow stays
// visible (default) so an absolutely-positioned dropdown inside is never clipped.
function FormSection({
  title,
  children,
  dataTour,
}: {
  title: string;
  children: React.ReactNode;
  dataTour?: string;
}) {
  return (
    <section
      className="nv-card-enter bg-white rounded-2xl border p-6 sm:p-8"
      data-tour={dataTour}
      style={{ borderColor: 'var(--color-border)', boxShadow: 'var(--shadow-card)' }}
    >
      <NoteSectionHead title={title} />
      {children}
    </section>
  );
}

// Shared field treatment. The visual styling (navy 1.5px outline, --control-h,
// hover/focus ring, aria-invalid state) lives in `.nv-field` (globals.css) so the
// hover/focus states inline styles can't express actually work. inputStyle() is
// kept as an empty shim so the existing `style={inputStyle()}` call sites compile
// unchanged; the few fields with real inline overrides set them explicitly.
function inputClass() {
  return 'nv-field';
}
function inputStyle(): React.CSSProperties {
  return {};
}

function IdentificationSection({
  state, set, setMany, age, birthError, isExistingPatient, selectedPatient, onEgnMatchLoad, onNamePick, onClearSelection,
}: {
  state: PatientFormState;
  set: SetFn;
  setMany: (partial: Partial<PatientFormState>) => void;
  age: number | null;
  birthError: 'invalid' | 'future' | null;
  isExistingPatient?: boolean;
  selectedPatient?: PatientSummary | null;
  onEgnMatchLoad?: (hit: PatientSearchHit, typedEgn: string) => void;
  onNamePick?: (hit: PatientSearchHit) => void;
  onClearSelection?: () => void;
}) {
  // ── Name typeahead (Име / Презиме / Фамилия) ─────────────────────────────
  // As the doctor types any of the three name parts, debounce and search. The
  // backend classifies q_kind='name' (trigram fuzzy via search_patients_by_name,
  // transliteration-aware) so a partial first / middle / last name in Latin or
  // Cyrillic all match. Names are NOT unique → never autofill; the doctor must
  // pick a row to disambiguate. Suppressed once a patient is loaded
  // (isExistingPatient): the name fields are then plain edits, not a lookup.
  const nameQuery = [state.first_name, state.middle_name, state.last_name]
    .map((s) => s.trim()).filter(Boolean).join(' ').trim();

  const [nameResults, setNameResults] = useState<PatientSearchHit[]>([]);
  const [nameOpen, setNameOpen] = useState(false);
  const [nameLoading, setNameLoading] = useState(false);
  // The picked-but-not-yet-loaded hit while the confirm modal is open. Name
  // matches are fuzzy / non-unique, so a pick is ambiguous → confirm before load.
  const [confirmHit, setConfirmHit] = useState<PatientSearchHit | null>(null);
  const nameReqRef = useRef(0);
  const nameWrapRef = useRef<HTMLDivElement | null>(null);

  // Debounced search. setState happens ONLY inside the async callback (React 19
  // flags synchronous setState in an effect body); immediate feedback (open +
  // spinner / eager reset) lives in the field onChange handler below.
  useEffect(() => {
    if (isExistingPatient || nameQuery.length < NAME_MIN_QUERY_LEN) return;
    const myId = ++nameReqRef.current;
    const t = setTimeout(async () => {
      try {
        const data = await api.searchPatients(nameQuery, 8);
        if (myId !== nameReqRef.current) return;            // stale — a newer query superseded this
        setNameResults(data.patients);
      } catch {
        if (myId !== nameReqRef.current) return;
        setNameResults([]);
      } finally {
        if (myId === nameReqRef.current) setNameLoading(false);
      }
    }, NAME_LOOKUP_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [nameQuery, isExistingPatient]);

  // Close the dropdown on outside click — same pattern as PatientSearch.
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!nameWrapRef.current) return;
      if (!nameWrapRef.current.contains(e.target as Node)) setNameOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  // Per-keystroke handler for the three name inputs. Applies the edit, then —
  // for a fresh draft only — toggles the dropdown + spinner immediately based
  // on the query the edit produces (state.first_name etc. are still the
  // pre-update values inside this handler, so we substitute the new value).
  function handleNameField(key: 'first_name' | 'middle_name' | 'last_name', value: string) {
    set(key, value);
    if (isExistingPatient) return;
    const probe = [
      key === 'first_name'  ? value : state.first_name,
      key === 'middle_name' ? value : state.middle_name,
      key === 'last_name'   ? value : state.last_name,
    ].map((s) => s.trim()).filter(Boolean).join(' ').trim();
    if (probe.length >= NAME_MIN_QUERY_LEN) {
      setNameOpen(true);
      setNameLoading(true);
    } else {
      setNameOpen(false);
      setNameLoading(false);
      setNameResults([]);
    }
  }

  // A row click does NOT load immediately — it opens the confirm modal. We hide
  // the dropdown (so it isn't behind the modal) but keep nameResults intact so a
  // cancel can reopen the same list. Loading happens only on confirm.
  function handleNamePick(hit: PatientSearchHit) {
    setNameOpen(false);
    setConfirmHit(hit);
  }

  // [Зареди данни] — load the confirmed patient's full record into the form.
  function handleConfirmLoad() {
    const hit = confirmHit;
    if (!hit) return;
    setConfirmHit(null);
    setNameResults([]);
    setNameLoading(false);
    onNamePick?.(hit);
  }

  // [Отказ] — keep the typed name untouched and reopen the dropdown so the
  // doctor can pick a different row (or refine the query).
  function handleConfirmCancel() {
    setConfirmHit(null);
    setNameOpen(true);
  }

  const showNameDropdown =
    nameOpen && !isExistingPatient && nameQuery.length >= NAME_MIN_QUERY_LEN;

  const onNameFocus = () => { if (!isExistingPatient && nameResults.length > 0) setNameOpen(true); };

  const loadedName = selectedPatient
    ? [selectedPatient.first_name, selectedPatient.last_name].filter(Boolean).join(' ')
    : '';

  return (
    <>
    <FormSection title="Идентификация" dataTour="egn">
      {/* Loaded-patient banner + clear control. The search bar that used to host
          the patient chip is gone; clearing here returns the form to the empty
          NEW-patient state (page resets dirty state in the same pass). */}
      {isExistingPatient && selectedPatient && (
        <div
          className="mb-4 flex items-center justify-between gap-3 px-3 py-2 rounded-md"
          style={{ background: 'var(--color-brand-soft)' }}
        >
          <span className="text-sm min-w-0 truncate" style={{ color: 'var(--color-brand)' }}>
            <span className="opacity-70">Зареден пациент:</span>{' '}
            <span className="font-medium">{loadedName || '—'}</span>
          </span>
          <button
            type="button"
            onClick={onClearSelection}
            className="text-xs px-2 py-1 rounded-md flex-shrink-0 hover:underline underline-offset-2 focus-ring"
            style={{ color: 'var(--color-brand)' }}
            aria-label="Изчисти избрания пациент"
          >
            × Изчисти
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Name fields + typeahead dropdown, anchored under the whole name row. */}
        <div className="md:col-span-3 relative" ref={nameWrapRef}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <label>
              <FieldLabel>Име</FieldLabel>
              <input className={inputClass()} style={inputStyle()}
                     value={state.first_name}
                     onChange={(e) => handleNameField('first_name', e.target.value)}
                     onFocus={onNameFocus} />
            </label>
            <label>
              <FieldLabel>Презиме</FieldLabel>
              <input className={inputClass()} style={inputStyle()}
                     value={state.middle_name}
                     onChange={(e) => handleNameField('middle_name', e.target.value)}
                     onFocus={onNameFocus} />
            </label>
            <label>
              <FieldLabel>Фамилия</FieldLabel>
              <input className={inputClass()} style={inputStyle()}
                     value={state.last_name}
                     onChange={(e) => handleNameField('last_name', e.target.value)}
                     onFocus={onNameFocus} />
            </label>
          </div>

          {showNameDropdown && (
            <div
              className="absolute left-0 right-0 top-full mt-1 rounded-md shadow-lg z-40 overflow-hidden"
              style={{ background: 'white', border: '1px solid var(--color-border)' }}
            >
              {nameResults.length > 0 ? (
                <ul className="max-h-[320px] overflow-y-auto">
                  {nameResults.map((hit) => (
                    <li key={hit.id}>
                      <PatientResultRow hit={hit} onClick={() => handleNamePick(hit)} />
                    </li>
                  ))}
                </ul>
              ) : nameLoading ? (
                <div className="px-3 py-3 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  Търсене…
                </div>
              ) : (
                <div className="px-3 py-3 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  Няма съвпадащи пациенти — ще създадете нов.
                </div>
              )}
            </div>
          )}
        </div>

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

        {/* No `key` here: EgnField holds no internal useState (only a ref), so it
            needn't remount on patient change — and remounting would steal the ЕГН
            input's focus when the page drops a loaded patient mid-keystroke on
            ЕГН-invalidation (see handleFormChange in new-visit/page.tsx). */}
        <EgnField
          state={state}
          setMany={setMany}
          isExistingPatient={isExistingPatient}
          onEgnMatchLoad={onEgnMatchLoad}
        />

        <div className="grid grid-cols-2 gap-3 md:col-span-1">
          <label>
            <FieldLabel>Възраст</FieldLabel>
            <div
              className={`${inputClass()} nv-field--readonly flex items-center tabular-nums`}
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
          <FieldLabel>Дата на раждане</FieldLabel>
          <DateInputBg
            className={`${inputClass()} tabular-nums`}
            value={state.birth_date}
            onChange={(iso) => set('birth_date', iso)}
            aria-invalid={birthError ? true : undefined}
          />
          {birthError && (
            <span className="block text-xs mt-1" style={{ color: 'var(--color-danger)' }} role="alert">
              Невалидна дата на раждане.
            </span>
          )}
        </label>
      </div>
    </FormSection>

    {/* Confirm-before-load — NAME typeahead pick only. The full-ЕГН auto-match
        (EgnField) loads directly with no confirm. */}
    <PatientLoadConfirmModal
      hit={confirmHit}
      onConfirm={handleConfirmLoad}
      onCancel={handleConfirmCancel}
    />
    </>
  );
}

// ── ЕГН field — single editable input + instant auto-load ───────────────────
// Encapsulates ALL ЕГН input logic: validity derivation, DOB/gender derivation,
// and the exact-hash instant auto-load. On the new-visit form the ЕГН is ALWAYS
// a plain editable value — no masking, no "показване" reveal link, no "Смени"
// toggle. For a loaded patient the plaintext is supplied by the page (the
// doctor-typed value on the ЕГН path, or a one-time audit-logged revealNationalId
// on the name-typeahead confirm-load). Keyed by patient id so the lookup's
// stale-guard ref resets cleanly on a patient switch.
function EgnField({
  state, setMany, isExistingPatient, onEgnMatchLoad,
}: {
  state: PatientFormState;
  setMany: (partial: Partial<PatientFormState>) => void;
  isExistingPatient?: boolean;
  onEgnMatchLoad?: (hit: PatientSearchHit, typedEgn: string) => void;
}) {
  // Validity derivation — runs every render so we never display stale flags.
  // A complete 10-digit ЕГН counts as "valid" (green ✓ + instant auto-load) ONLY
  // when its digits decode to a real past DOB AND its mod-11 control sum checks
  // out (isValidEgnChecksum, the mirror of the backend). Two DISTINCT failure
  // states for a 10-digit ЕГН:
  //   - derivedDob === null → HARD "невалидно ЕГН" (DOB underivable); blocks
  //     submit via the parent canSubmit gate (unchanged).
  //   - DOB derivable but checksum wrong → SOFT, non-blocking: no ✓, no
  //     auto-load, an amber warning. Mirrors the backend, which SAVES a
  //     bad-checksum ЕГН anyway and surfaces a `validation_warning`
  //     (POST /api/patients) rather than a 400 — so we don't invent a stricter
  //     client gate, we just stop falsely affirming it as a confirmed identity.
  const isEgn           = state.national_id_type === 'egn';
  const ten             = state.national_id.length === 10;
  const derivedDob      = isEgn && ten ? dobFromEgn(state.national_id) : null;
  const checksumOk      = isEgn && ten ? isValidEgnChecksum(state.national_id) : false;
  const egnInvalid      = isEgn && ten && derivedDob === null;
  const checksumInvalid = isEgn && ten && derivedDob !== null && !checksumOk;
  const egnValid        = isEgn && ten && derivedDob !== null && checksumOk;

  const lookupReqRef = useRef(0);

  // ── ЕГН instant auto-load (FIX 1) ────────────────────────────────────────
  // When a complete, valid ЕГН is typed on a not-yet-loaded patient, fire the
  // backend exact-hash lookup; if it resolves to an existing patient, auto-load
  // the full record IMMEDIATELY — no match dropdown, no click (mirrors standard
  // Bulgarian systems). DOB/gender/age are already derived locally by
  // handleNationalIdChange, so they show before the network call even returns;
  // the loaded name appearing instantly is the safety backstop for a mistyped
  // ЕГН. Debounced + stale-guarded (reqId). No match → new patient with that
  // ЕГН. No synchronous setState in the effect body (React 19 flags that) — the
  // load is triggered via the onEgnMatchLoad callback inside the async timeout.
  useEffect(() => {
    if (isExistingPatient || !egnValid) return;
    const egn = state.national_id;
    const myId = ++lookupReqRef.current;
    const t = setTimeout(async () => {
      try {
        const data = await api.searchPatients(egn, 5);
        if (myId !== lookupReqRef.current) return;          // stale — a newer ЕГН superseded this
        const hit = data.patients[0] ?? null;               // exact ЕГН-hash match → 0 or 1 row
        if (hit) onEgnMatchLoad?.(hit, egn);                // resolves → auto-load instantly
      } catch {
        // No match / network error — typing a new patient's ЕГН is normal; do nothing.
      }
    }, EGN_LOOKUP_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [state.national_id, egnValid, isExistingPatient, onEgnMatchLoad]);

  // Handles every keystroke on the ЕГН input. For type='egn' specifically:
  // re-derives DOB + gender on every change. When DOB can't be parsed (length
  // < 10 OR digits 1–6 aren't a real calendar date), both birth_date and gender
  // are cleared in the same React update so we never display a gender derived
  // from a garbage ЕГН. These derived fields are NOT dirty-tracked (see
  // EDITABLE_FIELD_LABELS), so editing the ЕГН never counts as a user change and
  // unpopulating them never trips the ЕГН-switch guard.
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

  const fieldLabel = state.national_id_type === 'egn' ? 'ЕГН'
    : state.national_id_type === 'lnch' ? 'ЛНЧ' : 'Идентификатор';

  // Always a plain editable input. For a loaded patient the value is the full
  // plaintext ЕГН (doctor-typed, or page-revealed on name-load); editing it is
  // how the doctor switches patients (→ ЕГН-switch guard when there are unsaved
  // edits) — or they click "× Изчисти" to clear everything.
  return (
    <div className="md:col-span-1">
      <FieldLabel>{fieldLabel}</FieldLabel>
      <span className="relative block">
        <input
          className={`${inputClass()} tabular-nums tracking-wider pr-7`}
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
            className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center"
            style={{ color: 'var(--color-ok)' }}
            title="Валидно ЕГН"
          >
            <Icon name="check" />
          </span>
        )}
      </span>
      {egnInvalid && (
        <span className="block text-xs mt-1" style={{ color: 'var(--color-danger)' }} role="alert">
          Невалидно ЕГН — датата на раждане не може да бъде извлечена.
        </span>
      )}
      {/* Soft, non-blocking: a derivable-DOB ЕГН whose control sum is wrong. No ✓
          (egnValid is false), no auto-load, and the parent canSubmit gate is NOT
          tripped — same posture the backend takes (validation_warning, not 400).
          Amber, not danger-red, so it reads as a caution rather than a hard stop. */}
      {checksumInvalid && (
        <span className="block text-xs mt-1" style={{ color: 'var(--color-warn)' }} role="status">
          Невалидна контролна сума на ЕГН
        </span>
      )}
    </div>
  );
}

// ── Section: Клиничен контекст ──────────────────────────────────────────────
function ClinicalContextSection({ state, set }: { state: PatientFormState; set: SetFn }) {
  const [mkbOpen, setMkbOpen] = useState(false);
  return (
    <FormSection title="Клиничен контекст">
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
                className="text-xs px-2 py-1 rounded-md focus-ring"
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
    </FormSection>
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
    <FormSection title="Тип на посещението">
      <div className="flex flex-wrap gap-2">
        {VISIT_TYPES.map((t) => {
          const isActive = state.visit_type === t.value;
          return (
            <button
              key={t.value}
              type="button"
              onClick={() => set('visit_type', isActive ? '' : t.value)}
              className="px-4 py-2 rounded-full text-sm font-medium transition focus-ring"
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
    </FormSection>
  );
}

// ── Section: Главна жалба ───────────────────────────────────────────────────
function ChiefComplaintSection({ state, set }: { state: PatientFormState; set: SetFn }) {
  return (
    <FormSection title="Главна жалба">
      <textarea
        className={`${inputClass()} nv-field--area leading-relaxed`}
        value={state.chief_complaint}
        onChange={(e) => set('chief_complaint', e.target.value)}
        placeholder="напр. Болки в гърдите от 2 дни, задух при усилие…"
        maxLength={1000}
      />
      <div className="text-[10px] mt-1 text-right" style={{ color: 'var(--color-text-muted)' }}>
        {state.chief_complaint.length} / 1000
      </div>
    </FormSection>
  );
}

// ── Section: Документация ───────────────────────────────────────────────────
function DocumentationSection({ state, set }: { state: PatientFormState; set: SetFn }) {
  return (
    <FormSection title="Документация">
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
    </FormSection>
  );
}
