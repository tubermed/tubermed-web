'use client';

import { Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { QRCodeSVG } from 'qrcode.react';
import AppShell from '@/components/AppShell';
import Stepper from '@/components/Stepper';
import PatientHeaderStrip from '@/components/PatientHeaderStrip';
import { SCRIBE_FLOW_STEPS } from '@/lib/flow';
import {
  api,
  ApiError,
  clearSession,
  getSession,
  isMissingConsentError,
  wsUrl,
  type DoctorInfo,
} from '@/lib/api';
import type {
  TranscribeResult,
  SessionInit,
  WsMessage,
  PendingVisit,
  ConsentResponse,
} from '@/lib/types';
import ConsentModal from '@/components/ConsentModal';
import Toast, { type ToastData, type ToastKind } from '@/components/Toast';
import { useColdStartRecovery } from '@/lib/use-cold-start-recovery';
import { Icon } from '@/components/ui/Icon';
import { Segmented } from '@/components/ui/Segmented';
import { Button } from '@/components/ui/Button';

type Mode = 'phone' | 'pc';
type View = 'record' | 'processing';

const RESULT_STORAGE_KEY  = 'tuber_last_result';
const PENDING_VISIT_KEY   = 'tuber_pending_visit';

// useSearchParams() must live inside a Suspense boundary in Next.js 16.
export default function ScribePage() {
  return (
    <Suspense fallback={<BootSplash />}>
      <ScribePageInner />
    </Suspense>
  );
}

function BootSplash() {
  return (
    <main className="min-h-screen flex items-center justify-center" style={{ color: 'var(--color-text-muted)' }}>
      Зареждане…
    </main>
  );
}

function ScribePageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [doctor, setDoctor] = useState<DoctorInfo | null>(null);
  const [mode, setMode] = useState<Mode>('phone');
  const [view, setView] = useState<View>('record');
  const [error, setError] = useState<string | null>(null);
  const [consultationId, setConsultationId] = useState<string | null>(null);
  const [pendingVisit, setPendingVisit] = useState<PendingVisit | null>(null);
  // Cold-start recovery: set to the ?visit= id when sessionStorage is absent
  // (hard refresh / new tab / laptop sleep). Drives useColdStartRecovery below;
  // stays null on the happy path so recovery never fires there.
  const [recoverVisitId, setRecoverVisitId] = useState<string | null>(null);
  // A3 failure-recovery: when a processing run fails on a STAGED consultation
  // (Claude threw after Soniox already produced + persisted a transcript), the
  // note can be resurrected with retry-extraction WITHOUT re-recording. Holding
  // the consultation id here swaps the in-flow UI for the recovery panel. Stays
  // null on the happy path. See RecoveryPanel below.
  const [recoverableVisitId, setRecoverableVisitId] = useState<string | null>(null);
  // PC-side recording active flag — bubbled up from PcMode so the sidebar
  // can be locked while the doctor is mid-recording. Phone-side "in progress"
  // naturally maps to view === 'processing' (PC isn't recording anything).
  const [pcRecording, setPcRecording] = useState(false);
  const navLocked      = pcRecording || view === 'processing';
  const stepperCurrent = view === 'processing' ? 2 : 1;

  // ── Consent gate state ─────────────────────────────────────────────────
  // True once the patient consent timestamp is on file for THIS consultation.
  // Seeded from sessionStorage (the PendingVisit object survives a tab
  // refresh) so a doctor who already consented does not see the modal again.
  const [consentRecorded, setConsentRecorded] = useState(false);
  const [consentModalOpen, setConsentModalOpen] = useState(false);
  // requestConsent() returns a Promise that resolves once consent is on file.
  // Gate 2 (PcMode pre-transcribe and the 403-missing-consent retry path)
  // awaits this promise so the audio submission blocks behind the modal.
  const consentResolverRef = useRef<(() => void) | null>(null);
  const [toast, setToast] = useState<ToastData | null>(null);
  const toastIdRef = useRef(0);

  // ── Auth + visit-staging gate ──────────────────────────────────────────
  // Requires both a session AND a matching tuber_pending_visit in sessionStorage.
  // No cold-start recovery — if anything is missing, return to /app/new-visit.
  useEffect(() => {
    const session = getSession();
    if (!session) {
      router.replace('/app/login');
      return;
    }
    setDoctor(session.doctor);

    const visitId = searchParams.get('visit');
    if (!visitId) {
      router.replace('/app/new-visit');
      return;
    }

    let pending: PendingVisit | null = null;
    try {
      const raw = sessionStorage.getItem(PENDING_VISIT_KEY);
      if (raw) pending = JSON.parse(raw) as PendingVisit;
    } catch {
      /* malformed — treat as absent */
    }
    if (!pending || pending.consultation_id !== visitId) {
      // Cold start (hard refresh / new tab / laptop sleep): the PendingVisit is
      // gone but the URL still carries ?visit=<id>. Recover from the backend
      // (useColdStartRecovery) instead of bouncing to /app/new-visit.
      sessionStorage.removeItem(PENDING_VISIT_KEY);
      setRecoverVisitId(visitId);
      return;
    }

    setConsultationId(visitId);
    setPendingVisit(pending);   // ← persist patient context so the strip can render
    // If we previously recorded consent on this consultation (and the tab
    // was refreshed), the PendingVisit object carries the timestamp. Seed
    // local state so Gate 1 does not nag the doctor again.
    if (pending.consent_to_record_at) setConsentRecorded(true);

    api.me().catch((err) => {
      if (err instanceof ApiError && err.status === 401) {
        clearSession();
        router.replace('/app/login');
      }
    });
  }, [router, searchParams]);

  // ── Cold-start recovery driver ─────────────────────────────────────────
  // Fires only when the gate above set recoverVisitId (sessionStorage was
  // absent). Fetches consultation + patient and either rebuilds context in
  // place or redirects per status. Inert (phase 'idle') on the happy path.
  const recovery = useColdStartRecovery(recoverVisitId, 'scribe');
  useEffect(() => {
    if (recovery.phase === 'redirect') {
      router.replace(recovery.to);
      return;
    }
    if (recovery.phase === 'recovered') {
      setPendingVisit(recovery.pendingVisit);
      if (recovery.pendingVisit.consent_to_record_at) setConsentRecorded(true);
      if (recovery.status === 'error') {
        // The transcript was persisted by the failing route's catch block, so
        // offer retry-extraction (no re-record) via the recovery panel. If the
        // transcript is gone (e.g. purged, or Soniox never produced one), the
        // retry call returns 409 and the panel routes the doctor to a fresh
        // visit — see RecoveryPanel.
        setRecoverableVisitId(recovery.pendingVisit.consultation_id);
      }
      // ⚠ PhoneMode-safe: consultationId is set EXACTLY ONCE here, after the
      // fetch resolves, and is never reset to null. The async null→defined set
      // is the transition PhoneMode already handles; a null→defined→null flip
      // would re-introduce the documented second-session-mid-QR-scan bug.
      setConsultationId(recovery.pendingVisit.consultation_id);
    }
  }, [recovery, router]);

  // ── Gate 1 — auto-open the modal once we know the consultation and consent
  // is missing. Re-fires only when consultationId or consentRecorded changes,
  // so the modal does not pop back after a successful onConsented.
  useEffect(() => {
    if (!consultationId) return;
    if (consentRecorded) return;
    setConsentModalOpen(true);
  }, [consultationId, consentRecorded]);

  const showToast = useCallback((kind: ToastKind, message: string) => {
    toastIdRef.current += 1;
    setToast({ kind, message, id: toastIdRef.current });
  }, []);

  // Imperative request used by Gate 2. Resolves immediately if consent is
  // already on file; otherwise opens the modal and resolves when the doctor
  // confirms (handleConsented fires the resolver).
  const requestConsent = useCallback((): Promise<void> => {
    if (consentRecorded) return Promise.resolve();
    return new Promise<void>((resolve) => {
      consentResolverRef.current = resolve;
      setConsentModalOpen(true);
    });
  }, [consentRecorded]);

  const handleConsented = useCallback(
    (response: ConsentResponse) => {
      setConsentRecorded(true);
      setConsentModalOpen(false);
      // Persist on the PendingVisit so a refresh in this tab does not re-prompt.
      // The backend keeps the authoritative timestamp; this is a UI hint.
      try {
        const raw = sessionStorage.getItem(PENDING_VISIT_KEY);
        if (raw) {
          const pv = JSON.parse(raw) as PendingVisit;
          pv.consent_to_record_at = response.consent_to_record_at;
          sessionStorage.setItem(PENDING_VISIT_KEY, JSON.stringify(pv));
        }
      } catch {
        /* sessionStorage unavailable — keep in-memory state only */
      }
      // Resolve any pending requestConsent() promise (Gate 2).
      if (consentResolverRef.current) {
        consentResolverRef.current();
        consentResolverRef.current = null;
      }
    },
    []
  );

  const handleConsentError = useCallback(
    (message: string) => showToast('error', message),
    [showToast]
  );

  // A3: route a live processing failure to the recovery panel when we hold a
  // staged consultation id (the backend saves the transcript on a post-Soniox
  // failure, so retry-extraction can resurrect the note without re-recording).
  // The retry call itself is the source of truth for recoverability — if there
  // is nothing to resurrect it returns 409 and the panel offers a fresh visit.
  // Errors without a consultation id (nothing staged) fall through to the plain
  // banner, unchanged.
  const reportProcessingError = useCallback(
    (message: string) => {
      if (consultationId) {
        setError(null);
        setRecoverableVisitId(consultationId);
      } else {
        setError(message);
      }
    },
    [consultationId]
  );

  const onResult = useCallback(
    (result: TranscribeResult) => {
      sessionStorage.setItem(RESULT_STORAGE_KEY, JSON.stringify(result));
      // Carry the consultation id in the URL so a hard refresh / new tab on the
      // result page can cold-start recover (useColdStartRecovery reads ?visit=).
      router.push(`/app/scribe/result?visit=${result.consultationId}`);
    },
    [router]
  );

  // The processing labels are universal pipeline stages (ProcessingView owns
  // them), so this no longer carries per-mode text — it just flips the view.
  const goToProcessing = useCallback(() => {
    setView('processing');
  }, []);

  if (!doctor) {
    return (
      <main
        className="min-h-screen flex items-center justify-center"
        style={{ color: 'var(--color-text-muted)' }}
      >
        Зареждане…
      </main>
    );
  }

  // Cold-start recovery in flight (or about to redirect) — show a splash rather
  // than flashing the empty record UI / consent modal. Happy path: recoverVisitId
  // is null, so this whole branch is skipped.
  if (recoverVisitId && recovery.phase !== 'recovered') {
    return (
      <main
        className="min-h-screen flex items-center justify-center"
        style={{ color: 'var(--color-text-muted)' }}
      >
        Зареждане…
      </main>
    );
  }

  return (
    <AppShell doctor={doctor} sidebarLocked={navLocked}>
      <Stepper steps={SCRIBE_FLOW_STEPS} current={stepperCurrent} />
      {pendingVisit && <PatientHeaderStrip pending={pendingVisit} />}
      {/* U1 — the recording surface fits the viewport with no stray scroll.
          flex-1 + min-h-0 lets this region shrink WITHIN <main>: a flex child
          defaults to min-height:auto, which refuses to shrink below its content
          and pushed the page past 100vh (the sliver of navy / stray scrollbar).
          overflow-y-auto keeps short windows graceful; the inner min-h-full
          column vertically centres the card so it reads as a settled page. */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="min-h-full flex flex-col justify-center px-6 py-6">
        <div className="max-w-2xl mx-auto w-full">
          {recoverableVisitId ? (
            <RecoveryPanel
              visitId={recoverableVisitId}
              onSuccess={(id) => router.push(`/app/scribe/result?visit=${id}`)}
              onRestart={() => router.replace('/app/new-visit')}
            />
          ) : (
          <>
          {error && (
            <ErrorBanner message={error} onClose={() => setError(null)} />
          )}

          {view === 'processing' && <ProcessingView />}

          {/* PhoneMode owns a long-lived WebSocket and the recovery
              (reconnect + slow-poll) path against /api/sessions/:id/status.
              If it unmounts the moment view flips to 'processing', the WS
              is torn down by its useEffect cleanup and the later
              pushToSession({type:'result',…}) lands on a dead socket with
              no listener — the PC stays stuck on "AI анализира" forever
              even though sessions.result is populated. So we render
              PhoneMode whenever mode === 'phone' (across both views) and
              just hide its UI when view !== 'record'. CSS-hide, not
              unmount: keeps the recovery path alive across the
              transition. PcMode has no live socket — its result delivery
              rides on the `await api.transcribe(...)` closure inside
              stopRecording, which survives an unmount — so it stays
              inside the view==='record' block. */}
          {mode === 'phone' && (
            <div style={{ display: view === 'record' ? 'block' : 'none' }}>
              <PhoneMode
                active={mode === 'phone'}
                mode={mode}
                onModeChange={setMode}
                consultationId={consultationId}
                onProcessing={goToProcessing}
                onResult={onResult}
                onError={reportProcessingError}
              />
            </div>
          )}

          {view === 'record' && mode === 'pc' && (
            <PcMode
              mode={mode}
              onModeChange={setMode}
              consultationId={consultationId}
              onRecordingChange={setPcRecording}
              onProcessing={goToProcessing}
              onResult={onResult}
              onError={reportProcessingError}
              onAuthError={() => {
                clearSession();
                router.replace('/app/login');
              }}
              onBackToIdle={() => setView('record')}
              requestConsent={requestConsent}
            />
          )}
          </>
          )}
        </div>
        </div>
      </div>

      {consultationId && (
        <ConsentModal
          consultationId={consultationId}
          open={consentModalOpen}
          onConsented={handleConsented}
          onError={handleConsentError}
        />
      )}
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </AppShell>
  );
}

/* ─────────────────────────────────────────────────────────────── */

function ErrorBanner({
  message,
  onClose,
}: {
  message: string;
  onClose: () => void;
}) {
  return (
    <div
      className="mb-6 px-4 py-3 rounded-md flex items-start justify-between gap-3"
      style={{ background: 'var(--color-danger-soft)', color: 'var(--color-danger)' }}
    >
      <div className="text-sm">{message}</div>
      <button
        onClick={onClose}
        className="text-lg font-bold leading-none focus-ring rounded"
        aria-label="Затвори"
      >
        ×
      </button>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────── */
/* RECOVERY PANEL (A3 — "обработката се провали, звукът е запазен") */
/* ─────────────────────────────────────────────────────────────── */
//
// Shown instead of the record/processing UI when a processing run failed on a
// staged consultation. The primary action re-runs ONLY the Claude extraction
// against the transcript the backend persisted on failure (api.retryExtraction
// → POST /:id/retry-extraction) — the doctor never re-records. The retry call
// is the source of truth for recoverability:
//   • 200  → row flips to 'generated'; navigate to the result page, which
//            re-reads the note from the server via ?visit= (tested cold-start
//            path), so no client-side note shape is assembled here.
//   • 409  → nothing to resurrect (no saved transcript / wrong status) → the
//            only safe path is a fresh visit; the retry button is removed.
//   • 502/network/other → upstream still down; the audio is still safe, so the
//            retry button stays enabled for another attempt.

type RecoveryPhase =
  | { kind: 'idle' }
  | { kind: 'retrying' }
  | { kind: 'temporary'; message: string }
  | { kind: 'no-transcript'; message: string };

function RecoveryPanel({
  visitId,
  onSuccess,
  onRestart,
}: {
  visitId: string;
  onSuccess: (visitId: string) => void;
  onRestart: () => void;
}) {
  const [phase, setPhase] = useState<RecoveryPhase>({ kind: 'idle' });

  const retry = useCallback(async () => {
    setPhase({ kind: 'retrying' });
    try {
      await api.retryExtraction(visitId);
      // Row is now 'generated'. Hand off to the result page; its ?visit=
      // cold-start path fetches the fresh server note.
      onSuccess(visitId);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setPhase({
          kind: 'no-transcript',
          message:
            'Записът не може да бъде възстановен автоматично. Моля, започнете нов преглед.',
        });
        return;
      }
      setPhase({
        kind: 'temporary',
        message:
          'Услугата временно е недостъпна. Звукът ви е запазен — опитайте отново след малко.',
      });
    }
  }, [visitId, onSuccess]);

  const retrying = phase.kind === 'retrying';
  const blocked = phase.kind === 'no-transcript';

  return (
    <div
      className="bg-white rounded-2xl border p-8 sm:p-10 flex flex-col items-center text-center"
      style={{ borderColor: 'var(--color-border)', boxShadow: 'var(--shadow-card)' }}
    >
      {/* U4 — copy is STATE-DRIVEN so it never contradicts the available
          actions. In the terminal (no-transcript) state the only action is
          "Започни нов преглед", so the headline/subtext must NOT promise a
          retry that is gone. */}
      <div
        className="text-xl font-semibold mb-2"
        style={{ color: 'var(--color-danger)' }}
      >
        {blocked ? 'Записът не може да бъде възстановен' : 'Обработката се провали'}
      </div>
      <p className="text-sm max-w-md" style={{ color: 'var(--color-text-muted)' }}>
        {blocked
          ? 'Звукът не е наличен за повторно извличане. Моля, започнете нов преглед.'
          : 'Звукът ви е запазен. Можете да опитате повторно извличане, без да записвате отново.'}
      </p>

      {/* The extra notice box is only the transient "service is down, audio is
          safe, try again" message — the no-transcript case is fully covered by
          the state-driven headline/subtext above (no duplicate line). */}
      {phase.kind === 'temporary' && (
        <div
          className="mt-4 px-4 py-3 rounded-md text-sm"
          style={{ background: 'var(--color-danger-soft)', color: 'var(--color-danger)' }}
        >
          {phase.message}
        </div>
      )}

      <div className="flex flex-wrap gap-3 justify-center mt-6">
        {!blocked && (
          <Button variant="primary" onClick={retry} disabled={retrying}>
            {retrying ? 'Обработва се…' : 'Опитайте отново'}
          </Button>
        )}
        <Button variant="secondary" onClick={onRestart} disabled={retrying}>
          Започни нов преглед
        </Button>
      </div>
    </div>
  );
}

function ModeTabs({
  mode,
  onChange,
  className = '',
}: {
  mode: Mode;
  onChange: (m: Mode) => void;
  className?: string;
}) {
  return (
    <Segmented
      className={className}
      value={mode}
      onChange={onChange}
      options={[
        {
          value: 'pc',
          content: (
            <span className="inline-flex items-center justify-center gap-1.5">
              <Icon name="mic" /> Микрофон
            </span>
          ),
        },
        {
          value: 'phone',
          content: (
            <span className="inline-flex items-center justify-center gap-1.5">
              <Icon name="smartphone" /> Телефон (QR)
            </span>
          ),
        },
      ]}
    />
  );
}

// Calm-clinical card shell shared by the record-mode bodies (PC mic + phone QR):
// a whisper-shadow hairline sheet with a navy NoteSection-consistent header
// (title + subtitle + hairline divider) and the Микрофон/Телефон segmented
// toggle. Purely presentational — no state / lifecycle — so wrapping the
// always-mounted PhoneMode in it never touches the WebSocket recovery path.
function RecordCardShell({
  mode,
  onModeChange,
  children,
}: {
  mode: Mode;
  onModeChange: (m: Mode) => void;
  children: ReactNode;
}) {
  return (
    <div
      className="bg-white rounded-2xl border p-6 sm:p-8"
      style={{ borderColor: 'var(--color-border)', boxShadow: 'var(--shadow-card)' }}
    >
      <div className="mb-5">
        <h1
          className="text-xl font-semibold"
          style={{ color: 'var(--color-heading)', letterSpacing: '-0.01em' }}
        >
          Запис на консултацията
        </h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--color-text-muted)' }}>
          AI слуша и записва. Нищо не напуска ЕС.
        </p>
        <div className="mt-4" style={{ borderBottom: '1px solid var(--color-hairline)' }} />
      </div>
      <ModeTabs mode={mode} onChange={onModeChange} className="max-w-md mx-auto mb-8" />
      {children}
    </div>
  );
}

// U5 — processing loader: an INDETERMINATE indicator paired with staged step
// labels reflecting the real pipeline (Soniox → extraction → drug-safety).
// Deliberately NO fake percentage and NO live ETA — LLM extraction has no
// reliable %/time estimate, and a countdown stalling at "0 сек" erodes trust
// more than none. The stages advance on a typical-timing schedule and the last
// one simply stays active until the result lands; a static "~15–30 сек" hint
// sets expectations without pretending to measure.
const PROCESSING_STEPS = [
  'Транскрибиране…',
  'Структуриране…',
  'Проверка за безопасност…',
];

function ProcessingView() {
  const [active, setActive] = useState(0);
  useEffect(() => {
    const t1 = setTimeout(() => setActive(1), 7000);
    const t2 = setTimeout(() => setActive(2), 16000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  return (
    <div
      role="status"
      aria-live="polite"
      className="bg-white rounded-2xl border p-10 flex flex-col items-center text-center"
      style={{ borderColor: 'var(--color-border)', boxShadow: 'var(--shadow-card)' }}
    >
      <div className="proc-track w-48" aria-hidden>
        <span />
      </div>
      <div
        className="text-lg font-semibold mt-6 mb-4"
        style={{ color: 'var(--color-heading)' }}
      >
        Обработва се…
      </div>
      <ul className="space-y-2.5 text-sm w-full max-w-[15rem] mx-auto text-left">
        {PROCESSING_STEPS.map((label, i) => {
          const done = i < active;
          const current = i === active;
          return (
            <li key={label} className="flex items-center gap-2.5">
              <span aria-hidden className="inline-flex w-4 justify-center">
                {done ? (
                  <Icon name="check" size={16} style={{ color: 'var(--color-ok-strong)' }} />
                ) : current ? (
                  <span className="proc-dot" style={{ background: 'var(--color-accent)' }} />
                ) : (
                  <span className="proc-dot proc-dot--pending" />
                )}
              </span>
              <span
                style={{
                  color: current ? 'var(--color-heading)' : 'var(--color-text-muted)',
                  fontWeight: current ? 600 : 400,
                }}
              >
                {label}
              </span>
            </li>
          );
        })}
      </ul>
      <div className="mt-5 text-xs" style={{ color: 'var(--color-text-muted)' }}>
        Обикновено отнема ~15–30 сек.
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <div
      className="w-10 h-10 rounded-full border-4 animate-spin"
      style={{
        borderColor: 'var(--color-border)',
        borderTopColor: 'var(--color-brand)',
      }}
    />
  );
}

/* ─────────────────────────────────────────────────────────────── */
/* PHONE MODE (QR + WebSocket + polling fallback)                 */
/* ─────────────────────────────────────────────────────────────── */

function PhoneMode({
  active,
  mode,
  onModeChange,
  consultationId,
  onProcessing,
  onResult,
  onError,
}: {
  active: boolean;
  mode: Mode;
  onModeChange: (m: Mode) => void;
  consultationId: string | null;
  onProcessing: () => void;
  onResult: (r: TranscribeResult) => void;
  onError: (msg: string) => void;
}) {
  const [session, setSession] = useState<SessionInit | null>(null);
  const [expiresIn, setExpiresIn] = useState<number>(0);
  const [phoneConnected, setPhoneConnected] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const expiryRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelledRef = useRef(false);

  // Callbacks kept in refs so the init effect can depend ONLY on
  // [active, consultationId, …refs] — parent re-renders that mint a new
  // inline `onProcessing={() => …}` no longer re-fire teardown→createSession.
  const onProcessingRef = useRef(onProcessing);
  const onResultRef     = useRef(onResult);
  const onErrorRef      = useRef(onError);
  useEffect(() => { onProcessingRef.current = onProcessing; }, [onProcessing]);
  useEffect(() => { onResultRef.current     = onResult;     }, [onResult]);
  useEffect(() => { onErrorRef.current      = onError;      }, [onError]);

  // Recovery-path bookkeeping.
  // - sessionIdRef: stable handle for poll calls from any callback.
  // - resolvedRef:  once the round trip has produced a result/error we stop
  //                 reconnecting and stop polling, so a late-arriving WS
  //                 message can't fire onResult twice.
  // - reconnectAttemptsRef: capped reconnect counter (reset on each onopen).
  const sessionIdRef         = useRef<string | null>(null);
  const resolvedRef          = useRef(false);
  const reconnectAttemptsRef = useRef(0);
  // Pending reconnect timer from a prior onclose. Must be clearable by
  // teardown — a timer that fires after init() has reset cancelledRef
  // back to false would otherwise resurrect the dead session's socket.
  const reconnectTimeoutRef  = useRef<ReturnType<typeof setTimeout> | null>(null);

  const teardown = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (expiryRef.current) {
      clearInterval(expiryRef.current);
      expiryRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  // One-shot poll against /status. Returns true if the call resolved the
  // round trip (delivered a result or error to the parent). Safe to call
  // multiple times — resolvedRef guards re-entry.
  const checkForResult = useCallback(async (): Promise<boolean> => {
    const id = sessionIdRef.current;
    if (!id || resolvedRef.current) return false;
    try {
      const d = await api.getSessionStatus(id);
      if (d.status === 'processing') {
        setPhoneConnected(true);
        onProcessingRef.current();
        return false;
      }
      if (d.status === 'done') {
        resolvedRef.current = true;
        onResultRef.current(d.result);
        return true;
      }
      if (d.status === 'error') {
        resolvedRef.current = true;
        onErrorRef.current('Грешка: ' + (d.error_msg || 'неизвестна'));
        return true;
      }
    } catch (e) {
      // Terminal failures — session gone (404), token revoked (401), or
      // expired (410). Stop polling/reconnecting and surface an error so
      // the page does not spin forever. Other failures (transient 5xx /
      // network blips) fall through and the caller retries.
      if (e instanceof ApiError && (e.status === 404 || e.status === 401 || e.status === 410)) {
        resolvedRef.current = true;
        onErrorRef.current('Сесията изтече или не е намерена.');
        return true;
      }
      /* transient — caller will retry via onclose / reconnect path */
    }
    return false;
  }, []);

  // Open (or reopen) the WebSocket for `id`. Used by initial connect and
  // by reconnect attempts triggered from onclose. Every (re)connect runs
  // a poll on open so a result that arrived during a gap can't be lost.
  const openSocket = useCallback((id: string) => {
    const ws = new WebSocket(wsUrl(id));
    wsRef.current = ws;

    ws.onopen = () => {
      reconnectAttemptsRef.current = 0;
      void checkForResult();
    };

    ws.onmessage = (evt) => {
      try {
        const msg: WsMessage = JSON.parse(evt.data);
        if (msg.type === 'processing') {
          setPhoneConnected(true);
          onProcessingRef.current();
        } else if (msg.type === 'result') {
          if (resolvedRef.current) return;
          resolvedRef.current = true;
          onResultRef.current({
            consultationId: msg.consultationId,
            transcript:     msg.transcript,
            fields:         msg.fields,
          });
        } else if (msg.type === 'error') {
          if (resolvedRef.current) return;
          resolvedRef.current = true;
          onErrorRef.current('Грешка при обработка: ' + msg.message);
        }
      } catch {
        /* ignore malformed messages */
      }
    };

    ws.onerror = () => {
      // Handshake-level failure. Don't act here — onclose follows and
      // drives the unified recovery path (poll + reconnect/backoff).
    };

    ws.onclose = () => {
      // cancelledRef MUST be checked first — init()'s reset sequence flips
      // it true around teardown() so the dying socket's onclose short-circuits
      // here and never schedules a reconnect against the dead session.
      if (cancelledRef.current || resolvedRef.current) return;
      // 1) Immediate poll — covers the case where the socket dropped AFTER
      //    pushToSession had already fired (the result row is in the DB).
      void checkForResult().then((done) => {
        if (cancelledRef.current || resolvedRef.current || done) return;
        // 2) Reconnect with capped exponential backoff (~0.5s, 1s, 2s).
        if (reconnectAttemptsRef.current < 3) {
          const delay = 500 * Math.pow(2, reconnectAttemptsRef.current);
          reconnectAttemptsRef.current += 1;
          // Stash the handle so teardown() can clear a pending reconnect
          // before init() resurrects cancelledRef to false. Without this, a
          // timer scheduled by a PRIOR onclose can fire after the new session
          // is live and overwrite wsRef with the dead session's socket.
          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectTimeoutRef.current = null;
            if (cancelledRef.current || resolvedRef.current) return;
            openSocket(id);
          }, delay);
          return;
        }
        // 3) Reconnects exhausted — fall back to slow polling so the page
        //    can still recover whenever the backend finishes.
        if (!pollRef.current) {
          pollRef.current = setInterval(() => {
            void checkForResult().then((d) => {
              if (d && pollRef.current) {
                clearInterval(pollRef.current);
                pollRef.current = null;
              }
            });
          }, 2500);
        }
      });
    };
  }, [checkForResult]);

  useEffect(() => {
    // Hard gate: never create a session until we know the consultationId.
    // Eliminates the null→defined re-run that previously tore down
    // session A and minted session B mid-QR-scan.
    if (!active || !consultationId) {
      teardown();
      setSession(null);
      setPhoneConnected(false);
      sessionIdRef.current         = null;
      resolvedRef.current          = false;
      reconnectAttemptsRef.current = 0;
      return;
    }

    async function init() {
      // init() is the single entry point for a new session — first-time mount
      // via the effect AND timer-driven QR-expiry re-init via tick(). Order
      // is load-bearing — flip cancelledRef BEFORE teardown so the dying
      // socket's onclose (and any reconnect setTimeout the prior session
      // scheduled, now cleared by teardown) short-circuits and cannot
      // schedule work against the dead session. Reset the per-session flags
      // AFTER teardown, then flip cancelledRef back to false — the new
      // session is live from here.
      cancelledRef.current         = true;
      teardown();
      cancelledRef.current         = false;
      resolvedRef.current          = false;
      reconnectAttemptsRef.current = 0;
      try {
        // consultationId is guaranteed non-null inside this branch (gate above).
        const s = await api.createSession({ consultationId: consultationId! });
        if (cancelledRef.current) return;
        setSession(s);
        setPhoneConnected(false);
        sessionIdRef.current = s.sessionId;

        const expiresAt = new Date(s.expiresAt).getTime();
        const tick = () => {
          const left = Math.max(0, Math.round((expiresAt - Date.now()) / 1000));
          setExpiresIn(left);
          if (left === 0) {
            if (expiryRef.current) clearInterval(expiryRef.current);
            setTimeout(() => {
              if (!cancelledRef.current) init();
            }, 1500);
          }
        };
        tick();
        expiryRef.current = setInterval(tick, 1000);

        openSocket(s.sessionId);
      } catch (e) {
        if (!cancelledRef.current) {
          onErrorRef.current(
            'Грешка при създаване на сесия: ' +
              (e instanceof Error ? e.message : 'неизвестна')
          );
        }
      }
    }

    init();

    return () => {
      cancelledRef.current = true;
      teardown();
    };
  }, [active, consultationId, teardown, openSocket]);

  if (phoneConnected) {
    return (
      <RecordCardShell mode={mode} onModeChange={onModeChange}>
        <div className="flex flex-col items-center text-center py-4">
          <Icon
            name="smartphone"
            size={48}
            className="mb-3"
            style={{ color: 'var(--color-brand)' }}
          />
          <div
            className="text-lg font-semibold mb-1"
            style={{ color: 'var(--color-heading)' }}
          >
            Телефонът е свързан
          </div>
          <div
            className="text-sm mb-6"
            style={{ color: 'var(--color-text-muted)' }}
          >
            Говорете — AI слуша
          </div>
          <Spinner />
        </div>
      </RecordCardShell>
    );
  }

  return (
    <RecordCardShell mode={mode} onModeChange={onModeChange}>
      <div className="flex flex-col items-center text-center">
        <div
          className="text-sm mb-4"
          style={{ color: 'var(--color-text-muted)' }}
        >
          Сканирайте с телефона
        </div>
        {session ? (
          <>
            <div
              className="p-3 rounded-lg"
              style={{
                borderColor: 'var(--color-border)',
                borderWidth: 1,
                background: 'white',
              }}
            >
              <QRCodeSVG value={session.mobileUrl} size={188} fgColor="#1C2B44" />
            </div>
            <div
              className="text-xs mt-4"
              style={{ color: 'var(--color-text-muted)' }}
            >
              Насочете камерата на телефона към QR кода.
            </div>
            {expiresIn > 0 && (
              <div
                className="text-xs mt-2 font-[family-name:var(--font-jetbrains)] tabular-nums"
                style={{ color: 'var(--color-text-muted)' }}
              >
                Изтича след {Math.floor(expiresIn / 60)}:
                {String(expiresIn % 60).padStart(2, '0')}
              </div>
            )}
          </>
        ) : (
          <div
            className="text-sm py-12"
            style={{ color: 'var(--color-text-muted)' }}
          >
            Генерира се QR код…
          </div>
        )}
      </div>
    </RecordCardShell>
  );
}

/* ─────────────────────────────────────────────────────────────── */
/* PC MODE (MediaRecorder + WebAudio waveform)                    */
/* ─────────────────────────────────────────────────────────────── */

const WAVE_BARS = 32;

function PcMode({
  mode,
  onModeChange,
  consultationId,
  onRecordingChange,
  onProcessing,
  onResult,
  onError,
  onAuthError,
  onBackToIdle,
  requestConsent,
}: {
  mode: Mode;
  onModeChange: (m: Mode) => void;
  consultationId: string | null;
  /** Bubbles the local recording state up so the page can lock the sidebar. */
  onRecordingChange: (active: boolean) => void;
  onProcessing: () => void;
  onResult: (r: TranscribeResult) => void;
  onError: (msg: string) => void;
  onAuthError: () => void;
  onBackToIdle: () => void;
  /** Gate 2: resolves once consent is on file. PcMode awaits this BEFORE
   *  posting audio so a Gate 1 bypass cannot leak audio to the backend, and
   *  re-invokes it inside the catch block when the backend itself responds
   *  with the missing-consent 403 (defense in depth). */
  requestConsent: () => Promise<void>;
}) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);

  const mrRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const waveWrapRef = useRef<HTMLDivElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const barsRef = useRef<HTMLDivElement[]>([]);

  // Initial bars
  useEffect(() => {
    const wrap = waveWrapRef.current;
    if (!wrap) return;
    wrap.innerHTML = '';
    const bars: HTMLDivElement[] = [];
    for (let i = 0; i < WAVE_BARS; i++) {
      const b = document.createElement('div');
      b.style.width = '3px';
      b.style.height = '4px';
      b.style.background = 'var(--color-brand-mid)';
      b.style.borderRadius = '2px';
      b.style.transition = 'height 0.08s ease-out';
      b.style.opacity = '0.4';
      wrap.appendChild(b);
      bars.push(b);
    }
    barsRef.current = bars;
  }, []);

  const stopWaveform = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    barsRef.current.forEach((b) => {
      b.style.height = '4px';
      b.style.opacity = '0.4';
    });
  }, []);

  const startWaveform = useCallback((stream: MediaStream) => {
    try {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const ctx = new Ctx();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.8;
      src.connect(analyser);
      audioCtxRef.current = ctx;
      analyserRef.current = analyser;

      const data = new Uint8Array(analyser.frequencyBinCount);
      const bars = barsRef.current;
      bars.forEach((b) => (b.style.opacity = '1'));

      const draw = () => {
        rafRef.current = requestAnimationFrame(draw);
        analyser.getByteFrequencyData(data);
        bars.forEach((bar, i) => {
          const idx = Math.floor((i * data.length) / WAVE_BARS);
          const h = Math.max(4, (data[idx] / 255) * 58);
          bar.style.height = h + 'px';
          bar.style.opacity = i > WAVE_BARS * 0.72 ? '0.5' : '1';
        });
      };
      draw();
    } catch {
      /* WebAudio unavailable — silent fail */
    }
  }, []);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.start(500);
      mrRef.current = mr;
      setRecording(true);
      onRecordingChange(true);
      setSeconds(0);
      startWaveform(stream);
      timerRef.current = setInterval(() => {
        setSeconds((s) => s + 1);
      }, 1000);
    } catch (e) {
      onError(
        'Нужен е достъп до микрофон: ' +
          (e instanceof Error ? e.message : 'неизвестна грешка')
      );
    }
  }, [startWaveform, onError, onRecordingChange]);

  const stopRecording = useCallback(async () => {
    if (!mrRef.current) return;
    setRecording(false);
    onRecordingChange(false);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    stopWaveform();

    const mr = mrRef.current;
    const blob: Blob = await new Promise((resolve) => {
      mr.onstop = () =>
        resolve(new Blob(chunksRef.current, { type: mr.mimeType }));
      mr.stop();
      mr.stream.getTracks().forEach((t) => t.stop());
    });
    mrRef.current = null;

    // Gate 2 (pre-submit): await consent BEFORE the audio leaves the browser.
    // If consent is already on file this resolves immediately; otherwise it
    // opens the ConsentModal and resolves once the doctor confirms.
    await requestConsent();

    const submit = (): Promise<TranscribeResult> =>
      api.transcribe(
        blob,
        'audio.webm',
        consultationId ? { consultationId } : undefined,
      );

    try {
      onProcessing();
      const result = await submit();
      onResult(result);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onAuthError();
        return;
      }
      // Gate 2 (post-403 fallback): the backend refused for missing consent
      // despite our pre-submit check (stale tab / multi-tab race / consent
      // wiped server-side). Re-open the SAME modal, then retry once.
      // isMissingConsentError distinguishes this 403 from other 4xx outcomes
      // (e.g. 409 wrong-status, 403 consultation_mismatch) by the Bulgarian
      // "съгласие" stem in the error body — see lib/api.ts for the rule.
      if (isMissingConsentError(err)) {
        try {
          await requestConsent();
          const result = await submit();
          onResult(result);
          return;
        } catch (retryErr) {
          if (retryErr instanceof ApiError && retryErr.status === 401) {
            onAuthError();
            return;
          }
          onBackToIdle();
          onError(
            'Грешка: ' + (retryErr instanceof Error ? retryErr.message : 'неизвестна')
          );
          return;
        }
      }
      onBackToIdle();
      onError(
        'Грешка: ' + (err instanceof Error ? err.message : 'неизвестна')
      );
    }
  }, [stopWaveform, consultationId, onProcessing, onResult, onAuthError, onBackToIdle, onError, onRecordingChange, requestConsent]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      stopWaveform();
      if (mrRef.current && mrRef.current.state !== 'inactive') {
        mrRef.current.stop();
        mrRef.current.stream.getTracks().forEach((t) => t.stop());
        onRecordingChange(false);
      }
    };
  }, [stopWaveform, onRecordingChange]);

  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');

  return (
    <RecordCardShell mode={mode} onModeChange={onModeChange}>
      <div className="flex flex-col items-center text-center">
        {/* Record control — NAVY when idle (calm; red stays reserved for the
            safety alert) and RED while actively recording (a meaningful "live"
            signal). While live, the red-tinted concentric rings breathe with a
            calm pulse (record-ring, hard-stopped under reduced-motion in
            globals.css). onClick + aria UNCHANGED. */}
        <div
          className="relative flex items-center justify-center"
          style={{ width: 176, height: 152 }}
        >
          {recording && (
            <>
              <span
                aria-hidden
                className="record-ring absolute rounded-full"
                style={{ width: 148, height: 148, background: 'var(--color-red-soft)' }}
              />
              <span
                aria-hidden
                className="record-ring record-ring--delay absolute rounded-full"
                style={{ width: 116, height: 116, background: 'var(--color-red-soft)' }}
              />
            </>
          )}
          <button
            onClick={recording ? stopRecording : startRecording}
            className="relative w-24 h-24 rounded-full flex items-center justify-center transition hover:opacity-90 focus-ring"
            style={{
              background: recording ? 'var(--color-red)' : 'var(--gradient-brand)',
              boxShadow: recording
                ? '0 8px 24px rgba(192, 57, 43, 0.30)'
                : '0 4px 14px rgba(39, 76, 119, 0.22)',
            }}
            aria-label={recording ? 'Стоп запис' : 'Започни запис'}
          >
            {recording ? (
              <svg viewBox="0 0 24 24" width="30" height="30" fill="white">
                <path d="M6 6h12v12H6z" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="34" height="34" fill="white">
                <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm6-3c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
              </svg>
            )}
          </button>
        </div>

        {/* Timer — navy, tabular, mono (mono is reserved for the scribe timer). */}
        <div
          className="text-4xl font-[family-name:var(--font-jetbrains)] tabular-nums"
          style={{ color: 'var(--color-heading)' }}
        >
          {recording ? `${mm}:${ss}` : '00:00'}
        </div>

        {/* Status — soft-green "На запис" pill while recording, else a hint. */}
        {recording ? (
          <div
            className="mt-3 inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm font-medium"
            style={{ background: 'var(--color-ok-soft)', color: 'var(--color-ok-strong)' }}
          >
            <span
              aria-hidden
              className="inline-block w-2 h-2 rounded-full"
              style={{ background: 'var(--color-ok)' }}
            />
            На запис · AI слуша
          </div>
        ) : (
          <div className="mt-3 text-sm" style={{ color: 'var(--color-text-muted)' }}>
            Натиснете за запис
          </div>
        )}

        {/* Waveform — bars are created + animated by the effects above; the ref
            and height stay untouched so the WebAudio recording path is intact. */}
        <div
          ref={waveWrapRef}
          className="flex items-end justify-center gap-1 mt-6"
          style={{ height: '64px' }}
        />

        {/* Stop & process — the accent CTA. Same stop+submit as the red control. */}
        {recording && (
          <div className="mt-6 w-full flex justify-center">
            <Button variant="primary" onClick={stopRecording} className="px-6">
              <Icon name="check" /> Спри и обработи
            </Button>
          </div>
        )}
      </div>
    </RecordCardShell>
  );
}
