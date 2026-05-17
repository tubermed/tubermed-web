'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import AppShell from '@/components/AppShell';
import Stepper from '@/components/Stepper';
import { SCRIBE_FLOW_STEPS } from '@/lib/flow';
import EditableField from '@/components/EditableField';
import MkbPicker from '@/components/MkbPicker';
import MedsPanel from '@/components/MedsPanel';
import PatientHeaderStrip from '@/components/PatientHeaderStrip';
import Toast, { type ToastData, type ToastKind } from '@/components/Toast';
import { api, ApiError, getSession } from '@/lib/api';
import type { DoctorInfo } from '@/lib/api';
import type {
  TranscribeResult,
  TranscribeFields,
  ComorbidDiagnosis,
  Medication,
  PendingVisit,
} from '@/lib/types';
import { checkDrugSafety, type SafetyAlert } from '@/lib/drug-safety';
import { loadMkb, getMkbDataSync, findByCode } from '@/lib/mkb10';
import { loadIal } from '@/lib/ial-meds';
import { findHighlights, type HighlightMatch } from '@/lib/vital-rules';
import {
  formatPlainText,
  copyToClipboard,
  generatePdfHtml,
  openPdfPreview,
  generateWordHtml,
  downloadWord,
} from '@/lib/exporters';

const RESULT_STORAGE_KEY  = 'tuber_last_result';
const PENDING_VISIT_KEY   = 'tuber_pending_visit';

type ReviewStatus = 'pending' | 'confirmed';

interface NavItem {
  id: string;
  label: string;
  indent?: boolean;
  scrollMode?: 'section' | 'top';
}

const NAV_ITEMS: NavItem[] = [
  { id: 'sec-diag', label: 'Диагнози МКБ-10' },
  { id: 'sec-anamneza', label: 'Анамнеза' },
  { id: 'sec-obektivno', label: 'Обективен статус' },
  { id: 'sec-izsledvania', label: 'Изследвания' },
  { id: 'sec-terapia', label: 'Терапия' },
  { id: 'sec-meds-panel', label: 'Медикаменти', scrollMode: 'top' },
  { id: 'sec-izdadeni', label: 'Издадени документи' },
  { id: 'sec-napravlenia', label: 'Направления', indent: true },
  { id: 'sec-naznacheni', label: 'Назначени изследвания', indent: true },
];

type MkbTarget = { kind: 'osnovna' } | { kind: 'co'; index: number };

export default function ResultPage() {
  const router = useRouter();
  const [doctor, setDoctor] = useState<DoctorInfo | null>(null);
  const [pendingVisit, setPendingVisit] = useState<PendingVisit | null>(null);
  const [original, setOriginal] = useState<TranscribeResult | null>(null);
  const [fields, setFields] = useState<TranscribeFields>({});
  const [reviewStatus, setReviewStatus] = useState<ReviewStatus>('pending');
  const [reviewPopupOpen, setReviewPopupOpen] = useState(false);
  const [activeNav, setActiveNav] = useState<string>('sec-diag');
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [mkbOpen, setMkbOpen] = useState(false);
  const [mkbTarget, setMkbTarget] = useState<MkbTarget | null>(null);
  const [lastRemovedMedName, setLastRemovedMedName] = useState<string | null>(
    null
  );
  const [toast, setToast] = useState<ToastData | null>(null);
  const toastIdRef = useRef(0);

  const editTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingEditField = useRef<string | null>(null);
  const isLocked = reviewStatus !== 'confirmed';

  // ── Bootstrap ────────────────────────────────────────────────
  useEffect(() => {
    const session = getSession();
    if (!session) {
      router.replace('/app/login');
      return;
    }
    setDoctor(session.doctor);

    const raw = sessionStorage.getItem(RESULT_STORAGE_KEY);
    if (!raw) {
      router.replace('/app/scribe');
      return;
    }
    try {
      const parsed = JSON.parse(raw) as TranscribeResult;
      setOriginal(parsed);
      setFields({ ...parsed.fields });
    } catch {
      router.replace('/app/scribe');
    }

    // Optional patient context (present when the recording came from /app/new-visit).
    // Legacy recordings won't have it — render falls back gracefully.
    try {
      const pv = sessionStorage.getItem(PENDING_VISIT_KEY);
      if (pv) setPendingVisit(JSON.parse(pv) as PendingVisit);
    } catch {
      /* malformed — render without patient header */
    }
  }, [router]);

  // Pre-load MKB-10 data so the bidirectional sync works immediately
  // (and so the picker is instant on first open). Silent failure — picker
  // will retry if needed.
  useEffect(() => {
    loadMkb().catch(() => {});
    loadIal().catch(() => {});
  }, []);

  // ── Edit tracking (debounced) ─────────────────────────────────
  const flushEdit = useCallback(() => {
    if (!original) return;
    // Send the edited field name for analytics + the full fields object
    // for backend data sync.
    const field = pendingEditField.current ?? undefined;
    api.editConsultation(original.consultationId, field, fields).catch((err) => {
      if (err instanceof ApiError) {
        console.warn('[edit-track] ' + err.status + ' ' + err.message);
      }
    });
    pendingEditField.current = null;
  }, [original]);

  const trackEdit = useCallback(
    (fieldKey: string) => {
      pendingEditField.current = fieldKey;
      if (editTimerRef.current) clearTimeout(editTimerRef.current);
      editTimerRef.current = setTimeout(flushEdit, 1500);
      if (reviewStatus === 'confirmed') setReviewStatus('pending');
    },
    [flushEdit, reviewStatus]
  );

  useEffect(() => {
    return () => {
      if (editTimerRef.current) clearTimeout(editTimerRef.current);
    };
  }, []);

  // ── Field updaters ───────────────────────────────────────────
  const updateField = useCallback(
    <K extends keyof TranscribeFields>(key: K, next: TranscribeFields[K]) => {
      setFields((prev) => ({ ...prev, [key]: next }));
      trackEdit(String(key));
    },
    [trackEdit]
  );

  // Bidirectional sync helpers: when the doctor types a known МКБ code,
  // auto-fill the diagnosis name; when they type an exact diagnosis name,
  // auto-fill the code. Only triggers on exact match — partial / paraphrased
  // input leaves the other field alone.
  function diagFromCode(code: string): string | null {
    const data = getMkbDataSync();
    if (!data) return null;
    const m = findByCode(data, code.trim().toUpperCase());
    return m ? m[1] : null;
  }
  function codeFromDiag(diag: string): string | null {
    const data = getMkbDataSync();
    if (!data) return null;
    const q = diag.trim().toLowerCase();
    if (!q) return null;
    const m = data.find((r) => r[1].toLowerCase() === q);
    return m ? m[0] : null;
  }

  const updateOsnovnaMkb = useCallback(
    (v: string) => {
      const term = diagFromCode(v);
      setFields((prev) => ({
        ...prev,
        osnovna_mkb: v,
        ...(term ? { osnovna_diagnoza: term } : {}),
      }));
      trackEdit('osnovna_mkb');
    },
    [trackEdit]
  );

  const updateOsnovnaDiagnoza = useCallback(
    (v: string) => {
      const code = codeFromDiag(v);
      setFields((prev) => ({
        ...prev,
        osnovna_diagnoza: v,
        ...(code ? { osnovna_mkb: code } : {}),
      }));
      trackEdit('osnovna_diagnoza');
    },
    [trackEdit]
  );

  const updateCoField = useCallback(
    (idx: number, key: 'diagnoza' | 'mkb', v: string) => {
      setFields((prev) => {
        const co = (prev.pridruzhavashti || []).slice();
        const current = co[idx] || { diagnoza: '', mkb: '' };
        const next = { ...current, [key]: v };
        if (key === 'mkb') {
          const term = diagFromCode(v);
          if (term) next.diagnoza = term;
        } else {
          const code = codeFromDiag(v);
          if (code) next.mkb = code;
        }
        co[idx] = next;
        return { ...prev, pridruzhavashti: co };
      });
      trackEdit('pridruzhavashti');
    },
    [trackEdit]
  );

  // ── Meds change — detect removals to drive therapy hint ──────
  const onMedsChange = useCallback(
    (next: Medication[]) => {
      const before = fields.medications_list || [];
      if (next.length < before.length) {
        const nextNames = new Set(next.map((m) => m.inn));
        const removed = before.find((b) => !nextNames.has(b.inn));
        if (removed) setLastRemovedMedName(removed.inn);
      }
      updateField('medications_list', next);
    },
    [fields.medications_list, updateField]
  );

  // ── Safety alerts (derived from fields) ──────────────────────
  const safetyAlerts = useMemo(() => checkDrugSafety(fields), [fields]);
  const criticals = useMemo(
    () => safetyAlerts.filter((a) => a.severity === 'critical'),
    [safetyAlerts]
  );
  const warnings = useMemo(
    () => safetyAlerts.filter((a) => a.severity === 'warning'),
    [safetyAlerts]
  );

  // ── Vital-sign review counter ─────────────────────────────────
  // Scan the free-text clinical fields for highlights (vitals out of range
  // + uncertain transcription markers). Each entry: span + field key.
  // Acknowledged spans (doctor clicked "Потвърди") are filtered out so the
  // counter reflects only items still needing review.
  const [acknowledged, setAcknowledged] = useState<Set<string>>(
    () => new Set()
  );

  const acknowledgeSpan = useCallback(
    (fieldKey: string, raw: string) => {
      setAcknowledged((prev) => {
        const next = new Set(prev);
        next.add(`${fieldKey}::${raw}`);
        return next;
      });
    },
    []
  );

  const reviewItems = useMemo(() => {
    const fieldsToScan: Array<keyof TranscribeFields> = [
      'anamneza',
      'obektivno',
      'izsledvania',
      'terapia',
    ];
    const items: Array<
      HighlightMatch & { fieldKey: string; localIdx: number }
    > = [];
    for (const fk of fieldsToScan) {
      const text = (fields[fk] as string) || '';
      const matches = findHighlights(text);
      // Match EditableField's filter: skip acknowledged. localIdx counts
      // only visible (non-acknowledged) matches so DOM ids line up.
      let visibleIdx = 0;
      for (const m of matches) {
        if (acknowledged.has(`${String(fk)}::${m.raw}`)) continue;
        items.push({ ...m, fieldKey: String(fk), localIdx: visibleIdx });
        visibleIdx++;
      }
    }
    return items;
  }, [
    fields.anamneza,
    fields.obektivno,
    fields.izsledvania,
    fields.terapia,
    acknowledged,
  ]);

  const [reviewCursor, setReviewCursor] = useState(0);

  // Clamp cursor when the items list shrinks (e.g. doctor edited out a vital)
  useEffect(() => {
    if (reviewCursor >= reviewItems.length && reviewItems.length > 0) {
      setReviewCursor(0);
    }
  }, [reviewItems.length, reviewCursor]);

  const goToNextReview = useCallback(() => {
    if (reviewItems.length === 0) return;
    const idx = reviewCursor % reviewItems.length;
    const item = reviewItems[idx];
    const spanId = `vital-${item.fieldKey}-${item.localIdx}`;
    const el = document.getElementById(spanId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('flash-review');
      setTimeout(() => el.classList.remove('flash-review'), 1500);
    } else {
      // Fallback — scroll to the section the span lives in
      const sectEl = document.getElementById(`sec-${item.fieldKey}`);
      if (sectEl)
        sectEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    setReviewCursor(idx + 1);
  }, [reviewItems, reviewCursor]);

  // Auto-dismiss therapy hint when name no longer in terapia text
  useEffect(() => {
    if (!lastRemovedMedName) return;
    const text = (fields.terapia || '').toLowerCase();
    if (!text.includes(lastRemovedMedName.toLowerCase())) {
      setLastRemovedMedName(null);
    }
  }, [fields.terapia, lastRemovedMedName]);

  // ── Navigation: click to scroll ──────────────────────────────
  const navTo = useCallback((item: NavItem) => {
    setActiveNav(item.id);
    if (item.scrollMode === 'top') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    const el = document.getElementById(item.id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  // ── Active-section observer (sync on scroll) ─────────────────
  useEffect(() => {
    if (!original) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort(
            (a, b) => a.boundingClientRect.top - b.boundingClientRect.top
          );
        if (visible.length > 0) setActiveNav(visible[0].target.id);
      },
      { rootMargin: '-120px 0px -60% 0px', threshold: 0 }
    );
    NAV_ITEMS.forEach((item) => {
      if (item.scrollMode === 'top') return;
      const el = document.getElementById(item.id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [original, fields.napravlenia, fields.naznacheni]);

  // ── Review status flow ───────────────────────────────────────
  const confirmReview = useCallback(() => {
    setReviewStatus('confirmed');
    setReviewPopupOpen(false);
  }, []);

  // ── MKB picker handlers ──────────────────────────────────────
  const openMkbPicker = useCallback((target: MkbTarget) => {
    setMkbTarget(target);
    setMkbOpen(true);
  }, []);

  const closeMkbPicker = useCallback(() => {
    setMkbOpen(false);
    setMkbTarget(null);
  }, []);

  // Always overwrite both code AND diagnosis name when picking from MKB.
  // This makes the picker the source of truth — picking a different code
  // means you wanted to change the diagnosis, not keep stale text.
  const pickMkb = useCallback(
    (code: string, term: string) => {
      if (!mkbTarget) return;
      if (mkbTarget.kind === 'osnovna') {
        setFields((prev) => ({
          ...prev,
          osnovna_mkb: code,
          osnovna_diagnoza: term,
        }));
        trackEdit('osnovna_mkb');
      } else {
        const idx = mkbTarget.index;
        setFields((prev) => {
          const co = (prev.pridruzhavashti || []).map((d, i) =>
            i === idx ? { mkb: code, diagnoza: term } : d
          );
          return { ...prev, pridruzhavashti: co };
        });
        trackEdit('pridruzhavashti');
      }
    },
    [mkbTarget, trackEdit]
  );

  // ── Toast helper ─────────────────────────────────────────────
  const showToast = useCallback((kind: ToastKind, message: string) => {
    toastIdRef.current += 1;
    setToast({ kind, message, id: toastIdRef.current });
  }, []);

  // ── Export handlers ──────────────────────────────────────────
  const handleCopy = useCallback(async () => {
    if (isLocked) return;
    const text = formatPlainText(fields);
    const ok = await copyToClipboard(text);
    if (ok) {
      showToast('success', '✓ Копирано в клипборда');
    } else {
      showToast('error', 'Копирането не е възможно в този браузър');
    }
  }, [fields, isLocked, showToast]);

  const handlePdf = useCallback(() => {
    if (isLocked) return;
    const dateStr = new Date().toLocaleDateString('bg-BG', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
    const html = generatePdfHtml(fields, dateStr);
    const opened = openPdfPreview(html);
    if (opened) {
      showToast('success', '✓ Преглед отворен — Запази като PDF от бутона');
    } else {
      showToast(
        'error',
        'Изскачащият прозорец е блокиран — разрешете го за този сайт'
      );
    }
  }, [fields, isLocked, showToast]);

  const handleWord = useCallback(() => {
    if (isLocked) return;
    const dateStr = new Date().toLocaleDateString('bg-BG', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
    const html = generateWordHtml(fields, dateStr);
    const filename =
      'ambulatoren-list-' +
      new Date().toISOString().slice(0, 10) +
      '.doc';
    try {
      downloadWord(html, filename);
      showToast('success', '✓ Word файлът е свален');
    } catch {
      showToast('error', 'Грешка при генериране на Word файла');
    }
  }, [fields, isLocked, showToast]);

  const handlePrint = useCallback(() => {
    if (isLocked) return;
    const dateStr = new Date().toLocaleDateString('bg-BG', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
    const html = generatePdfHtml(fields, dateStr);
    const opened = openPdfPreview(html, { autoPrint: true });
    if (!opened) {
      showToast(
        'error',
        'Изскачащият прозорец е блокиран — разрешете го за този сайт'
      );
    }
  }, [fields, isLocked, showToast]);

  // ── Visible-section bookkeeping ──────────────────────────────
  const visibleSections = useMemo(() => {
    const v: Record<string, boolean> = {};
    v['sec-diag'] = true;
    v['sec-anamneza'] = true;
    v['sec-obektivno'] = true;
    v['sec-izsledvania'] = true;
    v['sec-terapia'] = true;
    v['sec-meds-panel'] = true;
    const hasNap = !!(fields.napravlenia && fields.napravlenia.trim());
    const hasNaz = !!(fields.naznacheni && fields.naznacheni.trim());
    v['sec-izdadeni'] = hasNap || hasNaz;
    v['sec-napravlenia'] = hasNap;
    v['sec-naznacheni'] = hasNaz;
    return v;
  }, [fields.napravlenia, fields.naznacheni]);

  if (!doctor || !original) {
    return (
      <main
        className="min-h-screen flex items-center justify-center"
        style={{ color: 'var(--color-text-muted)' }}
      >
        Зареждане…
      </main>
    );
  }

  const todayBg = new Date().toLocaleDateString('bg-BG', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  return (
    <AppShell doctor={doctor}>
      <Stepper steps={SCRIBE_FLOW_STEPS} current={3} />

      {pendingVisit && <PatientHeaderStrip pending={pendingVisit} />}

      {/* Critical safety banner — full width */}
      {criticals.length > 0 && (
        <div
          className="px-6 py-4 border-b no-print"
          style={{ background: 'var(--color-danger-soft)', borderColor: 'var(--color-danger)' }}
        >
          <div className="max-w-6xl mx-auto">
            <div
              className="text-sm font-bold uppercase tracking-wider mb-2"
              style={{ color: 'var(--color-red)' }}
            >
              🚨 Внимание — Проверка за безопасност
            </div>
            <div className="space-y-2">
              {criticals.map((a, i) => (
                <CriticalChip key={i} alert={a} />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Top action bar */}
      <div
        className="px-6 py-3 border-b flex items-center justify-between gap-4 flex-wrap no-print"
        style={{
          background: 'var(--color-bg-card)',
          borderColor: 'var(--color-border)',
        }}
      >
        <StatusBadge
          status={reviewStatus}
          popupOpen={reviewPopupOpen}
          onClick={() => setReviewPopupOpen((o) => !o)}
          onConfirm={confirmReview}
          onDismiss={() => setReviewPopupOpen(false)}
        />
        {reviewItems.length > 0 && (
          <ReviewCounter
            total={reviewItems.length}
            cursor={reviewCursor}
            onNext={goToNextReview}
          />
        )}
        <div className="flex items-center gap-2">
          <TopbarBtn
            locked={isLocked}
            disabled={isLocked}
            onClick={handlePdf}
            label="⬇ PDF"
            lockedHint="Първо потвърдете прегледа"
          />
          <TopbarBtn
            locked={isLocked}
            disabled={isLocked}
            onClick={handleWord}
            label="⬇ Word"
            lockedHint="Първо потвърдете прегледа"
          />
          <TopbarBtn
            locked={isLocked}
            disabled={isLocked}
            onClick={handleCopy}
            label="⎘ Копирай"
            lockedHint="Първо потвърдете прегледа"
          />
          <TopbarBtn
            locked={isLocked}
            disabled={isLocked}
            onClick={handlePrint}
            label="⎙ Печат"
            lockedHint="Първо потвърдете прегледа"
          />
        </div>
      </div>

      {/* 3-column grid */}
      <div className="result-grid flex-1">
        {/* ─── Left: section nav ─── */}
        <aside className="no-print">
          <div className="sticky top-[88px]">
            <div
              className="text-xs uppercase tracking-wider mb-3 font-medium"
              style={{ color: 'var(--color-text-hint)' }}
            >
              Раздели
            </div>
            <nav className="flex flex-col gap-0.5">
              {NAV_ITEMS.map((item) => {
                if (!visibleSections[item.id]) return null;
                const isActive = activeNav === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => navTo(item)}
                    className="flex items-center gap-2 px-3 py-2 rounded-md text-left transition-colors"
                    style={{
                      paddingLeft: item.indent ? '28px' : '12px',
                      fontSize: item.indent ? '13px' : '14px',
                      color: isActive
                        ? 'var(--color-brand)'
                        : 'var(--color-text-muted)',
                      background: isActive
                        ? 'var(--color-brand-soft)'
                        : 'transparent',
                      fontWeight: isActive ? 600 : 500,
                    }}
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full flex-shrink-0 transition-colors"
                      style={{
                        background: isActive
                          ? 'var(--color-brand)'
                          : 'var(--color-border-mid)',
                      }}
                    />
                    {item.label}
                  </button>
                );
              })}
            </nav>

            <div
              className="mt-6 pt-4 border-t"
              style={{ borderColor: 'var(--color-border)' }}
            >
              <div
                className="text-xs uppercase tracking-wider mb-2 font-medium"
                style={{ color: 'var(--color-text-hint)' }}
              >
                Шаблон
              </div>
              <select
                className="w-full px-2 py-1.5 rounded text-sm border"
                style={{
                  borderColor: 'var(--color-border-mid)',
                  background: 'white',
                }}
                disabled
                defaultValue="общ"
              >
                <option value="общ">Общ преглед — SOAP</option>
                <option value="кардио">Кардиологичен SOAP</option>
                <option value="пед">Педиатричен преглед</option>
              </select>
            </div>
          </div>
        </aside>

        {/* ─── Center: document ─── */}
        <main className="min-w-0">
          {/* Transcript collapsible */}
          <details
            className="mb-4 no-print"
            open={transcriptOpen}
            onToggle={(e) =>
              setTranscriptOpen(
                (e.currentTarget as HTMLDetailsElement).open
              )
            }
          >
            <summary
              className="cursor-pointer text-sm font-medium px-3 py-2 rounded-md inline-block"
              style={{
                background: 'var(--color-bg-card)',
                color: 'var(--color-text-muted)',
                borderColor: 'var(--color-border)',
                borderWidth: 1,
              }}
            >
              Транскрипт на консултацията
            </summary>
            <div
              className="mt-2 p-4 rounded-md text-sm leading-relaxed whitespace-pre-wrap"
              style={{
                background: 'var(--color-bg-card)',
                color: 'var(--color-text-muted)',
                borderColor: 'var(--color-border)',
                borderWidth: 1,
              }}
            >
              {original.transcript || (
                <em style={{ color: 'var(--color-text-hint)' }}>
                  Транскриптът е празен.
                </em>
              )}
            </div>
          </details>

          {/* Document header */}
          <div
            className="bg-white rounded-2xl border p-8 mb-4 flex items-baseline justify-between flex-wrap gap-4"
            style={{ borderColor: 'var(--color-border)' }}
          >
            <h1
              className="text-3xl font-semibold"
              style={{ color: 'var(--color-ink)', letterSpacing: '-0.01em' }}
            >
              Амбулаторен лист
            </h1>
            <div
              className="text-sm font-[family-name:var(--font-jetbrains)]"
              style={{ color: 'var(--color-text-muted)' }}
            >
              {todayBg}
            </div>
          </div>

          <div className="space-y-4">
            <DiagnosesSection
              osnovnaDiagnoza={fields.osnovna_diagnoza || ''}
              osnovnaMkb={fields.osnovna_mkb || ''}
              pridruzhavashti={fields.pridruzhavashti || []}
              onOsnovnaDiagnozaChange={updateOsnovnaDiagnoza}
              onOsnovnaMkbChange={updateOsnovnaMkb}
              onPridruzhavashtiChange={(v) =>
                updateField('pridruzhavashti', v)
              }
              onCoFieldChange={updateCoField}
              onOpenMkbForOsnovna={() => openMkbPicker({ kind: 'osnovna' })}
              onOpenMkbForCo={(i) => openMkbPicker({ kind: 'co', index: i })}
            />

            <TextSection
              id="sec-anamneza"
              title="Анамнеза"
              fieldKey="anamneza"
              value={fields.anamneza || ''}
              onChange={(v) => updateField('anamneza', v)}
              acknowledged={acknowledged}
              onAcknowledge={(raw) => acknowledgeSpan('anamneza', raw)}
            />
            <TextSection
              id="sec-obektivno"
              title="Обективно състояние"
              fieldKey="obektivno"
              value={fields.obektivno || ''}
              onChange={(v) => updateField('obektivno', v)}
              acknowledged={acknowledged}
              onAcknowledge={(raw) => acknowledgeSpan('obektivno', raw)}
            />
            <TextSection
              id="sec-izsledvania"
              title="Изследвания"
              fieldKey="izsledvania"
              value={fields.izsledvania || ''}
              onChange={(v) => updateField('izsledvania', v)}
              acknowledged={acknowledged}
              onAcknowledge={(raw) => acknowledgeSpan('izsledvania', raw)}
            />
            <TextSection
              id="sec-terapia"
              title="Терапия"
              fieldKey="terapia"
              value={fields.terapia || ''}
              onChange={(v) => updateField('terapia', v)}
              acknowledged={acknowledged}
              onAcknowledge={(raw) => acknowledgeSpan('terapia', raw)}
            />

            {visibleSections['sec-izdadeni'] && (
              <div
                id="sec-izdadeni"
                className="bg-white rounded-2xl border p-6 scroll-mt-24"
                style={{ borderColor: 'var(--color-border)' }}
              >
                <SectionHead title="Издадени документи" />

                {visibleSections['sec-napravlenia'] && (
                  <div id="sec-napravlenia" className="mb-4 scroll-mt-24">
                    <SubsectionHead title="📋 Направления за консултация" />
                    <EditableField
                      value={fields.napravlenia || ''}
                      onChange={(v) => updateField('napravlenia', v)}
                    />
                  </div>
                )}

                {visibleSections['sec-naznacheni'] && (
                  <div id="sec-naznacheni" className="scroll-mt-24">
                    <SubsectionHead title="🔬 Назначени изследвания" />
                    <EditableField
                      value={fields.naznacheni || ''}
                      onChange={(v) => updateField('naznacheni', v)}
                    />
                  </div>
                )}
              </div>
            )}

            {fields._disclaimer && (
              <div
                className="text-xs px-3 py-2 rounded no-print"
                style={{
                  color: 'var(--color-text-hint)',
                  background: 'var(--color-bg-card)',
                  borderColor: 'var(--color-border)',
                  borderWidth: 1,
                }}
              >
                {fields._disclaimer}
              </div>
            )}
          </div>
        </main>

        {/* ─── Right: meds + safety + actions ─── */}
        <aside className="no-print">
          <div className="sticky top-[88px] space-y-4">
            <MedsPanel
              meds={fields.medications_list || []}
              onChange={onMedsChange}
              terapiaText={fields.terapia || ''}
              inlineCriticals={criticals}
              lastRemovedName={lastRemovedMedName}
              onClearRemovedHint={() => setLastRemovedMedName(null)}
            />

            {warnings.length > 0 && (
              <div
                className="bg-white rounded-2xl border p-4"
                style={{ borderColor: 'var(--color-border)' }}
              >
                <div
                  className="text-xs uppercase tracking-wider mb-2 font-medium"
                  style={{ color: 'var(--color-gold)' }}
                >
                  ⚠ Предупреждения
                </div>
                <div className="space-y-2">
                  {warnings.map((a, i) => (
                    <WarningChip key={i} alert={a} />
                  ))}
                </div>
              </div>
            )}

            <div
              className="bg-white rounded-2xl border p-4"
              style={{ borderColor: 'var(--color-border)' }}
            >
              <div
                className="text-xs uppercase tracking-wider mb-3 font-medium"
                style={{ color: 'var(--color-text-hint)' }}
              >
                Действия
              </div>
              <Link
                href="/app/scribe"
                className="block text-center py-2.5 rounded-md text-white font-medium text-sm transition hover:opacity-90 mb-2"
                style={{ background: 'var(--gradient-brand)' }}
                onClick={() => {
                  sessionStorage.removeItem(RESULT_STORAGE_KEY);
                }}
              >
                + Нова консултация
              </Link>
              <button
                onClick={handlePrint}
                disabled={isLocked}
                title={
                  isLocked ? 'Първо потвърдете прегледа' : undefined
                }
                className="block w-full text-center py-2 rounded-md text-sm font-medium transition border hover:bg-[var(--color-bg)] disabled:opacity-40 disabled:cursor-not-allowed"
                style={{
                  borderColor: 'var(--color-border-mid)',
                  color: 'var(--color-text-muted)',
                }}
              >
                {isLocked ? '🔒' : '⎙'} Печат
              </button>
            </div>
          </div>
        </aside>
      </div>

      <MkbPicker
        isOpen={mkbOpen}
        onClose={closeMkbPicker}
        onPick={pickMkb}
        title={
          mkbTarget?.kind === 'osnovna'
            ? 'Основна диагноза — МКБ-10'
            : 'Придружаващо заболяване — МКБ-10'
        }
      />

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </AppShell>
  );
}

/* ──────────────────────────────────────────────────────────────── */

function CriticalChip({ alert }: { alert: SafetyAlert }) {
  return (
    <div
      className="flex items-start gap-3 px-3 py-2 rounded-md"
      style={{
        background: 'white',
        borderColor: 'var(--color-red)',
        borderWidth: 1,
      }}
    >
      <span className="text-lg flex-shrink-0">🚨</span>
      <div className="flex-1 min-w-0">
        <div
          className="text-xs font-bold uppercase tracking-wider"
          style={{ color: 'var(--color-red)' }}
        >
          Внимание!
        </div>
        <div
          className="text-sm mt-0.5"
          style={{ color: 'var(--color-text)' }}
        >
          {alert.message}
        </div>
      </div>
    </div>
  );
}

function WarningChip({ alert }: { alert: SafetyAlert }) {
  return (
    <div
      className="flex items-start gap-2 px-2.5 py-2 rounded-md"
      style={{
        background: 'var(--color-gold-soft)',
        borderColor: 'var(--color-gold)',
        borderWidth: 1,
      }}
    >
      <span className="text-sm flex-shrink-0">⚠️</span>
      <div
        className="text-xs leading-snug"
        style={{ color: 'var(--color-text)' }}
      >
        <div
          className="font-semibold uppercase tracking-wide text-[10px] mb-0.5"
          style={{ color: 'var(--color-gold)' }}
        >
          Предупреждение
        </div>
        {alert.message}
      </div>
    </div>
  );
}

function ReviewCounter({
  total,
  cursor,
  onNext,
}: {
  total: number;
  cursor: number;
  onNext: () => void;
}) {
  // cursor === 0 means "haven't started"; otherwise show "current / total".
  const showProgress = cursor > 0;
  const display = showProgress
    ? `${((cursor - 1) % total) + 1} / ${total}`
    : `${total} за преглед`;
  return (
    <button
      onClick={onNext}
      title="Прескочи към следващото отбелязано показание"
      className="flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition hover:opacity-90"
      style={{
        background: 'var(--color-gold-soft)',
        color: 'var(--color-gold)',
        borderColor: 'var(--color-gold)',
        borderWidth: 1,
      }}
    >
      <span>⚠</span>
      <span>{display}</span>
      <span style={{ fontSize: '14px' }}>▶</span>
    </button>
  );
}

function StatusBadge({
  status,
  popupOpen,
  onClick,
  onConfirm,
  onDismiss,
}: {
  status: ReviewStatus;
  popupOpen: boolean;
  onClick: () => void;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  const isConfirmed = status === 'confirmed';
  return (
    <div className="relative">
      <button
        onClick={onClick}
        className="flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition"
        style={{
          background: isConfirmed
            ? 'var(--color-ok-soft)'
            : 'var(--color-gold-soft)',
          color: isConfirmed ? 'var(--color-ok)' : 'var(--color-gold)',
        }}
      >
        <span
          className="w-2 h-2 rounded-full"
          style={{
            background: isConfirmed
              ? 'var(--color-ok)'
              : 'var(--color-gold)',
          }}
        />
        {isConfirmed
          ? '✓ Потвърдено от лекар'
          : '🔒 Чака преглед — действията са заключени'}
      </button>
      {popupOpen && !isConfirmed && (
        <div
          className="absolute top-full left-0 mt-2 bg-white rounded-lg border p-2 shadow-md z-20 flex flex-col gap-1 min-w-[220px]"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <button
            onClick={onConfirm}
            className="text-left px-3 py-2 rounded-md text-sm font-medium transition hover:bg-[var(--color-ok-soft)]"
            style={{ color: 'var(--color-ok)' }}
          >
            ✓ Вярно! Потвърждавам прегледа
          </button>
          <button
            onClick={onDismiss}
            className="text-left px-3 py-2 rounded-md text-sm transition hover:bg-[var(--color-bg)]"
            style={{ color: 'var(--color-text-muted)' }}
          >
            ✎ Ще редактирам още
          </button>
        </div>
      )}
    </div>
  );
}

function TopbarBtn({
  label,
  onClick,
  disabled,
  locked,
  lockedHint,
}: {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  locked?: boolean;
  lockedHint?: string;
}) {
  const finalDisabled = disabled || locked;
  return (
    <button
      onClick={onClick}
      disabled={finalDisabled}
      title={locked ? lockedHint : undefined}
      className="px-3 py-1.5 rounded-md text-sm font-medium border transition hover:bg-[var(--color-bg)] disabled:opacity-40 disabled:cursor-not-allowed"
      style={{
        borderColor: 'var(--color-border-mid)',
        color: 'var(--color-text-muted)',
      }}
    >
      {locked ? '🔒 ' : ''}
      {label}
    </button>
  );
}

function SectionHead({ title }: { title: string }) {
  return (
    <h2
      className="text-xl font-semibold mb-4"
      style={{ color: 'var(--color-ink)' }}
    >
      {title}
    </h2>
  );
}

function SubsectionHead({ title }: { title: string }) {
  return (
    <div
      className="text-sm font-semibold uppercase tracking-wider mb-2"
      style={{ color: 'var(--color-brand)' }}
    >
      {title}
    </div>
  );
}

function TextSection({
  id,
  title,
  value,
  onChange,
  fieldKey,
  acknowledged,
  onAcknowledge,
}: {
  id: string;
  title: string;
  value: string;
  onChange: (v: string) => void;
  fieldKey?: string;
  acknowledged?: Set<string>;
  onAcknowledge?: (raw: string) => void;
}) {
  return (
    <div
      id={id}
      className="bg-white rounded-2xl border p-6 scroll-mt-24"
      style={{ borderColor: 'var(--color-border)' }}
    >
      <SectionHead title={title} />
      <EditableField
        value={value}
        onChange={onChange}
        fieldKey={fieldKey}
        acknowledged={acknowledged}
        onAcknowledge={onAcknowledge}
      />
    </div>
  );
}

function DiagnosesSection({
  osnovnaDiagnoza,
  osnovnaMkb,
  pridruzhavashti,
  onOsnovnaDiagnozaChange,
  onOsnovnaMkbChange,
  onPridruzhavashtiChange,
  onCoFieldChange,
  onOpenMkbForOsnovna,
  onOpenMkbForCo,
}: {
  osnovnaDiagnoza: string;
  osnovnaMkb: string;
  pridruzhavashti: ComorbidDiagnosis[];
  onOsnovnaDiagnozaChange: (v: string) => void;
  onOsnovnaMkbChange: (v: string) => void;
  onPridruzhavashtiChange: (v: ComorbidDiagnosis[]) => void;
  onCoFieldChange: (index: number, key: 'diagnoza' | 'mkb', v: string) => void;
  onOpenMkbForOsnovna: () => void;
  onOpenMkbForCo: (index: number) => void;
}) {
  const hasMain = osnovnaDiagnoza.trim().length > 0;

  function removeCo(i: number) {
    onPridruzhavashtiChange(pridruzhavashti.filter((_, idx) => idx !== i));
  }

  function addCo() {
    onPridruzhavashtiChange([...pridruzhavashti, { diagnoza: '', mkb: '' }]);
  }

  return (
    <div
      id="sec-diag"
      className="bg-white rounded-2xl border p-6 scroll-mt-24"
      style={{ borderColor: 'var(--color-border)' }}
    >
      <SectionHead title="Диагнози МКБ-10" />

      <div
        className="mb-4 pb-4 border-b"
        style={{ borderColor: 'var(--color-border)' }}
      >
        <div
          className="text-xs uppercase tracking-wider mb-2 font-medium"
          style={{ color: 'var(--color-text-hint)' }}
        >
          Основна диагноза
        </div>
        <DiagRow
          diagnoza={osnovnaDiagnoza}
          mkb={osnovnaMkb}
          onDiagnozaChange={onOsnovnaDiagnozaChange}
          onMkbChange={onOsnovnaMkbChange}
          onPickMkb={onOpenMkbForOsnovna}
        />
        {!hasMain && (
          <div
            className="text-xs mt-2 px-1"
            style={{ color: 'var(--color-text-hint)' }}
          >
            Не е открита в транскрипта — въведете или използвайте 🔍 за избор от МКБ-10.
          </div>
        )}
      </div>

      <div
        className="text-xs uppercase tracking-wider mb-3 font-medium flex items-center justify-between"
        style={{ color: 'var(--color-text-hint)' }}
      >
        <span>Придружаващи заболявания</span>
        <button
          onClick={addCo}
          className="text-xs font-semibold px-2 py-1 rounded transition hover:opacity-80"
          style={{
            color: 'var(--color-brand)',
            background: 'var(--color-brand-soft)',
          }}
        >
          + Добави
        </button>
      </div>
      <div className="space-y-2">
        {pridruzhavashti.map((d, i) => (
          <DiagRow
            key={i}
            diagnoza={d.diagnoza}
            mkb={d.mkb}
            onDiagnozaChange={(v) => onCoFieldChange(i, 'diagnoza', v)}
            onMkbChange={(v) => onCoFieldChange(i, 'mkb', v)}
            onRemove={() => removeCo(i)}
            onPickMkb={() => onOpenMkbForCo(i)}
          />
        ))}
        {pridruzhavashti.length === 0 && (
          <div
            className="text-sm px-3 py-1"
            style={{ color: 'var(--color-text-hint)' }}
          >
            Няма придружаващи заболявания.
          </div>
        )}
      </div>
    </div>
  );
}

function DiagRow({
  diagnoza,
  mkb,
  onDiagnozaChange,
  onMkbChange,
  onRemove,
  onPickMkb,
}: {
  diagnoza: string;
  mkb: string;
  onDiagnozaChange: (v: string) => void;
  onMkbChange: (v: string) => void;
  onRemove?: () => void;
  onPickMkb: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="text"
        value={diagnoza}
        onChange={(e) => onDiagnozaChange(e.target.value)}
        placeholder="Диагноза"
        className="flex-1 px-3 py-2 rounded-md border outline-none text-base"
        style={{
          borderColor: 'var(--color-border-mid)',
          background: 'white',
        }}
      />
      <div className="relative flex items-center">
        <input
          type="text"
          value={mkb}
          onChange={(e) => onMkbChange(e.target.value)}
          placeholder="МКБ"
          className="w-28 pl-3 pr-8 py-2 rounded-md border outline-none text-sm font-[family-name:var(--font-jetbrains)] text-center"
          style={{
            borderColor: 'var(--color-border-mid)',
            background: 'white',
            color: 'var(--color-gold)',
          }}
        />
        <button
          onClick={onPickMkb}
          aria-label="Избор от МКБ-10"
          title="Избор от МКБ-10"
          className="absolute right-1 w-6 h-6 flex items-center justify-center rounded transition hover:bg-[var(--color-brand-soft)]"
          style={{ color: 'var(--color-brand)' }}
        >
          🔍
        </button>
      </div>
      {onRemove && (
        <button
          onClick={onRemove}
          aria-label="Премахни"
          className="w-8 h-8 rounded-md flex items-center justify-center text-lg transition hover:bg-[var(--color-bg)]"
          style={{ color: 'var(--color-text-hint)' }}
        >
          ×
        </button>
      )}
    </div>
  );
}

// PatientHeaderStrip + visitTypeLabel previously lived here as local functions;
// extracted to components/PatientHeaderStrip.tsx so /app/scribe and
// /app/scribe/result render the exact same strip from one source.
