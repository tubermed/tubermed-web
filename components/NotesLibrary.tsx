'use client';

// The identity-free notes library — every consultation the clinic has, newest
// first, grouped by day, filterable by status. This is the only path to a note
// older than today (the patients history view it replaces carried identity;
// this one carries none). Each row is the visit's auto-generated label: time,
// visit type, chief complaint, diagnosis once generated, status. Clicking a
// row re-opens the visit itself — the result page for filed notes, the scribe
// for in-flight ones (cold-start recovery renders from ?visit=).
//
// Owns the status vocabulary (STATUS_LABEL / StatusPill / visitHref) shared
// with the today rail.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { formatDateBg } from '@/lib/date';
import { visitTypeLabel } from '@/components/VisitHeaderStrip';
import type { ConsultationListItem } from '@/lib/types';
import SkeletonInput from './SkeletonInput';

const PAGE_SIZE = 20;

export const STATUS_LABEL: Record<string, { text: string; tone: 'pending' | 'active' | 'done' | 'error' }> = {
  pending:   { text: 'Подготовка',  tone: 'pending' },
  started:   { text: 'В ход',       tone: 'active'  },
  retrying:  { text: 'Обработва се', tone: 'active' },
  generated: { text: 'Готов',       tone: 'done'    },
  exported:  { text: 'Изнесен',     tone: 'done'    },
  abandoned: { text: 'Прекратен',   tone: 'error'   },
  error:     { text: 'Грешка',      tone: 'error'   },
};

// Status filter chips — 'all' plus the settled statuses a doctor actually
// hunts for (a transient 'retrying' row still shows under "Всички").
const FILTERS: Array<{ value: string | null; label: string }> = [
  { value: null,        label: 'Всички' },
  { value: 'generated', label: 'Готови' },
  { value: 'exported',  label: 'Изнесени' },
  { value: 'error',     label: 'Грешка' },
  { value: 'abandoned', label: 'Прекратени' },
];

// Where a row click lands. Filed notes open on the result page; in-flight
// visits land back on the scribe; abandoned rows are non-interactive (recovery
// would only bounce them to /app/new-visit with a notice).
export function visitHref(status: string, id: string): string | null {
  if (status === 'generated' || status === 'exported') return `/app/scribe/result?visit=${id}`;
  if (status === 'abandoned') return null;
  return `/app/scribe?visit=${id}`;
}

export default function NotesLibrary() {
  const [items, setItems]       = useState<ConsultationListItem[]>([]);
  const [total, setTotal]       = useState(0);
  const [hasMore, setHasMore]   = useState(false);
  const [loading, setLoading]   = useState(true);
  const [err, setErr]           = useState<string | null>(null);
  // The pending fetch descriptor. Event handlers flip `loading` and swap this
  // object; the effect below only does the async work (every setState in it
  // runs after the await — no synchronous setState-in-effect).
  const [req, setReq] = useState<{ offset: number; status: string | null; append: boolean }>(
    { offset: 0, status: null, append: false },
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.listConsultations({
          offset: req.offset,
          limit: PAGE_SIZE,
          status: req.status ?? undefined,
        });
        if (cancelled) return;
        setItems((prev) => (req.append ? [...prev, ...res.consultations] : res.consultations));
        setTotal(res.total);
        setHasMore(res.has_more);
        setErr(null);
      } catch (e) {
        if (!cancelled) setErr(e instanceof ApiError ? e.message : 'Грешка при зареждане');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [req]);

  const applyFilter = useCallback((value: string | null) => {
    setLoading(true);
    setReq({ offset: 0, status: value, append: false });
  }, []);

  const loadMore = useCallback(() => {
    setLoading(true);
    setReq((prev) => ({ offset: items.length, status: prev.status, append: true }));
  }, [items.length]);

  // Group the loaded rows by Sofia calendar day, preserving the newest-first
  // order. Sofia (not browser-local) so the grouping matches the backend's
  // day windows.
  const groups: Array<{ key: string; rows: ConsultationListItem[] }> = [];
  for (const item of items) {
    const key = sofiaDayKey(item.created_at);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.rows.push(item);
    else groups.push({ key, rows: [item] });
  }
  const todayKey = sofiaDayKey(new Date().toISOString());

  return (
    <section
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
            <path d="M4 19.5A2.5 2.5 0 016.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
          </svg>
        </span>
        <div className="flex flex-col min-w-0">
          <span className="text-[10px] uppercase tracking-[0.18em] font-medium" style={{ color: 'var(--color-text-muted-new)' }}>
            Прегледи
          </span>
          <span className="text-sm font-semibold leading-tight truncate" style={{ color: 'var(--color-heading)' }}>
            Всички документи
          </span>
        </div>
        <div className="flex-1" />
        {total > 0 && (
          <span
            className="text-sm tabular-nums px-2 py-0.5 rounded-md flex-shrink-0"
            style={{ background: 'var(--color-accent-soft)', color: 'var(--color-accent)' }}
          >
            {total}
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5 px-4 pt-3">
        {FILTERS.map((f) => {
          const active = req.status === f.value;
          return (
            <button
              key={f.label}
              type="button"
              onClick={() => applyFilter(f.value)}
              className="px-2.5 py-1 rounded-full text-xs font-medium transition focus-ring"
              style={{
                background: active ? 'var(--color-brand)' : 'transparent',
                color:      active ? 'white' : 'var(--color-text-muted)',
                border:     `1px solid ${active ? 'var(--color-brand)' : 'var(--color-border-mid)'}`,
              }}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      <div className="px-2 py-2">
        {err && (
          <div className="px-2 py-3 text-xs" style={{ color: 'var(--color-danger)' }}>
            {err}
          </div>
        )}
        {!err && loading && items.length === 0 && (
          <div className="px-2 py-2" aria-hidden>
            <SkeletonLibraryRow />
            <SkeletonLibraryRow />
            <SkeletonLibraryRow />
          </div>
        )}
        {!err && !loading && items.length === 0 && (
          <div className="flex flex-col items-center text-center gap-2 px-4 py-8">
            <div className="text-xs leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
              Все още няма прегледи.
              <br />
              Готовите документи ще се появят тук.
            </div>
          </div>
        )}
        {groups.map((g) => (
          <div key={g.key}>
            <div className="px-2 pt-3 pb-1 text-[10px] uppercase tracking-[0.22em]" style={{ color: 'var(--color-text-muted)' }}>
              {g.key === todayKey ? 'Днес' : formatDateBg(g.key)}
            </div>
            {g.rows.map((item) => (
              <LibraryRow key={item.id} item={item} />
            ))}
          </div>
        ))}
        {hasMore && (
          <div className="px-2 py-2">
            <button
              type="button"
              onClick={loadMore}
              disabled={loading}
              className="w-full py-2 rounded-md text-xs font-medium transition focus-ring"
              style={{
                color: 'var(--color-brand)',
                border: '1px solid var(--color-border-mid)',
                background: 'transparent',
              }}
            >
              {loading ? 'Зареждане…' : 'Покажи още'}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

// The visit's auto-generated label as a row: time · complaint (or type) ·
// type + diagnosis context line · status pill. No identity, by design.
function LibraryRow({ item }: { item: ConsultationListItem }) {
  const status = STATUS_LABEL[item.status] ?? { text: item.status, tone: 'active' as const };
  const time = new Date(item.created_at).toLocaleTimeString('bg-BG', { hour: '2-digit', minute: '2-digit' });

  const complaint = item.chief_complaint?.trim() || null;
  const typeLabel = item.visit_type ? visitTypeLabel(item.visit_type) : null;
  const mainLabel = complaint ?? typeLabel ?? 'Преглед';
  const subParts = [complaint ? typeLabel : null, item.osnovna_diagnoza].filter(Boolean) as string[];

  const body = (
    <div className="flex items-center justify-between gap-2">
      <div className="min-w-0">
        <div className="text-xs tabular-nums" style={{ color: 'var(--color-text-muted)' }}>
          {time}
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
  );

  const href = visitHref(item.status, item.id);
  if (!href) {
    return <div className="relative pl-3 pr-2 py-2 rounded-md">{body}</div>;
  }
  return (
    <Link
      href={href}
      aria-label={`Отвори преглед от ${time}`}
      className="relative block pl-3 pr-2 py-2 rounded-md cursor-pointer transition-colors hover:bg-[var(--color-bg-subtle)] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[var(--color-accent)]"
    >
      {body}
    </Link>
  );
}

function SkeletonLibraryRow() {
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

export function StatusPill({ tone, children }: { tone: 'pending' | 'active' | 'done' | 'error'; children: React.ReactNode }) {
  const palette: Record<typeof tone, { bg: string; fg: string }> = {
    pending: { bg: 'var(--color-gold-soft)', fg: 'var(--color-gold)' },
    active:  { bg: 'var(--color-brand-soft)', fg: 'var(--color-brand)' },
    done:    { bg: 'var(--color-ok-soft)',   fg: 'var(--color-ok)' },
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

// Sofia calendar-day key (YYYY-MM-DD) — matches the backend's day windows
// (see CLAUDE.md Time convention).
function sofiaDayKey(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Sofia' }).format(new Date(iso));
}
