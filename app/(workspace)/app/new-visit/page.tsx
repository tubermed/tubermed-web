'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { RECOVERY_NOTICE_KEY } from '@/lib/use-cold-start-recovery';
import WorkspaceTopBar from '@/components/WorkspaceTopBar';
import { SCRIBE_FLOW_STEPS } from '@/lib/flow';
import StartVisitCard, { EMPTY_START_VISIT, type StartVisitState } from '@/components/StartVisitCard';
import TodayConsultations from '@/components/TodayConsultations';
import Toast, { type ToastData, type ToastKind } from '@/components/Toast';
import OnboardingWizard from '@/components/OnboardingWizard';
import SpotlightTour, { type TourStep } from '@/components/SpotlightTour';
import ValueStatsCard from '@/components/ValueStatsCard';
import { api, ApiError, getSession, type MeResponse, type ValueStats } from '@/lib/api';
import type { PendingVisit } from '@/lib/types';

const PENDING_VISIT_KEY = 'tuber_pending_visit';

// A4 spotlight tour — anchored to data-tour attributes on this page +
// StartVisitCard. One sentence per step (see AGENTS.md "A4 onboarding").
const TOUR_STEPS: TourStep[] = [
  { selector: '[data-tour="visit-context"]', text: 'Изберете тип преглед — една кратка причина за визитата е достатъчна.' },
  { selector: '[data-tour="start"]', text: 'Натиснете тук и говорете с пациента както обикновено.' },
  { selector: '[data-tour="today"]', text: 'Прегледите от деня се появяват тук — с час, тип и повод.' },
];

export default function NewVisitPage() {
  const router = useRouter();

  // Loaded from localStorage once at module load; safe because this page is 'use client'.
  const doctor = useMemo(() => getSession()?.doctor ?? null, []);

  const [card, setCard]             = useState<StartVisitState>(EMPTY_START_VISIT);
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

  // ── Start visit — identity-free staging ──────────────────────────────────
  // Stages the pending row (the consent-gate chokepoint) with nothing but the
  // visit's own context and moves straight into the recording flow.
  const handleStartVisit = useCallback(async () => {
    setSaving(true);
    try {
      const res = await api.startVisit({
        chief_complaint: card.chief_complaint.trim() || null,
        visit_type: card.visit_type || null,
        note_type: card.note_type,
      });

      const pending: PendingVisit = {
        consultation_id: res.consultation_id,
        created_at: new Date().toISOString(),
        visit_metadata: {
          chief_complaint: card.chief_complaint.trim() || null,
          visit_type: card.visit_type || null,
          note_type: card.note_type,
        },
      };
      sessionStorage.setItem(PENDING_VISIT_KEY, JSON.stringify(pending));
      router.push(`/app/scribe?visit=${encodeURIComponent(res.consultation_id)}`);
    } catch (err) {
      showToast('error', err instanceof ApiError ? err.message : 'Грешка при стартиране');
    } finally {
      setSaving(false);
    }
  }, [card, router, showToast]);

  const breadcrumb = [
    { label: 'Нов преглед' },
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
          <StartVisitCard
            state={card}
            onChange={setCard}
            onStartVisit={handleStartVisit}
            isSaving={saving}
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

      <Toast toast={toast} onDismiss={() => setToast(null)} />

      {/* refreshKey is reserved for future use (refresh today's rail after starting a visit). */}
      <span className="hidden">{refreshKey}</span>
    </>
  );
}
