'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import type { TodayResponse, TodayConsultation } from '@/lib/types';

interface TodayConsultationsProps {
  /** Bump this to force a refresh (e.g. after starting a visit). */
  refreshKey?: number;
  /** Optional: highlight a consultation_id as "current" (vertical accent bar). */
  currentConsultationId?: string | null;
}

const STATUS_LABEL: Record<string, { text: string; tone: 'pending' | 'active' | 'done' | 'error' }> = {
  pending:   { text: 'Подготовка',  tone: 'pending' },
  started:   { text: 'В ход',       tone: 'active'  },
  generated: { text: 'Готов',       tone: 'done'    },
  exported:  { text: 'Изнесен',     tone: 'done'    },
  abandoned: { text: 'Прекратен',   tone: 'error'   },
  error:     { text: 'Грешка',      tone: 'error'   },
};

export default function TodayConsultations({ refreshKey, currentConsultationId }: TodayConsultationsProps) {
  const [data, setData] = useState<TodayResponse | null>(null);
  const [err, setErr]   = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setErr(null);
    api.consultationsToday()
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setErr(e instanceof ApiError ? e.message : 'Грешка'); });
    return () => { cancelled = true; };
  }, [refreshKey]);

  const dateLabel = data?.date ? formatBgDate(data.date) : '';

  return (
    <aside
      className="rounded-xl flex flex-col"
      style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}
    >
      <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--color-border)' }}>
        <div>
          <div className="text-xs uppercase tracking-[0.18em]" style={{ color: 'var(--color-text-hint)' }}>
            График
          </div>
          <div
            className="text-sm font-medium font-[family-name:var(--font-cormorant)]"
            style={{ color: 'var(--color-text)' }}
          >
            {dateLabel}
          </div>
        </div>
        {data && (
          <div
            className="text-sm font-[family-name:var(--font-jetbrains)] px-2 py-0.5 rounded"
            style={{ background: 'var(--color-brand-soft)', color: 'var(--color-brand)' }}
          >
            {data.done}/{data.total}
          </div>
        )}
      </div>

      <div className="px-4 pt-3 text-[10px] uppercase tracking-[0.22em]" style={{ color: 'var(--color-text-hint)' }}>
        Днешен ден
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2 max-h-[60vh]">
        {err && (
          <div className="px-2 py-3 text-xs" style={{ color: 'var(--color-red)' }}>
            {err}
          </div>
        )}
        {!err && !data && (
          <div className="px-2 py-3 text-xs" style={{ color: 'var(--color-text-muted)' }}>
            Зареждане…
          </div>
        )}
        {data && data.consultations.length === 0 && (
          <div className="px-2 py-3 text-xs" style={{ color: 'var(--color-text-muted)' }}>
            Все още няма консултации днес.
          </div>
        )}
        {data && data.consultations.map((c) => (
          <Row key={c.id} item={c} isCurrent={c.id === currentConsultationId} />
        ))}
      </div>
    </aside>
  );
}

function Row({ item, isCurrent }: { item: TodayConsultation; isCurrent: boolean }) {
  const status = STATUS_LABEL[item.status] ?? { text: item.status, tone: 'active' as const };
  const time = new Date(item.created_at).toLocaleTimeString('bg-BG', { hour: '2-digit', minute: '2-digit' });
  const patientName = item.patient
    ? [item.patient.first_name, item.patient.last_name].filter(Boolean).join(' ')
    : 'Без пациент';

  return (
    <div className="relative pl-3 pr-2 py-2 rounded-md">
      {isCurrent && (
        <span
          className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full"
          style={{ background: 'var(--color-brand)' }}
        />
      )}
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div
            className="text-xs font-[family-name:var(--font-jetbrains)]"
            style={{ color: 'var(--color-text-muted)' }}
          >
            {time}
          </div>
          <div className="text-sm truncate" style={{ color: 'var(--color-text)' }}>
            {patientName}
          </div>
        </div>
        <StatusPill tone={status.tone}>{status.text}</StatusPill>
      </div>
    </div>
  );
}

function StatusPill({ tone, children }: { tone: 'pending' | 'active' | 'done' | 'error'; children: React.ReactNode }) {
  const palette: Record<typeof tone, { bg: string; fg: string }> = {
    pending: { bg: 'var(--color-gold-soft)', fg: 'var(--color-gold)' },
    active:  { bg: 'var(--color-brand-soft)', fg: 'var(--color-brand)' },
    done:    { bg: 'var(--color-ok-soft)',   fg: 'var(--color-ok)' },
    error:   { bg: '#FDECEA',                fg: 'var(--color-red)' },
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

function formatBgDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${m[3]}.${m[2]}.${m[1]}`;
}
