'use client';

// Patient context strip shown above the recording UI (/app/scribe) and
// the result document (/app/scribe/result). Reads from the `tuber_pending_visit`
// sessionStorage payload that /app/new-visit writes before navigating into the
// recording flow.

import RevealEgnButton from './RevealEgnButton';
import { ageFromBirthDate } from '@/lib/age';
import type { PendingVisit, VisitType } from '@/lib/types';

interface PatientHeaderStripProps {
  pending: PendingVisit;
}

export default function PatientHeaderStrip({ pending }: PatientHeaderStripProps) {
  const p = pending.patient;
  const name = [p.first_name, p.middle_name, p.last_name].filter(Boolean).join(' ') || 'Пациент';
  const age  = ageFromBirthDate(p.birth_date);
  const genderLabel = p.gender === 'male'   ? 'мъж'
                    : p.gender === 'female' ? 'жена'
                    : p.gender === 'other'  ? 'друг'
                    : null;

  return (
    <div
      className="px-6 py-3 border-b no-print"
      style={{ background: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }}
    >
      <div className="max-w-6xl mx-auto flex flex-col gap-1.5">
        {/* Row 1 — identity + ID + visit pill */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span
            className="text-lg font-semibold"
            style={{ color: 'var(--color-ink)' }}
          >
            {name}
          </span>
          {age !== null && (
            <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
              {age} г.
            </span>
          )}
          {genderLabel && (
            <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
              · {genderLabel}
            </span>
          )}
          {p.national_id_type !== 'none' && (
            <>
              <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>·</span>
              <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                {p.national_id_type === 'egn' ? 'ЕГН' : p.national_id_type === 'lnch' ? 'ЛНЧ' : 'ID'}:
              </span>
              <RevealEgnButton patientId={p.id} last4={p.national_id_last4} />
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

        {/* Row 2 — clinical context (allergies + chronic conditions, with explicit empty states) */}
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-xs">
          <ContextField label="Алергии"  items={p.allergies}          emptyLabel="неустановени" />
          <ContextField label="Хронични" items={p.chronic_conditions} emptyLabel="няма" />
        </div>
      </div>
    </div>
  );
}

function ContextField({ label, items, emptyLabel }: { label: string; items: string[]; emptyLabel: string }) {
  const empty = items.length === 0;
  return (
    <div className="flex items-baseline gap-2 min-w-0">
      <span
        className="text-[10px] uppercase tracking-[0.18em] font-semibold flex-shrink-0"
        style={{ color: 'var(--color-text-hint)' }}
      >
        {label}
      </span>
      <span
        className="truncate"
        style={{
          color: empty ? 'var(--color-text-hint)' : 'var(--color-text-muted)',
        }}
      >
        {empty ? emptyLabel : items.join(', ')}
      </span>
    </div>
  );
}

function visitTypeLabel(t: VisitType): string {
  switch (t) {
    case 'first':      return 'Първичен';
    case 'followup':   return 'Контролен';
    case 'urgent':     return 'Спешен';
    case 'preventive': return 'Профилактичен';
    case 'remote':     return 'Дистанционен';
    default:           return t;
  }
}
