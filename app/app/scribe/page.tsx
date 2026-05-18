'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
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
  const [procMain, setProcMain] = useState('Обработва се...');
  const [procSub, setProcSub] = useState('Моля изчакайте');
  const [consultationId, setConsultationId] = useState<string | null>(null);
  const [pendingVisit, setPendingVisit] = useState<PendingVisit | null>(null);
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
      sessionStorage.removeItem(PENDING_VISIT_KEY);
      router.replace('/app/new-visit');
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

  const onResult = useCallback(
    (result: TranscribeResult) => {
      sessionStorage.setItem(RESULT_STORAGE_KEY, JSON.stringify(result));
      router.push('/app/scribe/result');
    },
    [router]
  );

  const goToProcessing = useCallback((main: string, sub: string) => {
    setProcMain(main);
    setProcSub(sub);
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

  return (
    <AppShell doctor={doctor} sidebarLocked={navLocked}>
      <Stepper steps={SCRIBE_FLOW_STEPS} current={stepperCurrent} />
      {pendingVisit && <PatientHeaderStrip pending={pendingVisit} />}
      <div className="flex-1 px-6 py-8">
        <div className="max-w-2xl mx-auto">
          {error && (
            <ErrorBanner message={error} onClose={() => setError(null)} />
          )}

          {view === 'processing' && (
            <ProcessingView main={procMain} sub={procSub} />
          )}

          {view === 'record' && (
            <>
              <ModeTabs mode={mode} onChange={setMode} />

              {mode === 'phone' && (
                <PhoneMode
                  active={mode === 'phone'}
                  consultationId={consultationId}
                  onProcessing={() =>
                    goToProcessing('AI анализира...', 'Транскрипция и извличане')
                  }
                  onResult={onResult}
                  onError={setError}
                />
              )}

              {mode === 'pc' && (
                <PcMode
                  consultationId={consultationId}
                  onRecordingChange={setPcRecording}
                  onProcessing={() =>
                    goToProcessing('Транскрипция...', 'Изпраща се аудиото')
                  }
                  onResult={onResult}
                  onError={setError}
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
        className="text-lg font-bold leading-none"
        aria-label="Затвори"
      >
        ×
      </button>
    </div>
  );
}

function ModeTabs({
  mode,
  onChange,
}: {
  mode: Mode;
  onChange: (m: Mode) => void;
}) {
  return (
    <div className="flex gap-2 mb-6">
      <TabBtn active={mode === 'phone'} onClick={() => onChange('phone')}>
        📱 Телефон (QR)
      </TabBtn>
      <TabBtn active={mode === 'pc'} onClick={() => onChange('pc')}>
        🎙 Микрофон на компютъра
      </TabBtn>
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="flex-1 px-4 py-2 rounded-md text-sm font-medium transition"
      style={{
        background: active ? 'var(--color-brand)' : 'var(--color-bg-card)',
        color: active ? 'white' : 'var(--color-text-muted)',
        borderColor: 'var(--color-border)',
        borderWidth: 1,
      }}
    >
      {children}
    </button>
  );
}

function ProcessingView({ main, sub }: { main: string; sub: string }) {
  return (
    <div
      className="bg-white rounded-2xl border p-16 flex flex-col items-center text-center"
      style={{ borderColor: 'var(--color-border)' }}
    >
      <Spinner />
      <div
        className="text-xl font-medium mt-6 mb-2"
        style={{ color: 'var(--color-brand)' }}
      >
        {main}
      </div>
      <div className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
        {sub}
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
  consultationId,
  onProcessing,
  onResult,
  onError,
}: {
  active: boolean;
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
  }, []);

  useEffect(() => {
    if (!active) {
      teardown();
      setSession(null);
      setPhoneConnected(false);
      return;
    }

    cancelledRef.current = false;

    async function init() {
      teardown();
      try {
        const s = await api.createSession(consultationId ? { consultationId } : undefined);
        if (cancelledRef.current) return;
        setSession(s);
        setPhoneConnected(false);

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

        // Open WebSocket
        const ws = new WebSocket(wsUrl(s.sessionId));
        wsRef.current = ws;

        ws.onmessage = (evt) => {
          try {
            const msg: WsMessage = JSON.parse(evt.data);
            if (msg.type === 'processing') {
              setPhoneConnected(true);
              onProcessing();
            } else if (msg.type === 'result') {
              onResult({
                consultationId: msg.consultationId,
                transcript: msg.transcript,
                fields: msg.fields,
              });
            } else if (msg.type === 'error') {
              onError('Грешка при обработка: ' + msg.message);
            }
          } catch {
            /* ignore malformed messages */
          }
        };

        ws.onerror = () => {
          // Fall back to polling
          if (pollRef.current) return;
          pollRef.current = setInterval(async () => {
            try {
              const d = await api.getSessionStatus(s.sessionId);
              if (d.status === 'processing') {
                setPhoneConnected(true);
                onProcessing();
              } else if (d.status === 'done') {
                if (pollRef.current) {
                  clearInterval(pollRef.current);
                  pollRef.current = null;
                }
                onResult(d.result);
              } else if (d.status === 'error') {
                if (pollRef.current) {
                  clearInterval(pollRef.current);
                  pollRef.current = null;
                }
                onError('Грешка: ' + (d.error_msg || 'неизвестна'));
              }
            } catch {
              /* network blip, keep polling */
            }
          }, 2500);
        };
      } catch (e) {
        if (!cancelledRef.current) {
          onError(
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
  }, [active, consultationId, onProcessing, onResult, onError, teardown]);

  if (phoneConnected) {
    return (
      <div
        className="bg-white rounded-2xl border p-12 flex flex-col items-center text-center"
        style={{ borderColor: 'var(--color-border)' }}
      >
        <div className="text-5xl mb-3">📱</div>
        <div
          className="text-lg font-medium mb-1"
          style={{ color: 'var(--color-brand)' }}
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
    );
  }

  return (
    <div
      className="bg-white rounded-2xl border p-10 flex flex-col items-center text-center"
      style={{ borderColor: 'var(--color-border)' }}
    >
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
              className="text-xs mt-2 font-[family-name:var(--font-jetbrains)]"
              style={{ color: 'var(--color-text-hint)' }}
            >
              Изтича след {Math.floor(expiresIn / 60)}:
              {String(expiresIn % 60).padStart(2, '0')}
            </div>
          )}
        </>
      ) : (
        <div
          className="text-sm py-12"
          style={{ color: 'var(--color-text-hint)' }}
        >
          Генерира се QR код…
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────── */
/* PC MODE (MediaRecorder + WebAudio waveform)                    */
/* ─────────────────────────────────────────────────────────────── */

const WAVE_BARS = 32;

function PcMode({
  consultationId,
  onRecordingChange,
  onProcessing,
  onResult,
  onError,
  onAuthError,
  onBackToIdle,
  requestConsent,
}: {
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
    <div
      className="bg-white rounded-2xl border p-10 flex flex-col items-center"
      style={{ borderColor: 'var(--color-border)' }}
    >
      <div
        className="text-sm mb-6"
        style={{ color: 'var(--color-text-muted)' }}
      >
        Запис от микрофон
      </div>

      <div
        ref={waveWrapRef}
        className="flex items-end gap-1 mb-8"
        style={{ height: '64px' }}
      />

      <button
        onClick={recording ? stopRecording : startRecording}
        className="w-20 h-20 rounded-full flex items-center justify-center transition hover:opacity-90 shadow-lg"
        style={{
          background: recording
            ? 'var(--color-red)'
            : 'var(--gradient-brand)',
        }}
        aria-label={recording ? 'Стоп запис' : 'Започни запис'}
      >
        {recording ? (
          <svg viewBox="0 0 24 24" width="28" height="28" fill="white">
            <path d="M6 6h12v12H6z" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="32" height="32" fill="white">
            <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm6-3c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
          </svg>
        )}
      </button>

      <div
        className="mt-5 text-2xl font-[family-name:var(--font-jetbrains)]"
        style={{
          color: recording
            ? 'var(--color-red)'
            : 'var(--color-text-muted)',
        }}
      >
        {recording ? `${mm}:${ss}` : '00:00'}
      </div>
      <div
        className="mt-2 text-sm"
        style={{ color: 'var(--color-text-muted)' }}
      >
        {recording ? 'Записва се — натиснете за стоп' : 'Натиснете за запис'}
      </div>
    </div>
  );
}
