'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import AppHeader from '@/components/AppHeader';
import Stepper from '@/components/Stepper';
import EditableField from '@/components/EditableField';
import MkbPicker from '@/components/MkbPicker';
import { api, ApiError, getSession } from '@/lib/api';
import type { DoctorInfo } from '@/lib/api';
import type {
  TranscribeResult,
  TranscribeFields,
  ComorbidDiagnosis,
} from '@/lib/types';

const RESULT_STORAGE_KEY = 'tuber_last_result';

type ReviewStatus = 'pending' | 'confirmed';

interface NavItem {
  id: string;
  label: string;
  indent?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'sec-diag', label: 'Диагнози МКБ-10' },
  { id: 'sec-anamneza', label: 'Анамнеза' },
  { id: 'sec-obektivno', label: 'Обективен статус' },
  { id: 'sec-izsledvania', label: 'Изследвания' },
  { id: 'sec-terapia', label: 'Терапия' },
  { id: 'sec-meds', label: 'Медикаменти' },
  { id: 'sec-izdadeni', label: 'Издадени документи' },
  { id: 'sec-napravlenia', label: 'Направления', indent: true },
  { id: 'sec-naznacheni', label: 'Назначени изследвания', indent: true },
];

type MkbTarget = { kind: 'osnovna' } | { kind: 'co'; index: number };

export default function ResultPage() {
  const router = useRouter();
  const [doctor, setDoctor] = useState<DoctorInfo | null>(null);
  const [original, setOriginal] = useState<TranscribeResult | null>(null);
  const [fields, setFields] = useState<TranscribeFields>({});
  const [reviewStatus, setReviewStatus] = useState<ReviewStatus>('pending');
  const [reviewPopupOpen, setReviewPopupOpen] = useState(false);
  const [activeNav, setActiveNav] = useState<string>('sec-diag');
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [mkbOpen, setMkbOpen] = useState(false);
  const [mkbTarget, setMkbTarget] = useState<MkbTarget | null>(null);

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
  }, [router]);

  // ── Edit tracking (debounced) ─────────────────────────────────
  const flushEdit = useCallback(() => {
    if (!original) return;
    const field = pendingEditField.current ?? undefined;
    api.editConsultation(original.consultationId, field).catch((err) => {
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

  // ── Navigation: click to scroll ──────────────────────────────
  const navTo = useCallback((id: string) => {
    setActiveNav(id);
    const el = document.getElementById(id);
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
            (a, b) =>
              a.boundingClientRect.top - b.boundingClientRect.top
          );
        if (visible.length > 0) {
          setActiveNav(visible[0].target.id);
        }
      },
      { rootMargin: '-120px 0px -60% 0px', threshold: 0 }
    );
    NAV_ITEMS.forEach((item) => {
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

  const pickMkb = useCallback(
    (code: string, term: string) => {
      if (!mkbTarget) return;
      if (mkbTarget.kind === 'osnovna') {
        setFields((prev) => ({
          ...prev,
          osnovna_mkb: code,
          osnovna_diagnoza:
            (prev.osnovna_diagnoza || '').trim() === ''
              ? term
              : prev.osnovna_diagnoza,
        }));
        trackEdit('osnovna_mkb');
      } else {
        const idx = mkbTarget.index;
        setFields((prev) => {
          const co = (prev.pridruzhavashti || []).map((d, i) =>
            i === idx
              ? {
                  mkb: code,
                  diagnoza:
                    d.diagnoza.trim() === '' ? term : d.diagnoza,
                }
              : d
          );
          return { ...prev, pridruzhavashti: co };
        });
        trackEdit('pridruzhavashti');
      }
    },
    [mkbTarget, trackEdit]
  );

  // ── Visible-section bookkeeping ──────────────────────────────
  const visibleSections = useMemo(() => {
    const v: Record<string, boolean> = {};
    v['sec-diag'] = true;
    v['sec-anamneza'] = true;
    v['sec-obektivno'] = true;
    v['sec-izsledvania'] = true;
    v['sec-terapia'] = true;
    v['sec-meds'] = true;
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
    <div className="min-h-screen flex flex-col">
      <AppHeader doctor={doctor} />
      <Stepper active="result" />

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
        <div className="flex items-center gap-2">
          <TopbarBtn
            disabled
            locked={isLocked}
            label="⬇ PDF"
            lockedHint="Първо потвърдете прегледа"
          />
          <TopbarBtn
            disabled
            locked={isLocked}
            label="⬇ Word"
            lockedHint="Първо потвърдете прегледа"
          />
          <TopbarBtn
            disabled
            locked={isLocked}
            label="⎘ Копирай"
            lockedHint="Първо потвърдете прегледа"
          />
          <TopbarBtn
            locked={isLocked}
            disabled={isLocked}
            onClick={() => window.print()}
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
                    onClick={() => navTo(item.id)}
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
              className="text-3xl font-semibold font-[family-name:var(--font-cormorant)]"
              style={{ color: 'var(--color-brand)' }}
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

          {/* Sections */}
          <div className="space-y-4">
            <DiagnosesSection
              osnovnaDiagnoza={fields.osnovna_diagnoza || ''}
              osnovnaMkb={fields.osnovna_mkb || ''}
              pridruzhavashti={fields.pridruzhavashti || []}
              onOsnovnaDiagnozaChange={(v) =>
                updateField('osnovna_diagnoza', v)
              }
              onOsnovnaMkbChange={(v) => updateField('osnovna_mkb', v)}
              onPridruzhavashtiChange={(v) =>
                updateField('pridruzhavashti', v)
              }
              onOpenMkbForOsnovna={() =>
                openMkbPicker({ kind: 'osnovna' })
              }
              onOpenMkbForCo={(i) =>
                openMkbPicker({ kind: 'co', index: i })
              }
            />

            <TextSection
              id="sec-anamneza"
              title="Анамнеза"
              value={fields.anamneza || ''}
              onChange={(v) => updateField('anamneza', v)}
            />
            <TextSection
              id="sec-obektivno"
              title="Обективно състояние"
              value={fields.obektivno || ''}
              onChange={(v) => updateField('obektivno', v)}
            />
            <TextSection
              id="sec-izsledvania"
              title="Изследвания"
              value={fields.izsledvania || ''}
              onChange={(v) => updateField('izsledvania', v)}
            />
            <TextSection
              id="sec-terapia"
              title="Терапия"
              value={fields.terapia || ''}
              onChange={(v) => updateField('terapia', v)}
            />

            <div
              id="sec-meds"
              className="bg-white rounded-2xl border p-6 scroll-mt-24"
              style={{ borderColor: 'var(--color-border)' }}
            >
              <SectionHead title="Медикаменти" />
              <div
                className="text-sm italic"
                style={{ color: 'var(--color-text-hint)' }}
              >
                Пълният панел с медикаменти, безопасност и добавяне от база
                данни идва в C4c.
                {fields.medications_list &&
                  fields.medications_list.length > 0 && (
                    <div className="mt-3 not-italic">
                      <div
                        className="text-xs uppercase tracking-wider mb-2"
                        style={{ color: 'var(--color-text-muted)' }}
                      >
                        AI откри ({fields.medications_list.length}):
                      </div>
                      <ul
                        className="space-y-1"
                        style={{ color: 'var(--color-text)' }}
                      >
                        {fields.medications_list.map((m, i) => (
                          <li key={i} className="text-sm">
                            • {m.inn}
                            {m.dose ? ', ' + m.dose : ''}
                            {m.regimen ? ', ' + m.regimen : ''}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
              </div>
            </div>

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
                className="text-xs italic px-3 py-2 rounded no-print"
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

        {/* ─── Right: actions panel ─── */}
        <aside className="no-print">
          <div className="sticky top-[88px] space-y-4">
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
                onClick={() => !isLocked && window.print()}
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

            <div
              className="bg-white rounded-2xl border p-4 text-xs italic"
              style={{
                borderColor: 'var(--color-border)',
                color: 'var(--color-text-hint)',
              }}
            >
              Странична секция с медикаменти и безопасност идва в C4c.
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
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────── */

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
      title={locked ? lockedHint : disabled ? 'Активира се в C4d' : undefined}
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
      className="text-xl font-medium mb-4 font-[family-name:var(--font-cormorant)]"
      style={{ color: 'var(--color-brand)' }}
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
}: {
  id: string;
  title: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div
      id={id}
      className="bg-white rounded-2xl border p-6 scroll-mt-24"
      style={{ borderColor: 'var(--color-border)' }}
    >
      <SectionHead title={title} />
      <EditableField value={value} onChange={onChange} />
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
  onOpenMkbForOsnovna,
  onOpenMkbForCo,
}: {
  osnovnaDiagnoza: string;
  osnovnaMkb: string;
  pridruzhavashti: ComorbidDiagnosis[];
  onOsnovnaDiagnozaChange: (v: string) => void;
  onOsnovnaMkbChange: (v: string) => void;
  onPridruzhavashtiChange: (v: ComorbidDiagnosis[]) => void;
  onOpenMkbForOsnovna: () => void;
  onOpenMkbForCo: (index: number) => void;
}) {
  const hasMain = osnovnaDiagnoza.trim().length > 0;
  const isEmpty = !hasMain && pridruzhavashti.length === 0;

  function updateCo(i: number, patch: Partial<ComorbidDiagnosis>) {
    const next = pridruzhavashti.map((d, idx) =>
      idx === i ? { ...d, ...patch } : d
    );
    onPridruzhavashtiChange(next);
  }

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

      {isEmpty && (
        <div
          className="text-sm italic px-3 py-2 mb-3"
          style={{ color: 'var(--color-text-hint)' }}
        >
          Не е открита диагноза в транскрипта.
        </div>
      )}

      {hasMain && (
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
        </div>
      )}

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
            onDiagnozaChange={(v) => updateCo(i, { diagnoza: v })}
            onMkbChange={(v) => updateCo(i, { mkb: v })}
            onRemove={() => removeCo(i)}
            onPickMkb={() => onOpenMkbForCo(i)}
          />
        ))}
        {pridruzhavashti.length === 0 && (
          <div
            className="text-sm italic px-3 py-1"
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
