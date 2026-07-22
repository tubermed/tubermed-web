'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { formatDateBg } from '@/lib/date';
import { visitTypeLabel } from '@/components/VisitHeaderStrip';
import { STATUS_LABEL, StatusPill, visitHref } from '@/components/NotesLibrary';
import type { TodayResponse, TodayConsultation } from '@/lib/types';
import SkeletonInput from './SkeletonInput';

interface TodayConsultationsProps {
  /** Bump this to force a refresh (e.g. after starting a visit). */
  refreshKey?: number;
  /** Optional: highlight a consultation_id as "current" (vertical accent bar). */
  currentConsultationId?: string | null;
}

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
      className="nv-card-enter flex flex-col"
      style={{
        background: 'var(--color-bg-surface)',
        border: '1px solid var(--color-border-soft)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-raised)',
      }}
    >
      <div
        className="flex items-center gap-3 px-4 py-3"
        style={{
          background: 'var(--color-surface-tint)',
          borderBottom: '1px solid var(--color-border-soft)',
          borderTopLeftRadius: 'var(--radius-lg)',
          borderTopRightRadius: 'var(--radius-lg)',
        }}
      >
        <span
          aria-hidden
          className="flex items-center justify-center flex-shrink-0"
          style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--color-accent)', color: 'var(--color-bg-surface)' }}
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2.5v3M16 2.5v3" />
          </svg>
        </span>
        <div className="flex flex-col min-w-0">
          <span className="text-[10px] uppercase tracking-[0.18em] font-medium" style={{ color: 'var(--color-text-muted-new)' }}>
            График
          </span>
          <span className="text-sm font-semibold leading-tight truncate" style={{ color: 'var(--color-heading)' }}>
            {dateLabel || '—'}
          </span>
        </div>
        <div className="flex-1" />
        {data && (
          <span
            className="text-sm tabular-nums px-2 py-0.5 rounded-md flex-shrink-0"
            style={{ background: 'var(--color-accent-soft)', color: 'var(--color-accent)' }}
          >
            {data.done}/{data.total}
          </span>
        )}
      </div>

      <div className="px-4 pt-3 text-[10px] uppercase tracking-[0.22em]" style={{ color: 'var(--color-text-muted)' }}>
        Днешен ден
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2 max-h-[60vh]">
        {err && (
          <div className="px-2 py-3 text-xs" style={{ color: 'var(--color-danger)' }}>
            {err}
          </div>
        )}
        {!err && !data && (
          <div className="px-2 py-2" aria-hidden>
            <SkeletonRailRow />
            <SkeletonRailRow />
            <SkeletonRailRow />
            <SkeletonRailRow />
          </div>
        )}
        {data && data.consultations.length === 0 && (
          <div className="flex flex-col items-center text-center gap-2 px-4 py-8">
            <span aria-hidden style={{ color: 'var(--color-text-muted-new)' }}>
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2.5v3M16 2.5v3" />
              </svg>
            </span>
            <div className="text-xs leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
              Все още няма консултации днес.
              <br />
              Готовите прегледи ще се появят тук.
            </div>
          </div>
        )}
        {data && data.consultations.map((c, i) => (
          // /today returns the day ASC, so the ordinal is stable across refreshes.
          <Row key={c.id} item={c} ordinal={i + 1} isCurrent={c.id === currentConsultationId} />
        ))}
      </div>
    </aside>
  );
}

// Loading placeholder mirroring a real Row's footprint — a time line over a
// label line on the left, a status-pill box on the right, same pl-3 pr-2 py-2 —
// so the rail doesn't visibly jump when the consultations land.
function SkeletonRailRow() {
  return (
    <div className="relative flex items-center justify-between gap-2 pl-3 pr-2 py-2">
      <div className="flex flex-col gap-1.5 min-w-0 flex-1">
        <SkeletonInput height="11px" width="38px" />
        <SkeletonInput height="15px" width="62%" />
      </div>
      <SkeletonInput height="16px" width="58px" className="flex-shrink-0" style={{ borderRadius: 4 }} />
    </div>
  );
}

// Identity-free row — the visit's auto-generated label. A visit is identified
// by its per-day ordinal + staging time, described by its visit type + chief
// complaint, and (once generated) its diagnosis. No patient identity exists.
function Row({ item, ordinal, isCurrent }: { item: TodayConsultation; ordinal: number; isCurrent: boolean }) {
  const status = STATUS_LABEL[item.status] ?? { text: item.status, tone: 'active' as const };
  const time = new Date(item.created_at).toLocaleTimeString('bg-BG', { hour: '2-digit', minute: '2-digit' });

  const complaint = item.chief_complaint?.trim() || null;
  const typeLabel = item.visit_type ? visitTypeLabel(item.visit_type) : null;
  const mainLabel = complaint ?? typeLabel ?? 'Преглед';
  // Second context line: whichever of type/diagnosis is not already the main label.
  const subParts = [complaint ? typeLabel : null, item.osnovna_diagnoza].filter(Boolean) as string[];

  const body = (
    <>
      {isCurrent && (
        <span
          className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full"
          style={{ background: 'var(--color-brand)' }}
        />
      )}
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div
            className="text-xs tabular-nums"
            style={{ color: 'var(--color-text-muted)' }}
          >
            №{ordinal} · {time}
          </div>
          <div className="text-sm truncate" style={{ color: 'var(--color-text)' }}>
            {mainLabel}
          </div>
          {subParts.length > 0 && (
            <div className="text-xs truncate" style={{ color: 'var(--color-text-muted)' }}>
              {subParts.join(' · ')}
            </div>
          )}
        </div>
        <StatusPill tone={status.tone}>{status.text}</StatusPill>
      </div>
    </>
  );

  // Row click re-opens the visit itself (see visitHref in NotesLibrary — the
  // library owns the shared status vocabulary + destination logic).
  const href = visitHref(item.status, item.id);

  if (!href) {
    return <div className="relative pl-3 pr-2 py-2 rounded-md">{body}</div>;
  }

  return (
    <Link
      href={href}
      aria-label={`Отвори преглед №${ordinal} от ${time}`}
      className="relative block pl-3 pr-2 py-2 rounded-md cursor-pointer transition-colors hover:bg-[var(--color-bg-subtle)] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[var(--color-accent)]"
    >
      {body}
    </Link>
  );
}

function formatBgDate(iso: string): string {
  return formatDateBg(iso);
}
