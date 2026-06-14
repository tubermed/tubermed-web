'use client';

// Patient-history page (/app/patients).
// Two-panel read-only viewer over the patient + filed-note record.
//
//   LEFT  — patient search + paginated visit list (newest first, 10 at a time)
//   RIGHT — patient-level chronic/allergies (EDITABLE) +
//           the clicked visit's filed note (READ-ONLY)
//
// Org-scoped on the server: any clinic doctor can read any of the clinic's
// patients and visits. ЕГН stays hidden behind RevealEgnButton — clicking it
// is the audit record for who looked at what.
//
// The per-visit note is rendered as plain read-only blocks. No EditableField,
// no approve/export, no MKB picker. Past notes are FROZEN records; only the
// patient-level fields (allergies + chronic) are mutable here, and those
// touch the PATIENT row, NOT any consultation.

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import PatientSearch from '@/components/PatientSearch';
import RevealEgnButton from '@/components/RevealEgnButton';
import ChipInput from '@/components/ChipInput';
import Toast, { type ToastData, type ToastKind } from '@/components/Toast';
import SkeletonInput from '@/components/SkeletonInput';
import { Button } from '@/components/ui/Button';
import { api, ApiError } from '@/lib/api';
import { ageFromBirthDate } from '@/lib/age';
import { formatDateTimeBg } from '@/lib/date';
import type {
  PatientSearchHit,
  PatientSummary,
  PatientConsultationSummary,
  PatientConsultationsResponse,
  ConsultationDetail,
  VisitType,
  Medication,
  ComorbidDiagnosis,
} from '@/lib/types';

const PAGE_SIZE = 10;

// ── Status pill palette — mirrors components/TodayConsultations.tsx so the
//    visual vocabulary stays consistent across surfaces. Single source of
//    truth would be nice but extracting it is out of scope for this page.
const STATUS_LABEL: Record<string, { text: string; tone: PillTone }> = {
  pending:   { text: 'Подготовка',  tone: 'pending' },
  started:   { text: 'В ход',       tone: 'active'  },
  generated: { text: 'Готов',       tone: 'done'    },
  exported:  { text: 'Изнесен',     tone: 'done'    },
  abandoned: { text: 'Прекратен',   tone: 'error'   },
  error:     { text: 'Грешка',      tone: 'error'   },
};

type PillTone = 'pending' | 'active' | 'done' | 'error';

const VISIT_TYPE_LABEL: Record<VisitType, string> = {
  first:      'Първичен',
  followup:   'Контролен',
  urgent:     'Спешен',
  preventive: 'Профилактичен',
  remote:     'Дистанционен',
};

export default function PatientsPage() {
  // useSearchParams() (read in PatientsPageInner for the ?patient=&visit=
  // deep-link) must live inside a Suspense boundary in Next.js 16, otherwise the
  // statically-prerendered route bails out at build time.
  return (
    <Suspense fallback={<PatientsBootSplash />}>
      <PatientsPageInner />
    </Suspense>
  );
}

function PatientsBootSplash() {
  return (
    <div
      className="flex-1 flex items-center justify-center"
      style={{ color: 'var(--color-text-muted)' }}
    >
      Зареждане…
    </div>
  );
}

function PatientsPageInner() {
  // ── Selected patient + visit list ─────────────────────────────────────
  const [patient, setPatient]   = useState<PatientSummary | null>(null);
  const [visits, setVisits]     = useState<PatientConsultationSummary[]>([]);
  const [total, setTotal]       = useState(0);
  const [hasMore, setHasMore]   = useState(false);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  // ── Selected visit + note ─────────────────────────────────────────────
  const [activeVisitId, setActiveVisitId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConsultationDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // ── Patient-level edits (chronic + allergies) ─────────────────────────
  // Working copies — only the patient row is touched on save; no consultation
  // note is modified. Initialized from `patient` on load and on save.
  const [allergies, setAllergies] = useState<string[]>([]);
  const [chronic, setChronic]     = useState<string[]>([]);
  const [savingPatient, setSavingPatient] = useState(false);

  // Toast + request-sequence guards (a slow getConsultation must not stomp
  // on the latest click).
  const [toast, setToast] = useState<ToastData | null>(null);
  const toastIdRef = useRef(0);
  const showToast = useCallback((kind: ToastKind, message: string) => {
    toastIdRef.current += 1;
    setToast({ kind, message, id: toastIdRef.current });
  }, []);
  const detailReqIdRef = useRef(0);
  const listReqIdRef   = useRef(0);

  // ── Deep-link (?patient=&visit=) ───────────────────────────────────────
  // The schedule rail (components/TodayConsultations.tsx) links here focused on
  // a patient + a specific visit. The params are consumed once per unique link
  // (deepLinkRef); scrollTargetRef carries the visit id whose row should be
  // scrolled into view once it has rendered as active.
  const searchParams    = useSearchParams();
  const deepLinkRef     = useRef<string | null>(null);
  const scrollTargetRef = useRef<string | null>(null);
  const activeRowRef    = useRef<HTMLLIElement | null>(null);

  // ── Search → patient pick ──────────────────────────────────────────────
  const loadPatient = useCallback(async (id: string) => {
    setLoadingList(true);
    setActiveVisitId(null);
    setDetail(null);
    setVisits([]);
    setTotal(0);
    setHasMore(false);
    const myList = ++listReqIdRef.current;
    try {
      const [p, page] = await Promise.all([
        api.getPatient(id, 'history_view'),
        api.getPatientConsultations(id, 0, PAGE_SIZE),
      ]);
      if (myList !== listReqIdRef.current) return;
      setPatient(p.patient);
      setAllergies(p.patient.allergies || []);
      setChronic(p.patient.chronic_conditions || []);
      applyPage(page, /* append */ false);
    } catch (err) {
      if (myList !== listReqIdRef.current) return;
      showToast('error', err instanceof ApiError ? err.message : 'Грешка при зареждане');
    } finally {
      if (myList === listReqIdRef.current) setLoadingList(false);
    }
  }, [showToast]);

  const applyPage = useCallback((page: PatientConsultationsResponse, append: boolean) => {
    setVisits((prev) => (append ? [...prev, ...page.consultations] : page.consultations));
    setTotal(page.total);
    setHasMore(page.has_more);
  }, []);

  const handlePickPatient = useCallback((hit: PatientSearchHit) => {
    loadPatient(hit.id);
  }, [loadPatient]);

  const handleClearPatient = useCallback(() => {
    setPatient(null);
    setVisits([]);
    setTotal(0);
    setHasMore(false);
    setActiveVisitId(null);
    setDetail(null);
    setAllergies([]);
    setChronic([]);
  }, []);

  // ── Load-more ──────────────────────────────────────────────────────────
  const handleLoadMore = useCallback(async () => {
    if (!patient || !hasMore || loadingMore) return;
    setLoadingMore(true);
    try {
      const next = await api.getPatientConsultations(patient.id, visits.length, PAGE_SIZE);
      applyPage(next, /* append */ true);
    } catch (err) {
      showToast('error', err instanceof ApiError ? err.message : 'Грешка при зареждане');
    } finally {
      setLoadingMore(false);
    }
  }, [patient, hasMore, loadingMore, visits.length, applyPage, showToast]);

  // ── Click a visit → fetch full note ───────────────────────────────────
  const openVisit = useCallback(async (visitId: string) => {
    setActiveVisitId(visitId);
    setDetail(null);
    setLoadingDetail(true);
    const myReq = ++detailReqIdRef.current;
    try {
      const res = await api.getConsultation(visitId);
      if (myReq !== detailReqIdRef.current) return;
      setDetail(res.consultation);
    } catch (err) {
      if (myReq !== detailReqIdRef.current) return;
      showToast('error', err instanceof ApiError ? err.message : 'Грешка при зареждане');
    } finally {
      if (myReq === detailReqIdRef.current) setLoadingDetail(false);
    }
  }, [showToast]);

  // ── Deep-link driver ───────────────────────────────────────────────────
  // On mount / when ?patient=&visit= change, select that patient and open that
  // visit's note through the EXISTING loadPatient + openVisit path (no parallel
  // mechanism). deepLinkRef makes it run once per unique link and never on an
  // unrelated re-render, so the manual search→pick flow (which never touches the
  // URL) is unaffected. A pending/started visit has no filed note: openVisit
  // still selects + highlights the row and shows the honest "no note" empty
  // state — it does not force note content. An unknown/cross-org id falls through
  // to the existing 404 toast + empty handling.
  useEffect(() => {
    const patientId = searchParams.get('patient');
    if (!patientId) return;
    const visitId = searchParams.get('visit');
    const linkKey = `${patientId}|${visitId ?? ''}`;
    if (deepLinkRef.current === linkKey) return;       // already handled this link
    deepLinkRef.current = linkKey;
    let cancelled = false;
    void (async () => {
      await loadPatient(patientId);
      if (cancelled || deepLinkRef.current !== linkKey) return;
      if (visitId) {
        scrollTargetRef.current = visitId;
        await openVisit(visitId);
      }
    })();
    return () => { cancelled = true; };
  }, [searchParams, loadPatient, openVisit]);

  // Once the deep-linked visit row has rendered as active, bring it into view.
  // block:'nearest' is a no-op when the row is already visible — the common case,
  // since today's visit is the newest and sits at the top of the list.
  useEffect(() => {
    if (!scrollTargetRef.current || scrollTargetRef.current !== activeVisitId) return;
    const row = activeRowRef.current;
    if (!row) return;
    scrollTargetRef.current = null;
    row.scrollIntoView({ block: 'nearest', behavior: 'auto' });
  }, [activeVisitId]);

  // ── Save patient-level fields (chronic + allergies only) ──────────────
  // Patient data, NOT a consultation. The PATCH below carries only those
  // two arrays — nothing in any past consultation row is touched.
  const dirty = useMemo(() => {
    if (!patient) return false;
    const arrEq = (a: string[], b: string[]) =>
      a.length === b.length && a.every((v, i) => v === b[i]);
    return !arrEq(allergies, patient.allergies || []) ||
           !arrEq(chronic,   patient.chronic_conditions || []);
  }, [patient, allergies, chronic]);

  const handleSavePatient = useCallback(async () => {
    if (!patient || !dirty) return;
    setSavingPatient(true);
    try {
      const res = await api.updatePatient(patient.id, {
        allergies,
        chronic_conditions: chronic,
      });
      setPatient(res.patient);
      setAllergies(res.patient.allergies || []);
      setChronic(res.patient.chronic_conditions || []);
      showToast('success', '✓ Записано');
    } catch (err) {
      showToast('error', err instanceof ApiError ? err.message : 'Грешка при запазване');
    } finally {
      setSavingPatient(false);
    }
  }, [patient, dirty, allergies, chronic, showToast]);

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <>
      <div
        className="px-6 py-4 border-b"
        style={{ background: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }}
      >
        <div className="text-xs uppercase tracking-[0.18em] mb-1" style={{ color: 'var(--color-text-hint)' }}>
          Пациенти
        </div>
        <div className="text-lg font-semibold" style={{ color: 'var(--color-ink)' }}>
          История на пациент
        </div>
      </div>

      <div className="flex-1 grid gap-6 p-6 patients-grid">
        {/* ─── Left panel: search + visit list ─── */}
        <section className="flex flex-col gap-4 min-w-0">
          <div
            className="rounded-xl p-4"
            style={{ background: 'var(--color-bg-surface)', border: '1px solid var(--color-border-soft)', boxShadow: 'var(--shadow-raised)' }}
          >
            <div
              className="text-xs uppercase tracking-[0.18em] mb-2 font-medium"
              style={{ color: 'var(--color-heading)' }}
            >
              Търсене
            </div>
            <PatientSearch
              onPick={handlePickPatient}
              placeholder="Търси пациент по име или ЕГН"
              selectedLabel={
                patient
                  ? [patient.first_name, patient.middle_name, patient.last_name]
                      .filter(Boolean).join(' ')
                  : null
              }
              onClearSelection={handleClearPatient}
            />
          </div>

          {patient && (
            <div
              className="rounded-xl flex flex-col min-h-0"
              style={{ background: 'var(--color-bg-surface)', border: '1px solid var(--color-border-soft)', boxShadow: 'var(--shadow-raised)' }}
            >
              <div
                className="px-4 py-3 border-b flex items-center justify-between"
                style={{ borderColor: 'var(--color-border-soft)' }}
              >
                <div className="text-xs uppercase tracking-[0.18em]" style={{ color: 'var(--color-heading)' }}>
                  Посещения
                </div>
                <div
                  className="text-xs tabular-nums px-2 py-0.5 rounded"
                  style={{ background: 'var(--color-brand-soft)', color: 'var(--color-brand)' }}
                >
                  {total}
                </div>
              </div>

              {loadingList ? (
                <div className="divide-y" style={{ borderColor: 'var(--color-border-soft)' }}>
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="px-4 py-3">
                      <SkeletonInput height="52px" />
                    </div>
                  ))}
                </div>
              ) : visits.length === 0 ? (
                <div className="px-4 py-6 text-sm" style={{ color: 'var(--color-text-hint)' }}>
                  Няма записани посещения за този пациент.
                </div>
              ) : (
                <>
                  <ul className="divide-y" style={{ borderColor: 'var(--color-border-soft)' }}>
                    {visits.map((v) => (
                      <li key={v.id} ref={v.id === activeVisitId ? activeRowRef : undefined}>
                        <VisitRow
                          visit={v}
                          active={v.id === activeVisitId}
                          onClick={() => openVisit(v.id)}
                        />
                      </li>
                    ))}
                  </ul>
                  {hasMore && (
                    <Button
                      variant="secondary"
                      className="m-3"
                      onClick={handleLoadMore}
                      disabled={loadingMore}
                    >
                      {loadingMore ? 'Зарежда…' : 'Покажи още'}
                    </Button>
                  )}
                </>
              )}
            </div>
          )}
        </section>

        {/* ─── Right panel: patient summary + read-only note ─── */}
        <section className="flex flex-col gap-4 min-w-0">
          {patient ? (
            <>
              <PatientIdentityCard patient={patient} />

              {/* Editable patient-level data — ONLY thing on this page that
                  triggers a write. Visually fenced so the doctor can see
                  it's separate from the per-visit note below. */}
              <div
                className="rounded-xl p-5"
                style={{ background: 'var(--color-bg-surface)', border: '1px solid var(--color-border-soft)', boxShadow: 'var(--shadow-raised)' }}
              >
                <div className="flex items-center justify-between gap-3 mb-3">
                  <div>
                    <div className="text-xs uppercase tracking-[0.18em]" style={{ color: 'var(--color-heading)' }}>
                      Данни за пациента
                    </div>
                    <div className="text-[11px] mt-0.5" style={{ color: 'var(--color-text-hint)' }}>
                      Промените тук не засягат предишни прегледи.
                    </div>
                  </div>
                  <Button
                    variant="primary"
                    onClick={handleSavePatient}
                    disabled={!dirty || savingPatient}
                  >
                    {savingPatient ? 'Запазва…' : 'Запази'}
                  </Button>
                </div>

                <div className="space-y-3">
                  <div>
                    <div
                      className="text-[10px] uppercase tracking-[0.18em] font-semibold mb-1.5"
                      style={{ color: 'var(--color-text-hint)' }}
                    >
                      Алергии
                    </div>
                    <ChipInput
                      value={allergies}
                      onChange={setAllergies}
                      placeholder="Добави алергия и натисни Enter"
                    />
                  </div>
                  <div>
                    <div
                      className="text-[10px] uppercase tracking-[0.18em] font-semibold mb-1.5"
                      style={{ color: 'var(--color-text-hint)' }}
                    >
                      Хронични заболявания
                    </div>
                    <ChipInput
                      value={chronic}
                      onChange={setChronic}
                      placeholder="Добави хронично заболяване и натисни Enter"
                    />
                  </div>
                </div>
              </div>

              {/* Per-visit note — READ-ONLY. Belongs to the chosen consultation,
                  visually fenced from the editable patient data above. */}
              <div className="flex-1 min-h-0">
                {!activeVisitId ? (
                  <EmptyPanel message="Изберете посещение от списъка вляво, за да видите попълнения лист." />
                ) : loadingDetail ? (
                  <EmptyPanel message="Зареждане на лист…" />
                ) : !detail ? (
                  <EmptyPanel message="Листът не може да бъде зареден." />
                ) : (
                  <ReadOnlyNote detail={detail} />
                )}
              </div>
            </>
          ) : (
            <EmptyPanel message="Изберете пациент, за да видите неговата история." />
          )}
        </section>
      </div>

      <Toast toast={toast} onDismiss={() => setToast(null)} />

      {/* Two-column on desktop; stack on narrow screens. Keyed off the main
          container width via the @container query set on <main> in AppShell. */}
      <style jsx>{`
        .patients-grid {
          grid-template-columns: 360px minmax(0, 1fr);
        }
        @container (max-width: 900px) {
          .patients-grid {
            grid-template-columns: minmax(0, 1fr);
          }
        }
      `}</style>
    </>
  );
}

/* ──────────────────────────────────────────────────────────────────────── */

function VisitRow({
  visit,
  active,
  onClick,
}: {
  visit: PatientConsultationSummary;
  active: boolean;
  onClick: () => void;
}) {
  const status = STATUS_LABEL[visit.status] ?? { text: visit.status, tone: 'active' as PillTone };
  const primary = visit.osnovna_diagnoza?.trim()
    || visit.chief_complaint?.trim()
    || 'Без диагноза';
  const vtype = visit.visit_type ? VISIT_TYPE_LABEL[visit.visit_type] : null;
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-4 py-3 flex flex-col gap-1 transition-colors"
      style={{
        background: active ? 'var(--color-brand-soft)' : 'transparent',
        borderLeft: active ? '3px solid var(--color-brand)' : '3px solid transparent',
      }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--color-bg-subtle)'; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className="text-xs tabular-nums"
          style={{ color: 'var(--color-text-muted)' }}
        >
          {formatVisitDate(visit.created_at)}
        </span>
        <StatusPill tone={status.tone}>{status.text}</StatusPill>
      </div>
      <div
        className="text-sm font-medium truncate"
        style={{ color: active ? 'var(--color-brand)' : 'var(--color-ink)' }}
      >
        {primary}
      </div>
      {vtype && (
        <div className="text-xs" style={{ color: 'var(--color-text-hint)' }}>
          {vtype}
        </div>
      )}
    </button>
  );
}

function StatusPill({ tone, children }: { tone: PillTone; children: React.ReactNode }) {
  const palette: Record<PillTone, { bg: string; fg: string }> = {
    pending: { bg: 'var(--color-gold-soft)',   fg: 'var(--color-gold)' },
    active:  { bg: 'var(--color-brand-soft)',  fg: 'var(--color-brand)' },
    done:    { bg: 'var(--color-ok-soft)',     fg: 'var(--color-ok)' },
    error:   { bg: 'var(--color-danger-soft)', fg: 'var(--color-danger)' },
  };
  const c = palette[tone];
  return (
    <span
      className="text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded flex-shrink-0"
      style={{ background: c.bg, color: c.fg }}
    >
      {children}
    </span>
  );
}

function PatientIdentityCard({ patient }: { patient: PatientSummary }) {
  const name = [patient.first_name, patient.middle_name, patient.last_name]
    .filter(Boolean).join(' ') || 'Пациент';
  const age = ageFromBirthDate(patient.birth_date);
  const genderLabel = patient.gender === 'male'   ? 'мъж'
                    : patient.gender === 'female' ? 'жена'
                    : patient.gender === 'other'  ? 'друг'
                    : null;
  return (
    <div
      className="rounded-xl px-5 py-4"
      style={{ background: 'var(--color-bg-surface)', border: '1px solid var(--color-border-soft)', boxShadow: 'var(--shadow-raised)' }}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="text-xl font-semibold" style={{ color: 'var(--color-ink)' }}>
          {name}
        </span>
        {age !== null && (
          <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            {age} г.
          </span>
        )}
        {genderLabel && (
          <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            · {genderLabel}
          </span>
        )}
        {patient.national_id_type !== 'none' && (
          <>
            <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>·</span>
            <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
              {patient.national_id_type === 'egn' ? 'ЕГН' : patient.national_id_type === 'lnch' ? 'ЛНЧ' : 'ID'}:
            </span>
            <RevealEgnButton patientId={patient.id} last4={patient.national_id_last4} />
          </>
        )}
      </div>
    </div>
  );
}

function EmptyPanel({ message }: { message: string }) {
  return (
    <div
      className="rounded-xl px-6 py-12 flex flex-col items-center justify-center text-center gap-3"
      style={{
        background: 'var(--color-surface-tint)',
        border: '1px dashed var(--color-border-strong)',
      }}
    >
      <span
        aria-hidden
        className="flex items-center justify-center flex-shrink-0"
        style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--color-accent-soft)', color: 'var(--color-accent)' }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M14 3v5h5" />
          <path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V8z" />
          <path d="M8.5 13h7M8.5 17h4" />
        </svg>
      </span>
      <span className="text-sm max-w-[34ch]" style={{ color: 'var(--color-text-secondary)' }}>
        {message}
      </span>
    </div>
  );
}

/* ── Read-only filed-note renderer ─────────────────────────────────────────
   Same field layout as the result page's document body, but rendered as
   plain prose blocks. Deliberately does NOT import EditableField, MedsPanel,
   MkbPicker, or any of the result page's edit infrastructure — a past note
   is a frozen record. */
function ReadOnlyNote({ detail }: { detail: ConsultationDetail }) {
  const note = detail.note;
  const headerDate = formatVisitDate(detail.created_at);

  // note === null → pending/error/abandoned visits with no filed lit.
  // Render a clear empty state instead of crashing on field access.
  if (!note) {
    return (
      <div className="space-y-4">
        <NoteHeader detail={detail} dateLabel={headerDate} />
        <EmptyPanel message="Няма попълнен лист за това посещение." />
      </div>
    );
  }

  const pridr = note.pridruzhavashti && note.pridruzhavashti.length > 0
    ? note.pridruzhavashti
    : null;
  const meds = note.medications_list && note.medications_list.length > 0
    ? note.medications_list
    : null;

  return (
    <div className="space-y-4">
      <NoteHeader detail={detail} dateLabel={headerDate} />

      {/* Diagnoses */}
      <ReadOnlySection title="Диагнози МКБ-10">
        <DiagnosisDisplay
          label="Основна диагноза"
          diagnoza={note.osnovna_diagnoza || ''}
          mkb={note.osnovna_mkb || ''}
        />
        {pridr && (
          <div className="mt-4">
            <SubLabel>Придружаващи заболявания</SubLabel>
            <div className="space-y-1.5">
              {pridr.map((d: ComorbidDiagnosis, i: number) => (
                <DiagnosisRow key={i} diagnoza={d.diagnoza} mkb={d.mkb} />
              ))}
            </div>
          </div>
        )}
      </ReadOnlySection>

      <ReadOnlyTextSection title="Анамнеза"          value={note.anamneza}    />
      <ReadOnlyTextSection title="Обективно състояние" value={note.obektivno} />
      <ReadOnlyTextSection title="Изследвания"       value={note.izsledvania} />
      <ReadOnlyTextSection title="Терапия"           value={note.terapia}     />

      {meds && (
        <ReadOnlySection title="Медикаменти">
          <ul className="space-y-2">
            {meds.map((m: Medication, i: number) => (
              <li
                key={i}
                className="px-3 py-2 rounded border text-sm"
                style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
              >
                <div className="font-medium" style={{ color: 'var(--color-ink)' }}>
                  {m.inn}
                </div>
                <div className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                  {[m.dose, m.regimen, m.route, m.duration].filter(Boolean).join(' · ') || '—'}
                </div>
              </li>
            ))}
          </ul>
        </ReadOnlySection>
      )}

      {(note.napravlenia?.trim() || note.naznacheni?.trim()) && (
        <ReadOnlySection title="Издадени документи">
          {note.napravlenia?.trim() && (
            <div className="mb-3">
              <SubLabel>Направления за консултация</SubLabel>
              <ReadOnlyText value={note.napravlenia} />
            </div>
          )}
          {note.naznacheni?.trim() && (
            <div>
              <SubLabel>Назначени изследвания</SubLabel>
              <ReadOnlyText value={note.naznacheni} />
            </div>
          )}
        </ReadOnlySection>
      )}
    </div>
  );
}

function NoteHeader({ detail, dateLabel }: { detail: ConsultationDetail; dateLabel: string }) {
  const vtype = detail.visit_type ? VISIT_TYPE_LABEL[detail.visit_type] : null;
  return (
    <div
      className="bg-white rounded-xl p-6 flex items-baseline justify-between flex-wrap gap-3"
      style={{ border: '1px solid var(--color-border-soft)', boxShadow: 'var(--shadow-raised)' }}
    >
      <div>
        <h2 className="text-2xl font-semibold" style={{ color: 'var(--color-ink)' }}>
          Амбулаторен лист
        </h2>
        {detail.chief_complaint && (
          <div className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>
            {detail.chief_complaint}
          </div>
        )}
      </div>
      <div className="flex items-center gap-3">
        {vtype && (
          <span
            className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded"
            style={{ background: 'var(--color-brand-soft)', color: 'var(--color-brand)' }}
          >
            {vtype}
          </span>
        )}
        <span
          className="text-sm tabular-nums"
          style={{ color: 'var(--color-text-muted)' }}
        >
          {dateLabel}
        </span>
      </div>
    </div>
  );
}

function ReadOnlySection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      className="bg-white rounded-xl p-6"
      style={{ border: '1px solid var(--color-border-soft)', boxShadow: 'var(--shadow-raised)' }}
    >
      <h3 className="text-xl font-semibold mb-4" style={{ color: 'var(--color-ink)' }}>
        {title}
      </h3>
      {children}
    </div>
  );
}

function ReadOnlyTextSection({ title, value }: { title: string; value: string | undefined }) {
  const text = (value || '').trim();
  return (
    <ReadOnlySection title={title}>
      {text ? (
        <ReadOnlyText value={text} />
      ) : (
        <div className="text-sm italic" style={{ color: 'var(--color-text-hint)' }}>
          Не е попълнено.
        </div>
      )}
    </ReadOnlySection>
  );
}

function ReadOnlyText({ value }: { value: string }) {
  return (
    <div
      className="text-sm leading-relaxed whitespace-pre-wrap"
      style={{ color: 'var(--color-text)' }}
    >
      {value}
    </div>
  );
}

function SubLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="text-[11px] uppercase tracking-wider font-semibold mb-2"
      style={{ color: 'var(--color-brand)' }}
    >
      {children}
    </div>
  );
}

function DiagnosisDisplay({
  label,
  diagnoza,
  mkb,
}: {
  label: string;
  diagnoza: string;
  mkb: string;
}) {
  return (
    <div>
      <SubLabel>{label}</SubLabel>
      {diagnoza.trim() || mkb.trim() ? (
        <DiagnosisRow diagnoza={diagnoza} mkb={mkb} />
      ) : (
        <div className="text-sm italic" style={{ color: 'var(--color-text-hint)' }}>
          Не е попълнена.
        </div>
      )}
    </div>
  );
}

function DiagnosisRow({ diagnoza, mkb }: { diagnoza: string; mkb: string }) {
  return (
    <div
      className="px-3 py-2 rounded border flex items-center justify-between gap-3 text-sm"
      style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
    >
      <span style={{ color: 'var(--color-ink)' }}>{diagnoza || '—'}</span>
      {mkb && (
        <span
          className="font-[family-name:var(--font-jetbrains)] text-xs px-2 py-0.5 rounded"
          style={{ color: 'var(--color-gold)', background: 'var(--color-gold-soft)' }}
        >
          {mkb}
        </span>
      )}
    </div>
  );
}

// Thin wrapper over the shared formatter (single source of truth in lib/date).
// `created_at` is always a valid server timestamp, so the '' fallback never shows.
function formatVisitDate(iso: string): string {
  return formatDateTimeBg(iso);
}

