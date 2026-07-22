'use client';

// Visit context strip shown above the recording UI (/app/scribe) and the
// result document (/app/scribe/result). Identity-free by design: it renders
// the visit's own metadata — staging time, visit type, chief complaint — from
// the `tuber_pending_visit` sessionStorage payload (or its cold-start-recovery
// reconstruction).

import type { PendingVisit, VisitType } from '@/lib/types';

interface VisitHeaderStripProps {
  pending: PendingVisit;
}

export default function VisitHeaderStrip({ pending }: VisitHeaderStripProps) {
  const startedAt = pending.created_at
    ? new Date(pending.created_at).toLocaleTimeString('bg-BG', { hour: '2-digit', minute: '2-digit' })
    : null;
  const chiefComplaint = pending.visit_metadata.chief_complaint;

  return (
    <div
      className="px-6 py-3 border-b no-print"
      style={{ background: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }}
    >
      <div className="max-w-6xl mx-auto flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="text-lg font-semibold" style={{ color: 'var(--color-ink)' }}>
            Преглед
          </span>
          {startedAt && (
            <>
              <Divider />
              <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                {startedAt}
              </span>
            </>
          )}
          {pending.visit_metadata.visit_type && (
            <span
              className="ml-auto text-[10px] uppercase tracking-wider px-2 py-0.5 rounded"
              style={{ background: 'var(--color-brand-soft)', color: 'var(--color-brand)' }}
            >
              {visitTypeLabel(pending.visit_metadata.visit_type)}
            </span>
          )}
        </div>

        {chiefComplaint && (
          <div className="flex items-baseline gap-2 text-xs min-w-0">
            <span
              className="text-[10px] uppercase tracking-[0.18em] font-semibold flex-shrink-0"
              style={{ color: 'var(--color-text-muted)' }}
            >
              Повод
            </span>
            <span className="truncate" style={{ color: 'var(--color-text-muted)' }}>
              {chiefComplaint}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function Divider() {
  return <span aria-hidden className="w-px h-3.5 self-center" style={{ background: 'var(--color-border)' }} />;
}

export function visitTypeLabel(t: VisitType): string {
  switch (t) {
    case 'first':      return 'Първичен';
    case 'followup':   return 'Контролен';
    case 'urgent':     return 'Спешен';
    case 'preventive': return 'Профилактичен';
    case 'remote':     return 'Дистанционен';
    default:           return t;
  }
}
