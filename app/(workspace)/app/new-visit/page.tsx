'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { RECOVERY_NOTICE_KEY } from '@/lib/use-cold-start-recovery';
import WorkspaceTopBar from '@/components/WorkspaceTopBar';
import { SCRIBE_FLOW_STEPS } from '@/lib/flow';
import { shouldDropLoadedPatient, idLast4 } from '@/lib/national-id';
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
import OnboardingWizard from '@/components/OnboardingWizard';
import SpotlightTour, { type TourStep } from '@/components/SpotlightTour';
import ValueStatsCard from '@/components/ValueStatsCard';
import { api, ApiError, getSession, type MeResponse, type ValueStats } from '@/lib/api';
import type {
  DedupConflict,
  PatientSearchHit,
  PatientSummary,
  PendingVisit,
} from '@/lib/types';

const PENDING_VISIT_KEY = 'tuber_pending_visit';

// A4 spotlight tour — anchored to data-tour attributes on this page +
// PatientForm. One sentence per step (see AGENTS.md "A4 onboarding").
const TOUR_STEPS: TourStep[] = [
  { selector: '[data-tour="egn"]', text: 'Въведете ЕГН — данните на пациента се попълват автоматично.' },
  { selector: '[data-tour="visit-context"]', text: 'Една кратка причина за визитата е достатъчна.' },
  { selector: '[data-tour="start"]', text: 'Натиснете тук и говорете с пациента както обикновено.' },
  { selector: '[data-tour="today"]', text: 'Готовите прегледи се появяват тук през целия ден.' },
];

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

  // ── A4 first-run wizard + tour ───────────────────────────────────────────
  // The wizard opens ONLY on an explicit onboarding_completed_at === null
  // from /me (fresh post-015 signup). An ABSENT key (backend migration 015
  // not applied) or a failed fetch means "unknown" → show nothing — an
  // existing doctor must never see a wizard flash.
  const [me, setMe] = useState<MeResponse | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [tourOpen, setTourOpen]     = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .me()
      .then((m) => {
        if (cancelled) return;
        setMe(m);
        if (m.onboarding_completed_at === null) setWizardOpen(true);
      })
      .catch(() => {
        /* unknown — show nothing */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // B2 value card — the doctor's own "% of notes TuberMed wrote" stats. Best
  // effort + independent of /me: on any error the card stays hidden (renders
  // null), never breaking the page.
  const [valueStats, setValueStats] = useState<ValueStats | null>(null);
  const [valueStatsLoading, setValueStatsLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    api
      .valueStats()
      .then((v) => { if (!cancelled) setValueStats(v); })
      .catch(() => { /* keep the card hidden on error */ })
      .finally(() => { if (!cancelled) setValueStatsLoading(false); });
    return () => {
      cancelled = true;
    };
  }, []);

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

  // Cold-start recovery bounces an unrecoverable / abandoned visit here with a
  // one-shot reason in sessionStorage. Surface it once, then clear it so a
  // later manual navigation to /app/new-visit doesn't re-show a stale message.
  useEffect(() => {
    let notice: string | null = null;
    try {
      notice = sessionStorage.getItem(RECOVERY_NOTICE_KEY);
      if (notice) sessionStorage.removeItem(RECOVERY_NOTICE_KEY);
    } catch {
      /* sessionStorage unavailable — no notice to show */
    }
    if (notice === 'visit_abandoned') {
      showToast('info', 'Това посещение е приключено и не може да бъде възстановено. Започнете ново.');
    } else if (notice === 'visit_unavailable') {
      showToast('info', 'Посещението не е намерено или вече е недостъпно. Започнете ново.');
    }
  }, [showToast]);

  // ── Shared load path ─────────────────────────────────────────────────────
  // The ONE place that loads an existing patient into the form:
  // getPatient → setSelected → setForm(fromPatient(...)). Both the form's name
  // typeahead pick AND the form's ЕГН instant auto-load route through this — no
  // duplicated getPatient/fromPatient/setForm sequence. getPatient pulls the
  // full record incl. allergies + chronic_conditions (the drug-safety engine
  // depends on those being loaded). Returns the patient (or null on failure) so
  // callers can chain a follow-up (re-apply typed ЕГН / reveal plaintext) only
  // when the load actually succeeded. fromPatient blanks national_id for GDPR —
  // plaintext is NEVER sourced from getPatient/search, only from revealNationalId.
  // `method` ('egn_typed' | 'name_pick') is forwarded to the backend's
  // patient_viewed audit event so the load context is distinguishable.
  const loadExistingPatient = useCallback(async (
    id: string,
    method: 'egn_typed' | 'name_pick',
  ): Promise<PatientSummary | null> => {
    try {
      const detail = await api.getPatient(id, method);
      setSelected(detail.patient);
      setForm(fromPatient(detail.patient));
      return detail.patient;
    } catch (err) {
      showToast('error', err instanceof ApiError ? err.message : 'Грешка при зареждане');
      return null;
    }
  }, [showToast]);

  // Name-typeahead confirm-load. After the shared load (which blanks national_id),
  // reveal the plaintext ЕГН ONCE via the audit-logged revealNationalId endpoint
  // and show it in the field — the confirm is the deliberate, logged action, so
  // displaying the full ЕГН here is in scope. NO 30s auto-hide on this new-visit
  // path (the patients browsing page keeps masked + manual reveal + auto-hide).
  // Functional setForm merges onto fromPatient's result with no stale-state race.
  const handlePickFromName = useCallback(
    async (hit: PatientSearchHit) => {
      const patient = await loadExistingPatient(hit.id, 'name_pick');
      if (!patient) return;
      try {
        // 'name_load_autoreveal' tags this as the automatic reveal-on-load,
        // distinct from a deliberate показване click ('manual_reveal').
        const { national_id } = await api.revealNationalId(patient.id, 'name_load_autoreveal');
        if (national_id) setForm((prev) => ({ ...prev, national_id }));
      } catch {
        // Reveal failed — leave the ЕГН field blank; non-fatal, the name is loaded.
      }
    },
    [loadExistingPatient]
  );

  // Form ЕГН field resolved to an existing patient → instant auto-load (FIX 1).
  // After the shared load (which blanks national_id via fromPatient for GDPR),
  // re-apply the ЕГН the DOCTOR typed this session — already plaintext in their
  // hands by their own action, unlike a DB-fetched value. Functional update so
  // it merges on top of loadExistingPatient's setForm with no stale-state race.
  // This persist lives ONLY here, never in the shared helper, so the name-pick
  // path stays plaintext-free until its explicit revealNationalId call.
  const handleEgnMatchLoad = useCallback(
    async (hit: PatientSearchHit, typedEgn: string) => {
      const patient = await loadExistingPatient(hit.id, 'egn_typed');
      if (!patient) return;
      setForm((prev) => ({ ...prev, national_id: typedEgn }));
    },
    [loadExistingPatient]
  );

  // Clear the loaded patient → back to the empty NEW-patient form. setForm runs
  // directly (NOT through handleFormChange), so the ЕГН-switch guard never fires
  // on a clear, and the dirty-tracker (changedEditableLabels vs `selected`) is
  // reset cleanly because `selected` goes null in the same pass.
  const handleClearSelection = useCallback(() => {
    setSelected(null);
    setForm(EMPTY_FORM);
  }, []);

  // ── Form change interceptor — the single owner of `selected` on ЕГН edits ──
  // Every form change reports through here. When the ЕГН of a LOADED patient is
  // edited, this one predicate decides hold-vs-drop-vs-apply; no other handler
  // clears the loaded patient on ЕГН edits (the only other clear is the explicit
  // "× Изчисти" button via handleClearSelection). Three branches:
  //
  //   1. Unsaved patient-record edits (changedEditableLabels > 0) → HOLD the
  //      change and surface EgnSwitchGuardModal (rule 4) — otherwise switching
  //      patients would silently discard the edits.
  //   2. No edits, and the edited ID is no longer valid FOR ITS TYPE → DROP the
  //      patient: a loaded name shown next to a now-mismatched/empty ID is the
  //      wrong-identity hazard. Clear selection + reset to a FULL empty
  //      new-patient form, keeping ONLY the in-progress ID (so re-typing a valid
  //      ЕГН re-fires the auto-load). chief_complaint + visit_type are CLEARED:
  //      changing the patient = a fresh visit, applied uniformly on both
  //      patient-change paths (this drop AND the guard-save swap). See AGENTS.md
  //      rule 4 — this reverses the earlier preserve-decision.
  //      Scope: ALL id types via shouldDropLoadedPatient (P1-02 — was 'egn' only,
  //      which left a stale ЛНЧ/foreign patient pinned to a mismatched id → a
  //      wrong-patient filing). 'none' never drops on this basis (no id).
  //   3. Otherwise (still-valid id, or a non-id field change) → apply normally.
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

      // "Valid identity" is per-type (lib/national-id.ts, mirroring the backend):
      //   egn     → 10 digits + a derivable DOB + a correct mod-11 checksum (the
      //             EgnField green-✓ / auto-load gate — keeps the drop firing in
      //             lockstep with the ✓ disappearing for a typo'd/transposed ЕГН);
      //   lnch    → 10 digits;
      //   foreign → non-empty;
      //   none    → never drops on this basis (no id).
      // P1-02: this was 'egn' only, so a mismatched ЛНЧ/foreign id kept the loaded
      // patient pinned (banner + DOB/age) — a save then filed onto the wrong
      // patient. shouldDropLoadedPatient generalizes the predicate to all types.
      if (shouldDropLoadedPatient(next.national_id_type, next.national_id)) {
        setSelected(null);
        setForm({
          ...EMPTY_FORM,
          national_id_type: next.national_id_type,
          national_id:      next.national_id,   // keep ONLY what the doctor is mid-typing
        });
        return; // DROP — loaded identity + visit context cleared; re-typing a valid id re-loads (ЕГН auto-loads)
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
    // The current patient's record edits were just PATCHed above (they are NOT
    // lost). The held ЕГН change now proceeds onto a FULL empty form carrying only
    // the new ЕГН + its derived DOB/gender. chief_complaint + visit_type are
    // CLEARED, not carried over — changing the patient = a fresh visit, applied
    // uniformly on both patient-change paths (this swap AND the drop above). See
    // AGENTS.md rule 4 — this reverses the earlier preserve-decision (consistency
    // + avoids one patient's complaint contaminating another's form).
    setForm({
      ...EMPTY_FORM,
      national_id_type: held.pendingForm.national_id_type,
      national_id:      held.pendingForm.national_id,
      birth_date:       held.pendingForm.birth_date,
      gender:           held.pendingForm.gender,
    });
    showToast('success', 'Промените са запазени.');
  }, [egnGuard, form, persistPatient, showToast]);

  // [Отказ]: discard the held change. The form was never updated, so the ЕГН
  // input reverts to the loaded patient's value and the edits stay intact.
  const onEgnGuardCancel = useCallback(() => setEgnGuard(null), []);

  // ── P1-02 belt-and-suspenders — refuse to save onto a mismatched loaded id ──
  // Even if the drop predicate ever missed a case, this stops a visit being filed
  // onto a stale `selected.id`. `selected` is GDPR-masked (no full id), so we
  // compare last4 (idLast4 mirrors backend last4). Only a NON-EMPTY form id that
  // differs is a mismatch — a blank id field is the legitimate post-load/post-save
  // (fromPatient-blanked) state, NOT a typed mismatch, and must not block the save.
  const loadedIdentityMismatch = useCallback((): boolean => {
    if (!selected || selected.national_id_type === 'none' || !selected.national_id_last4) return false;
    const formLast4 = idLast4(form.national_id);
    return formLast4 !== null && formLast4 !== selected.national_id_last4;
  }, [selected, form]);

  // ── Footer buttons ───────────────────────────────────────────────────────
  const handleSaveDraft = useCallback(async () => {
    if (loadedIdentityMismatch()) {
      showToast('error', 'Документът за самоличност не съвпада със зареден пациент. Проверете пациента.');
      return;
    }
    setSaving(true);
    const patient = await persistPatient(form, false);
    setSaving(false);
    if (patient) {
      setSelected(patient);
      setForm(fromPatient(patient));
      showToast('success', selected ? 'Промените са запазени.' : 'Пациентът е създаден.');
    }
  }, [form, persistPatient, selected, showToast, loadedIdentityMismatch]);

  const handleStartVisit = useCallback(async () => {
    if (loadedIdentityMismatch()) {
      showToast('error', 'Документът за самоличност не съвпада със зареден пациент. Проверете пациента.');
      return;
    }
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
  }, [form, persistPatient, router, showToast, loadedIdentityMismatch]);

  // ── Dedup modal handlers ─────────────────────────────────────────────────
  const onDedupUseExisting = useCallback(async (hit: PatientSearchHit) => {
    setDedup(null);
    setPendingPayload(null);
    try {
      const detail = await api.getPatient(hit.id, 'dedup_pick');
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
      />

      <div className="flex-1 grid gap-6 px-6 py-6"
           style={{ gridTemplateColumns: 'minmax(0, 1fr) 320px' }}>
        <div className="min-w-0">
          <ValueStatsCard stats={valueStats} loading={valueStatsLoading} />
          <PatientForm
            state={form}
            onChange={handleFormChange}
            isExistingPatient={!!selected}
            selectedPatient={selected}
            isSaving={saving}
            onSaveDraft={handleSaveDraft}
            onStartVisit={handleStartVisit}
            onEgnMatchLoad={handleEgnMatchLoad}
            onNamePick={handlePickFromName}
            onClearSelection={handleClearSelection}
          />
        </div>
        <div data-tour="today">
          <TodayConsultations refreshKey={refreshKey} />
        </div>
      </div>

      {wizardOpen && me && (
        <OnboardingWizard
          me={me}
          onClose={() => setWizardOpen(false)}
          onStartTour={() => {
            setWizardOpen(false);
            setTourOpen(true);
          }}
        />
      )}
      {tourOpen && <SpotlightTour steps={TOUR_STEPS} onClose={() => setTourOpen(false)} />}

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
