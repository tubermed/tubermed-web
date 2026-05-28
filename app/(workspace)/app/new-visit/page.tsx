'use client';

import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import WorkspaceTopBar from '@/components/WorkspaceTopBar';
import { SCRIBE_FLOW_STEPS } from '@/lib/flow';
import PatientSearch from '@/components/PatientSearch';
import PatientForm, {
  EMPTY_FORM,
  fromPatient,
  toCreatePayload,
  changedEditableLabels,
  type PatientFormState,
} from '@/components/PatientForm';
import DedupModal from '@/components/DedupModal';
import EgnSwitchGuardModal from '@/components/EgnSwitchGuardModal';
import TodayConsultations from '@/components/TodayConsultations';
import Toast, { type ToastData, type ToastKind } from '@/components/Toast';
import { api, ApiError, getSession } from '@/lib/api';
import type {
  DedupConflict,
  PatientSearchHit,
  PatientSummary,
  PendingVisit,
} from '@/lib/types';

const PENDING_VISIT_KEY = 'tuber_pending_visit';

export default function NewVisitPage() {
  const router = useRouter();

  // Loaded from localStorage once at module load; safe because this page is 'use client'.
  const doctor = useMemo(() => getSession()?.doctor ?? null, []);

  const [form, setForm]             = useState<PatientFormState>(EMPTY_FORM);
  const [selected, setSelected]     = useState<PatientSummary | null>(null);
  const [dedup, setDedup]           = useState<DedupConflict | null>(null);
  const [pendingPayload, setPendingPayload] = useState<PatientFormState | null>(null);
  const [saving, setSaving]         = useState(false);
  const [toast, setToast]           = useState<ToastData | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Held ЕГН change: set when the doctor edits national_id away from a loaded
  // patient that has unsaved edits. `pendingForm` is the not-yet-applied form
  // state; we hold it until the doctor saves or cancels.
  const [egnGuard, setEgnGuard] = useState<{
    pendingForm: PatientFormState;
    changedLabels: string[];
    patientName: string;
  } | null>(null);

  const showToast = useCallback((kind: ToastKind, message: string) => {
    setToast({ kind, message, id: Date.now() });
  }, []);

  // ── Shared load path ─────────────────────────────────────────────────────
  // The ONE place that loads an existing patient into the form:
  // getPatient → setSelected → setForm(fromPatient(...)). Both the top-bar
  // search pick AND the form's ЕГН auto-match route through this — no
  // duplicated getPatient/fromPatient/setForm sequence.
  const loadExistingPatient = useCallback(async (id: string) => {
    try {
      const detail = await api.getPatient(id);
      setSelected(detail.patient);
      setForm(fromPatient(detail.patient));
    } catch (err) {
      showToast('error', err instanceof ApiError ? err.message : 'Грешка при зареждане');
    }
  }, [showToast]);

  // Top-bar search pick.
  const handlePickFromSearch = useCallback(
    (hit: PatientSearchHit) => loadExistingPatient(hit.id),
    [loadExistingPatient]
  );

  // Form ЕГН field matched an existing patient; doctor clicked the row.
  // After the shared load (which blanks national_id via fromPatient for GDPR),
  // re-apply the ЕГН the DOCTOR typed this session — already plaintext in their
  // hands by their own action, unlike a DB-fetched value. Functional update so
  // it merges on top of loadExistingPatient's setForm with no stale-state race.
  // This persist lives ONLY here, never in the shared helper, so the top-search
  // pick still blanks correctly.
  const handleEgnMatchLoad = useCallback(
    async (hit: PatientSearchHit, typedEgn: string) => {
      await loadExistingPatient(hit.id);
      setForm((prev) => ({ ...prev, national_id: typedEgn }));
    },
    [loadExistingPatient]
  );

  const handleClearSelection = useCallback(() => {
    setSelected(null);
    setForm(EMPTY_FORM);
  }, []);

  // Prefill name from the search query when creating fresh from a zero-result state.
  const handleCreateFromSearch = useCallback((query: string) => {
    const parts = query.trim().split(/\s+/);
    setSelected(null);
    setForm({
      ...EMPTY_FORM,
      first_name: parts[0] || '',
      middle_name: parts.length > 2 ? parts.slice(1, -1).join(' ') : '',
      last_name:  parts.length > 1 ? parts[parts.length - 1] : '',
    });
  }, []);

  // ── Form change interceptor (ЕГН-switch guard) ───────────────────────────
  // The single onChange the form reports through. When the doctor edits the
  // ЕГН field on a loaded patient that already has unsaved edits, hold the
  // change and surface a modal instead of applying it — otherwise the edits
  // would be silently discarded when a different patient loads. Every other
  // change (and ЕГН edits with no pending edits, or on a fresh draft) applies
  // straight through.
  const handleFormChange = useCallback((next: PatientFormState) => {
    if (selected && next.national_id !== form.national_id) {
      const changedLabels = changedEditableLabels(form, selected);
      if (changedLabels.length > 0) {
        setEgnGuard({
          pendingForm: next,
          changedLabels,
          patientName: [selected.first_name, selected.last_name].filter(Boolean).join(' '),
        });
        return; // HOLD — input reverts to the loaded ЕГН until the doctor chooses
      }
    }
    setForm(next);
  }, [selected, form]);

  // ── POST /api/patients with dedup handling ───────────────────────────────
  const persistPatient = useCallback(async (s: PatientFormState, force: boolean): Promise<PatientSummary | null> => {
    if (selected) {
      // Existing patient: PATCH the editable fields (no national_id rotation here)
      try {
        const res = await api.updatePatient(selected.id, {
          first_name: s.first_name.trim(),
          middle_name: s.middle_name.trim() || null,
          last_name: s.last_name.trim(),
          birth_date: s.birth_date || null,
          gender: (s.gender || null) as PatientSummary['gender'],
          allergies: s.allergies,
          chronic_conditions: s.chronic_conditions,
          insurance_status: s.insurance_status || null,
        });
        return res.patient;
      } catch (err) {
        showToast('error', err instanceof ApiError ? err.message : 'Грешка при запис');
        return null;
      }
    }

    // New patient
    try {
      const result = await api.createPatient(toCreatePayload(s, force));
      if (result.ok) {
        if (result.data.validation_warning) showToast('info', result.data.validation_warning);
        return result.data.patient;
      }
      // 409 dedup — store the payload so we can retry with force=true after user confirms
      setDedup(result.dedup);
      setPendingPayload(s);
      return null;
    } catch (err) {
      showToast('error', err instanceof ApiError ? err.message : 'Грешка при създаване');
      return null;
    }
  }, [selected, showToast]);

  // ── ЕГН-switch guard handlers ────────────────────────────────────────────
  // [Запази промените]: PATCH the loaded patient with the current edits, then
  // let the held ЕГН change proceed as a fresh entry (selection cleared so the
  // new value can trigger a normal match/load).
  const onEgnGuardSave = useCallback(async () => {
    const held = egnGuard;
    if (!held) return;
    setSaving(true);
    const patient = await persistPatient(form, false); // selected truthy → PATCH path
    setSaving(false);
    if (!patient) return; // save failed (toast shown) — keep modal open, nothing lost
    setEgnGuard(null);
    setSelected(null);
    // Only the PATIENT identity swaps. Carry over the visit context the doctor
    // already typed (chief_complaint, visit_type) — resetting those would be the
    // same silent data loss this guard exists to prevent.
    setForm({
      ...EMPTY_FORM,
      national_id_type: held.pendingForm.national_id_type,
      national_id:      held.pendingForm.national_id,
      birth_date:       held.pendingForm.birth_date,
      gender:           held.pendingForm.gender,
      chief_complaint:  form.chief_complaint,
      visit_type:       form.visit_type,
    });
    showToast('success', 'Промените са запазени.');
  }, [egnGuard, form, persistPatient, showToast]);

  // [Отказ]: discard the held change. The form was never updated, so the ЕГН
  // input reverts to the loaded patient's value and the edits stay intact.
  const onEgnGuardCancel = useCallback(() => setEgnGuard(null), []);

  // ── Footer buttons ───────────────────────────────────────────────────────
  const handleSaveDraft = useCallback(async () => {
    setSaving(true);
    const patient = await persistPatient(form, false);
    setSaving(false);
    if (patient) {
      setSelected(patient);
      setForm(fromPatient(patient));
      showToast('success', selected ? 'Промените са запазени.' : 'Пациентът е създаден.');
    }
  }, [form, persistPatient, selected, showToast]);

  const handleStartVisit = useCallback(async () => {
    setSaving(true);
    const patient = await persistPatient(form, false);
    if (!patient) { setSaving(false); return; }

    try {
      const res = await api.startVisit({
        patient_id: patient.id,
        chief_complaint: form.chief_complaint.trim() || null,
        visit_type: form.visit_type || null,
      });

      const pending: PendingVisit = {
        consultation_id: res.consultation_id,
        patient: res.patient_summary,
        visit_metadata: {
          chief_complaint: form.chief_complaint.trim() || null,
          visit_type: form.visit_type || null,
        },
      };
      sessionStorage.setItem(PENDING_VISIT_KEY, JSON.stringify(pending));
      router.push(`/app/scribe?visit=${encodeURIComponent(res.consultation_id)}`);
    } catch (err) {
      showToast('error', err instanceof ApiError ? err.message : 'Грешка при стартиране');
    } finally {
      setSaving(false);
    }
  }, [form, persistPatient, router, showToast]);

  // ── Dedup modal handlers ─────────────────────────────────────────────────
  const onDedupUseExisting = useCallback(async (hit: PatientSearchHit) => {
    setDedup(null);
    setPendingPayload(null);
    try {
      const detail = await api.getPatient(hit.id);
      setSelected(detail.patient);
      setForm(fromPatient(detail.patient));
      showToast('info', 'Зареден е съществуващият пациент.');
    } catch (err) {
      showToast('error', err instanceof ApiError ? err.message : 'Грешка');
    }
  }, [showToast]);

  const onDedupForceCreate = useCallback(async () => {
    if (!pendingPayload) { setDedup(null); return; }
    const stash = pendingPayload;
    setDedup(null);
    setPendingPayload(null);
    setSaving(true);
    const patient = await persistPatient(stash, true);
    setSaving(false);
    if (patient) {
      setSelected(patient);
      setForm(fromPatient(patient));
      showToast('success', 'Пациентът е създаден.');
    }
  }, [pendingPayload, persistPatient, showToast]);

  // ── Breadcrumb ───────────────────────────────────────────────────────────
  const patientLabel = selected
    ? [selected.first_name, selected.last_name].filter(Boolean).join(' ')
    : form.first_name || form.last_name
    ? [form.first_name, form.last_name].filter(Boolean).join(' ').trim() || 'Нов пациент'
    : 'Нов пациент';

  const breadcrumb = [
    { label: 'Нов преглед' },
    { label: patientLabel },
    { label: 'Вход' },
  ];

  const doctorInitials = doctor?.name
    ? doctor.name.replace(/^д-р\s*/i, '').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase()
    : undefined;

  return (
    <>
      <WorkspaceTopBar
        breadcrumb={breadcrumb}
        steps={SCRIBE_FLOW_STEPS}
        current={0}
        doctorInitials={doctorInitials}
        searchSlot={
          <PatientSearch
            onPick={handlePickFromSearch}
            onCreateNew={handleCreateFromSearch}
            selectedLabel={selected ? patientLabel : null}
            onClearSelection={handleClearSelection}
          />
        }
      />

      <div className="flex-1 grid gap-6 px-6 py-6"
           style={{ gridTemplateColumns: 'minmax(0, 1fr) 320px' }}>
        <div className="min-w-0">
          <PatientForm
            state={form}
            onChange={handleFormChange}
            isExistingPatient={!!selected}
            isSaving={saving}
            onSaveDraft={handleSaveDraft}
            onStartVisit={handleStartVisit}
            onEgnMatchLoad={handleEgnMatchLoad}
          />
        </div>
        <div>
          <TodayConsultations refreshKey={refreshKey} />
        </div>
      </div>

      <DedupModal
        conflict={dedup}
        onUseExisting={onDedupUseExisting}
        onForceCreate={onDedupForceCreate}
        onCancel={() => { setDedup(null); setPendingPayload(null); }}
      />

      <EgnSwitchGuardModal
        open={!!egnGuard}
        patientName={egnGuard?.patientName ?? ''}
        changedLabels={egnGuard?.changedLabels ?? []}
        saving={saving}
        onSave={onEgnGuardSave}
        onCancel={onEgnGuardCancel}
      />

      <Toast toast={toast} onDismiss={() => setToast(null)} />

      {/* refreshKey is reserved for future use (refresh today's rail after starting a visit). */}
      <span className="hidden">{refreshKey}</span>
    </>
  );
}
