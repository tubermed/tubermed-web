'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import AppHeader from '@/components/AppHeader';
import {
  api,
  clearSession,
  getSession,
  type DoctorInfo,
} from '@/lib/api';
import type {
  TranscribeResult,
  TranscribeFields,
  ComorbidDiagnosis,
} from '@/lib/types';

const RESULT_STORAGE_KEY = 'tuber_last_result';

type ReviewState = 'pending' | 'confirmed';

/* ─────────────────────────────────────────────────────────────── */

export default function ResultPage() {
  const router = useRouter();
  const [doctor, setDoctor] = useState<DoctorInfo | null>(null);
  const [result, setResult] = useState<TranscribeResult | null>(null);
  const [fields, setFields] = useState<TranscribeFields | null>(null);
  const [review, setReview] = useState<ReviewState>('pending');
  const [activeSection, setActiveSection] = useState('section-diag');
  const [transcriptOpen, setTranscriptOpen] = useState(false);

  const fieldsRef = useRef<TranscribeFields | null>(null);
  const editTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editCountRef = useRef(0);

  // ── Auth + load result
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
      setResult(parsed);
      setFields(parsed.fields);
      fieldsRef.current = parsed.fields;
    } catch {
      router.replace('/app/scribe');
    }
  }, [router]);

  // ── Field update: local state + sessionStorage + debounced backend save
  const updateField = useCallback(
    <K extends keyof TranscribeFields>(key: K, val: TranscribeFields[K]) => {
      if (!result) return;
      setFields((prev) => {
        const next: TranscribeFields = { ...(prev || {}), [key]: val };
        fieldsRef.current = next;
        sessionStorage.setItem(
          RESULT_STORAGE_KEY,
          JSON.stringify({ ...result, fields: next })
        );
        return next;
      });

      editCountRef.current++;
      if (editTimeoutRef.current) clearTimeout(editTimeoutRef.current);
      editTimeoutRef.current = setTimeout(() => {
        const snapshot = fieldsRef.current;
        if (!snapshot) return;
        api.editConsultation(result.consultationId, snapshot).catch(() => {
          /* silent — backend logging shouldn't block UX */
        });
      }, 1500);
    },
    [result]
  );

  // ── Section nav: scroll-into-view + update active state
  const navTo = useCallback((id: string) => {
    setActiveSection(id);
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  // ── Copy whole document as plain text
  const copyText = useCallback(async () => {
    if (!fields) return;
    const text = buildPlainText(fields, doctor);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* fallback omitted — modern browsers support clipboard */
    }
  }, [fields, doctor]);

  if (!doctor || !result || !fields) {
    return (
      <main
        className="min-h-screen flex items-center justify-center"
        style={{ color: 'var(--color-text-muted)' }}
      >
        Зареждане…
      </main>
    );
  }

  const date = new Date().toLocaleDateString('bg-BG', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  const time = new Date().toLocaleTimeString('bg-BG', {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className="min-h-screen flex flex-col">
      <AppHeader doctor={doctor} />

      <WizardSteps activeStep={4} />

      <main className="flex-1 px-6 pb-12">
        <div className="max-w-6xl mx-auto">
          <TopActionBar
            review={review}
            onConfirm={() => setReview('confirmed')}
            onCopy={copyText}
            onPrint={() => window.print()}
          />

          <div className="grid gap-6 mt-6" style={{ gridTemplateColumns: '220px 1fr 240px' }}>
            <SideNav active={activeSection} onNavigate={navTo} fields={fields} />

            <MainDocument
              fields={fields}
              transcript={result.transcript}
              transcriptOpen={transcriptOpen}
              onToggleTranscript={() => setTranscriptOpen((v) => !v)}
              date={date}
              time={time}
              doctor={doctor}
              onUpdate={updateField}
            />

            <RightPanel
              onNewRecord={() => {
                sessionStorage.removeItem(RESULT_STORAGE_KEY);
                router.push('/app/scribe');
              }}
              onLogout={() => {
                clearSession();
                router.replace('/app/login');
              }}
            />
          </div>
        </div>
      </main>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────── */
/* WIZARD STEPS                                                   */
/* ─────────────────────────────────────────────────────────────── */

function WizardSteps({ activeStep }: { activeStep: number }) {
  const steps = [
    { num: 1, label: 'Вход', sub: 'Пациент' },
    { num: 2, label: 'Запис', sub: 'Консултация' },
    { num: 3, label: 'Обработка', sub: 'AI анализ' },
    { num: 4, label: 'Резултат', sub: 'Документ' },
  ];

  return (
    <div className="px-6 pt-6 pb-2 print:hidden">
      <div className="max-w-3xl mx-auto flex items-center gap-2">
        {steps.map((s, i) => {
          const done = s.num < activeStep;
          const active = s.num === activeStep;
          return (
            <div key={s.num} className="flex items-center flex-1">
              <div className="flex items-center gap-3">
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-medium"
                  style={{
                    background:
                      done || active
                        ? 'var(--color-brand)'
                        : 'var(--color-bg-card)',
                    color: done || active ? 'white' : 'var(--color-text-muted)',
                    borderColor: 'var(--color-border)',
                    borderWidth: done || active ? 0 : 1,
                  }}
                >
                  {done ? '✓' : s.num}
                </div>
                <div className="hidden sm:block leading-tight">
                  <div
                    className="text-sm font-medium"
                    style={{
                      color: active
                        ? 'var(--color-brand)'
                        : 'var(--color-text-muted)',
                    }}
                  >
                    {s.label}
                  </div>
                  <div
                    className="text-xs"
                    style={{ color: 'var(--color-text-hint)' }}
                  >
                    {s.sub}
                  </div>
                </div>
              </div>
              {i < steps.length - 1 && (
                <div
                  className="flex-1 h-px mx-3"
                  style={{
                    background:
                      s.num < activeStep
                        ? 'var(--color-brand)'
                        : 'var(--color-border)',
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────── */
/* TOP ACTION BAR                                                 */
/* ─────────────────────────────────────────────────────────────── */

function TopActionBar({
  review,
  onConfirm,
  onCopy,
  onPrint,
}: {
  review: ReviewState;
  onConfirm: () => void;
  onCopy: () => void;
  onPrint: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 pt-4 print:hidden">
      <ReviewBadge review={review} onConfirm={onConfirm} />
      <div className="flex items-center gap-2">
        <ActionBtn onClick={onCopy}>⎘ Копирай</ActionBtn>
        <ActionBtn onClick={onPrint}>⎙ Печат</ActionBtn>
        <ActionBtn disabled title="PDF идва в C4c">
          ⬇ PDF
        </ActionBtn>
        <ActionBtn disabled title="Word идва в C4c">
          ⬇ Word
        </ActionBtn>
      </div>
    </div>
  );
}

function ReviewBadge({
  review,
  onConfirm,
}: {
  review: ReviewState;
  onConfirm: () => void;
}) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  if (review === 'confirmed') {
    return (
      <div
        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium"
        style={{
          background: 'var(--color-ok-soft)',
          color: 'var(--color-ok)',
        }}
      >
        ✓ Потвърдено от лекар
      </div>
    );
  }
  return (
    <div className="relative">
      <button
        onClick={() => setPopoverOpen((v) => !v)}
        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium border transition hover:opacity-90"
        style={{
          background: 'var(--color-bg-card)',
          borderColor: 'var(--color-border-mid)',
          color: 'var(--color-text-muted)',
        }}
      >
        <span
          className="w-2 h-2 rounded-full inline-block"
          style={{ background: 'var(--color-gold)' }}
        />
        Чака преглед от лекар
      </button>
      {popoverOpen && (
        <div
          className="absolute top-full mt-2 left-0 z-50 flex flex-col gap-2 p-2 rounded-md shadow-lg"
          style={{
            background: 'var(--color-bg-card)',
            borderColor: 'var(--color-border)',
            borderWidth: 1,
            minWidth: '240px',
          }}
        >
          <button
            onClick={() => {
              onConfirm();
              setPopoverOpen(false);
            }}
            className="px-3 py-2 rounded-md text-sm text-white font-medium text-left hover:opacity-90"
            style={{ background: 'var(--color-ok)' }}
          >
            ✓ Вярно! Потвърдено
          </button>
          <button
            onClick={() => setPopoverOpen(false)}
            className="px-3 py-2 rounded-md text-sm text-left hover:bg-[var(--color-brand-light)]"
            style={{ color: 'var(--color-text-muted)' }}
          >
            ✎ Ще редактирам
          </button>
        </div>
      )}
    </div>
  );
}

function ActionBtn({
  children,
  onClick,
  disabled,
  title,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="px-3 py-1.5 rounded-md text-sm border transition hover:bg-[var(--color-brand-light)] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
      style={{
        borderColor: 'var(--color-border-mid)',
        color: 'var(--color-text)',
        background: 'var(--color-bg-card)',
      }}
    >
      {children}
    </button>
  );
}

/* ─────────────────────────────────────────────────────────────── */
/* SIDE NAVIGATION                                                */
/* ─────────────────────────────────────────────────────────────── */

interface NavItem {
  id: string;
  label: string;
  indent?: boolean;
}

function SideNav({
  active,
  onNavigate,
  fields,
}: {
  active: string;
  onNavigate: (id: string) => void;
  fields: TranscribeFields;
}) {
  const medsCount = fields.medications_list?.length || 0;
  const hasDocs =
    (fields.napravlenia && fields.napravlenia.trim()) ||
    (fields.naznacheni && fields.naznacheni.trim());

  const items: NavItem[] = [
    { id: 'section-diag', label: 'Диагнози МКБ-10' },
    { id: 'sec-anamneza', label: 'Анамнеза' },
    { id: 'sec-obektivno', label: 'Обективен статус' },
    { id: 'sec-izsledvania', label: 'Изследвания' },
    { id: 'sec-terapia', label: 'Терапия' },
    { id: 'sec-meds', label: 'Медикаменти' },
  ];
  if (hasDocs) {
    items.push({ id: 'sec-izdadeni', label: 'Издадени документи' });
    if (fields.napravlenia && fields.napravlenia.trim()) {
      items.push({ id: 'sec-napravlenia', label: 'Направления', indent: true });
    }
    if (fields.naznacheni && fields.naznacheni.trim()) {
      items.push({ id: 'sec-naznacheni', label: 'Назначени', indent: true });
    }
  }

  return (
    <aside className="print:hidden">
      <div className="sticky top-20">
        <div
          className="text-xs uppercase tracking-wider mb-3 font-medium"
          style={{ color: 'var(--color-text-hint)' }}
        >
          Раздели
        </div>
        <nav className="flex flex-col">
          {items.map((item) => {
            const isActive = active === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                className="text-left text-sm py-2 px-2 rounded transition flex items-center gap-2 hover:bg-[var(--color-brand-light)]"
                style={{
                  color: isActive
                    ? 'var(--color-brand)'
                    : 'var(--color-text-muted)',
                  fontWeight: isActive ? 600 : 400,
                  paddingLeft: item.indent ? '28px' : '8px',
                  fontSize: item.indent ? '13px' : '14px',
                }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                  style={{
                    background: isActive
                      ? 'var(--color-brand)'
                      : 'var(--color-border-mid)',
                  }}
                />
                <span>{item.label}</span>
                {item.id === 'sec-meds' && medsCount > 0 && (
                  <span
                    className="ml-auto text-xs px-1.5 rounded font-medium"
                    style={{
                      background: 'var(--color-brand-soft)',
                      color: 'var(--color-brand)',
                    }}
                  >
                    {medsCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}

/* ─────────────────────────────────────────────────────────────── */
/* MAIN DOCUMENT                                                  */
/* ─────────────────────────────────────────────────────────────── */

function MainDocument({
  fields,
  transcript,
  transcriptOpen,
  onToggleTranscript,
  date,
  time,
  doctor,
  onUpdate,
}: {
  fields: TranscribeFields;
  transcript: string;
  transcriptOpen: boolean;
  onToggleTranscript: () => void;
  date: string;
  time: string;
  doctor: DoctorInfo;
  onUpdate: <K extends keyof TranscribeFields>(
    key: K,
    val: TranscribeFields[K]
  ) => void;
}) {
  const hasDocs =
    (fields.napravlenia && fields.napravlenia.trim()) ||
    (fields.naznacheni && fields.naznacheni.trim());

  return (
    <main>
      {/* Transcript toggle */}
      <div className="mb-4 print:hidden">
        <button
          onClick={onToggleTranscript}
          className="text-sm hover:underline flex items-center gap-2"
          style={{ color: 'var(--color-text-muted)' }}
        >
          <span style={{ fontSize: '10px' }}>
            {transcriptOpen ? '▼' : '▶'}
          </span>
          Транскрипт на консултацията
        </button>
        {transcriptOpen && (
          <div
            className="mt-2 p-4 rounded-md text-sm whitespace-pre-wrap"
            style={{
              background: 'var(--color-bg)',
              color: 'var(--color-text-muted)',
              maxHeight: '300px',
              overflowY: 'auto',
            }}
          >
            {transcript || '(празен транскрипт)'}
          </div>
        )}
      </div>

      {/* Document */}
      <div
        className="rounded-2xl p-8 shadow-sm"
        style={{
          background: 'var(--color-bg-card)',
          borderColor: 'var(--color-border)',
          borderWidth: 1,
        }}
      >
        {/* Document title bar */}
        <div
          className="flex items-baseline justify-between pb-5 mb-6 border-b"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <div>
            <h1
              className="text-3xl font-medium font-[family-name:var(--font-cormorant)]"
              style={{ color: 'var(--color-brand)' }}
            >
              Амбулаторен лист
            </h1>
          </div>
          <div className="text-right">
            <div
              className="text-sm"
              style={{ color: 'var(--color-text-muted)' }}
            >
              {date} · {time}
            </div>
            <div
              className="text-xs mt-1"
              style={{ color: 'var(--color-text-hint)' }}
            >
              д-р {doctor.name.replace(/^д-р\s*/i, '')}
            </div>
          </div>
        </div>

        {/* Sections */}
        <DiagnosesSection
          osnovnaDiagnoza={fields.osnovna_diagnoza || ''}
          osnovnaMkb={fields.osnovna_mkb || ''}
          pridruzhavashti={fields.pridruzhavashti || []}
          onChangeOsnovna={(diag, mkb) => {
            onUpdate('osnovna_diagnoza', diag);
            onUpdate('osnovna_mkb', mkb);
          }}
          onChangePridruzhavashti={(arr) =>
            onUpdate('pridruzhavashti', arr)
          }
        />

        <Section id="sec-anamneza" title="Анамнеза">
          <EditableField
            value={fields.anamneza || ''}
            onChange={(v) => onUpdate('anamneza', v)}
          />
        </Section>

        <Section id="sec-obektivno" title="Обективен статус">
          <EditableField
            value={fields.obektivno || ''}
            onChange={(v) => onUpdate('obektivno', v)}
          />
        </Section>

        <Section id="sec-izsledvania" title="Изследвания">
          <EditableField
            value={fields.izsledvania || ''}
            onChange={(v) => onUpdate('izsledvania', v)}
          />
        </Section>

        <Section id="sec-terapia" title="Терапия">
          <EditableField
            value={fields.terapia || ''}
            onChange={(v) => onUpdate('terapia', v)}
          />
        </Section>

        <Section id="sec-meds" title="Медикаменти">
          <MedsPlaceholder count={fields.medications_list?.length || 0} />
        </Section>

        {hasDocs && (
          <Section id="sec-izdadeni" title="Издадени документи">
            {fields.napravlenia && fields.napravlenia.trim() && (
              <SubSection id="sec-napravlenia" title="📋 Направления">
                <EditableField
                  value={fields.napravlenia || ''}
                  onChange={(v) => onUpdate('napravlenia', v)}
                />
              </SubSection>
            )}
            {fields.naznacheni && fields.naznacheni.trim() && (
              <SubSection id="sec-naznacheni" title="🔬 Назначени изследвания">
                <EditableField
                  value={fields.naznacheni || ''}
                  onChange={(v) => onUpdate('naznacheni', v)}
                />
              </SubSection>
            )}
          </Section>
        )}

        {fields._disclaimer && (
          <div
            className="mt-8 pt-5 border-t text-xs italic"
            style={{
              borderColor: 'var(--color-border)',
              color: 'var(--color-text-hint)',
            }}
          >
            {fields._disclaimer}
          </div>
        )}
      </div>
    </main>
  );
}

/* ─────────────────────────────────────────────────────────────── */
/* SECTIONS                                                       */
/* ─────────────────────────────────────────────────────────────── */

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="mb-7 scroll-mt-24">
      <h2
        className="text-xl font-medium mb-3 font-[family-name:var(--font-cormorant)]"
        style={{ color: 'var(--color-brand)' }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

function SubSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="mt-5 scroll-mt-24">
      <div
        className="text-sm font-semibold uppercase tracking-wider mb-2"
        style={{ color: 'var(--color-brand)' }}
      >
        {title}
      </div>
      {children}
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────── */
/* DIAGNOSES SECTION                                              */
/* ─────────────────────────────────────────────────────────────── */

function DiagnosesSection({
  osnovnaDiagnoza,
  osnovnaMkb,
  pridruzhavashti,
  onChangeOsnovna,
  onChangePridruzhavashti,
}: {
  osnovnaDiagnoza: string;
  osnovnaMkb: string;
  pridruzhavashti: ComorbidDiagnosis[];
  onChangeOsnovna: (diag: string, mkb: string) => void;
  onChangePridruzhavashti: (arr: ComorbidDiagnosis[]) => void;
}) {
  function updateComorbid(idx: number, key: 'diagnoza' | 'mkb', value: string) {
    const next = pridruzhavashti.map((d, i) =>
      i === idx ? { ...d, [key]: value } : d
    );
    onChangePridruzhavashti(next);
  }

  function addComorbid() {
    onChangePridruzhavashti([
      ...pridruzhavashti,
      { diagnoza: '', mkb: '' },
    ]);
  }

  function removeComorbid(idx: number) {
    onChangePridruzhavashti(pridruzhavashti.filter((_, i) => i !== idx));
  }

  const hasAny = osnovnaDiagnoza || pridruzhavashti.length > 0;

  return (
    <section id="section-diag" className="mb-7 scroll-mt-24">
      <h2
        className="text-xl font-medium mb-3 font-[family-name:var(--font-cormorant)]"
        style={{ color: 'var(--color-brand)' }}
      >
        Диагнози МКБ-10
      </h2>

      {!hasAny && (
        <div
          className="italic text-sm mb-4"
          style={{ color: 'var(--color-text-hint)' }}
        >
          Не е открита диагноза в транскрипта. Добави основна диагноза по-долу.
        </div>
      )}

      {/* Primary diagnosis */}
      <div className="mb-4">
        <div
          className="text-xs uppercase tracking-wider mb-2 font-medium"
          style={{ color: 'var(--color-text-hint)' }}
        >
          Основна диагноза
        </div>
        <DiagRow
          diagnoza={osnovnaDiagnoza}
          mkb={osnovnaMkb}
          onChange={(diag, mkb) => onChangeOsnovna(diag, mkb)}
        />
      </div>

      {/* Comorbidities */}
      {pridruzhavashti.length > 0 && (
        <div className="mb-4">
          <div
            className="text-xs uppercase tracking-wider mb-2 font-medium"
            style={{ color: 'var(--color-text-hint)' }}
          >
            Придружаващи заболявания
          </div>
          {pridruzhavashti.map((d, i) => (
            <DiagRow
              key={i}
              diagnoza={d.diagnoza}
              mkb={d.mkb}
              onChange={(diag, mkb) => {
                updateComorbid(i, 'diagnoza', diag);
                updateComorbid(i, 'mkb', mkb);
              }}
              onRemove={() => removeComorbid(i)}
            />
          ))}
        </div>
      )}

      <button
        onClick={addComorbid}
        className="text-sm px-3 py-1.5 rounded-md border transition hover:bg-[var(--color-brand-light)]"
        style={{
          borderColor: 'var(--color-border-mid)',
          color: 'var(--color-text-muted)',
        }}
      >
        + Добави придружаващо
      </button>
    </section>
  );
}

function DiagRow({
  diagnoza,
  mkb,
  onChange,
  onRemove,
}: {
  diagnoza: string;
  mkb: string;
  onChange: (diag: string, mkb: string) => void;
  onRemove?: () => void;
}) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <input
        type="text"
        value={diagnoza}
        onChange={(e) => onChange(e.target.value, mkb)}
        placeholder="Диагноза"
        className="flex-1 px-3 py-2 rounded-md border outline-none focus:ring-1"
        style={{
          borderColor: 'var(--color-border-mid)',
          background: 'white',
        }}
      />
      <input
        type="text"
        value={mkb}
        onChange={(e) => onChange(diagnoza, e.target.value)}
        placeholder="МКБ"
        className="w-24 px-3 py-2 rounded-md border outline-none focus:ring-1 font-[family-name:var(--font-jetbrains)] text-sm uppercase"
        style={{
          borderColor: 'var(--color-border-mid)',
          background: 'white',
          color: 'var(--color-gold)',
          fontWeight: 600,
        }}
      />
      {onRemove && (
        <button
          onClick={onRemove}
          aria-label="Премахни"
          className="w-8 h-8 rounded-md text-lg leading-none transition hover:bg-[var(--color-brand-light)]"
          style={{ color: 'var(--color-text-hint)' }}
        >
          ×
        </button>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────── */
/* EDITABLE TEXT FIELD                                            */
/* ─────────────────────────────────────────────────────────────── */

function EditableField({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus();
      autoResize(textareaRef.current);
      textareaRef.current.setSelectionRange(0, 0);
    }
  }, [editing]);

  function commit() {
    setEditing(false);
    if (draft !== value) onChange(draft);
  }

  if (editing) {
    return (
      <textarea
        ref={textareaRef}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          autoResize(e.currentTarget);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setDraft(value);
            setEditing(false);
          }
        }}
        className="w-full p-3 rounded-md border outline-none"
        style={{
          borderColor: 'var(--color-brand)',
          fontFamily: 'inherit',
          fontSize: '15px',
          lineHeight: '1.6',
          resize: 'none',
          minHeight: '60px',
          background: 'white',
        }}
      />
    );
  }

  const hasContent = value && value.trim().length > 0;
  return (
    <div
      onClick={() => setEditing(true)}
      className="cursor-text rounded-md p-3 transition hover:bg-[var(--color-brand-light)]"
      style={{
        color: hasContent ? 'var(--color-text)' : 'var(--color-text-hint)',
        minHeight: '40px',
      }}
      title="Кликни за редакция"
    >
      {hasContent ? (
        <div
          className="whitespace-pre-wrap"
          style={{ fontSize: '15px', lineHeight: '1.6' }}
        >
          {value}
        </div>
      ) : (
        <em className="italic text-sm">
          {placeholder || 'Не е споменато — кликни за редакция'}
        </em>
      )}
    </div>
  );
}

function autoResize(el: HTMLTextAreaElement) {
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

/* ─────────────────────────────────────────────────────────────── */
/* MEDS PLACEHOLDER (full panel ships in C4b)                     */
/* ─────────────────────────────────────────────────────────────── */

function MedsPlaceholder({ count }: { count: number }) {
  return (
    <div
      className="rounded-md p-4 text-sm"
      style={{
        background: 'var(--color-bg)',
        color: 'var(--color-text-muted)',
      }}
    >
      {count > 0 ? (
        <>
          Открити <strong>{count}</strong> медикамент
          {count === 1 ? '' : 'а'} в терапията. Пълният панел с проверка за
          безопасност и редактиране идва в C4b.
        </>
      ) : (
        <>
          Не са открити медикаменти в транскрипта. Панелът за добавяне идва в
          C4b.
        </>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────── */
/* RIGHT PANEL                                                    */
/* ─────────────────────────────────────────────────────────────── */

function RightPanel({
  onNewRecord,
  onLogout,
}: {
  onNewRecord: () => void;
  onLogout: () => void;
}) {
  return (
    <aside className="print:hidden">
      <div className="sticky top-20 flex flex-col gap-4">
        <div
          className="rounded-xl p-4"
          style={{
            background: 'var(--color-bg-card)',
            borderColor: 'var(--color-border)',
            borderWidth: 1,
          }}
        >
          <div
            className="text-xs uppercase tracking-wider mb-3 font-medium"
            style={{ color: 'var(--color-text-hint)' }}
          >
            Действия
          </div>
          <button
            onClick={onNewRecord}
            className="w-full px-3 py-2 rounded-md text-sm text-white font-medium transition hover:opacity-90 mb-2"
            style={{ background: 'var(--gradient-brand)' }}
          >
            + Нова консултация
          </button>
          <button
            onClick={onLogout}
            className="w-full px-3 py-2 rounded-md text-sm transition hover:bg-[var(--color-brand-light)]"
            style={{ color: 'var(--color-text-muted)' }}
          >
            Изход
          </button>
        </div>

        <div
          className="rounded-xl p-4 text-xs"
          style={{
            background: 'var(--color-bg)',
            color: 'var(--color-text-hint)',
            borderColor: 'var(--color-border)',
            borderWidth: 1,
          }}
        >
          Меdикаменти + безопасност идват в C4b. PDF/Word експорт в C4c.
        </div>
      </div>
    </aside>
  );
}

/* ─────────────────────────────────────────────────────────────── */
/* PLAIN-TEXT COPY                                                */
/* ─────────────────────────────────────────────────────────────── */

function buildPlainText(f: TranscribeFields, doctor: DoctorInfo | null): string {
  const date = new Date().toLocaleDateString('bg-BG');
  const lines: string[] = [];
  lines.push('АМБУЛАТОРЕН ЛИСТ');
  lines.push(`Дата: ${date}`);
  if (doctor) lines.push(`Лекар: д-р ${doctor.name.replace(/^д-р\s*/i, '')}`);
  lines.push('');

  if (f.osnovna_diagnoza) {
    lines.push('ДИАГНОЗИ МКБ-10');
    lines.push(`Основна: ${f.osnovna_diagnoza}${f.osnovna_mkb ? ` (${f.osnovna_mkb})` : ''}`);
    if (f.pridruzhavashti && f.pridruzhavashti.length > 0) {
      f.pridruzhavashti.forEach((d) => {
        lines.push(`Придружаваща: ${d.diagnoza}${d.mkb ? ` (${d.mkb})` : ''}`);
      });
    }
    lines.push('');
  }

  if (f.anamneza) {
    lines.push('АНАМНЕЗА');
    lines.push(f.anamneza);
    lines.push('');
  }
  if (f.obektivno) {
    lines.push('ОБЕКТИВЕН СТАТУС');
    lines.push(f.obektivno);
    lines.push('');
  }
  if (f.izsledvania) {
    lines.push('ИЗСЛЕДВАНИЯ');
    lines.push(f.izsledvania);
    lines.push('');
  }
  if (f.terapia) {
    lines.push('ТЕРАПИЯ');
    lines.push(f.terapia);
    lines.push('');
  }
  if (f.napravlenia) {
    lines.push('НАПРАВЛЕНИЯ');
    lines.push(f.napravlenia);
    lines.push('');
  }
  if (f.naznacheni) {
    lines.push('НАЗНАЧЕНИ ИЗСЛЕДВАНИЯ');
    lines.push(f.naznacheni);
    lines.push('');
  }

  return lines.join('\n').trim();
}
