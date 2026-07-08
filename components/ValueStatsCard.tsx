import type { ValueStats } from '@/lib/api';
import SkeletonInput from './SkeletonInput';
import { Icon } from '@/components/ui/Icon';

// B2 → minutes-saved. The value card at the top of /app/new-visit. HEADLINE is
// an honest time-saved number (per-visit + this-week roll-up); %-authored is the
// demoted secondary stat. Time saved = baseline manual-doc minutes − measured
// review/approve time, clamped ≥ 0 server-side (never fabricated, never negative).
//
// Honesty guardrails (never a discouraging / invented number):
//  - below MIN_NOTES this week → neutral encouraging line, no figure.
//  - notes ≥ MIN_NOTES but weekly saved < 1 min → fall back to the MEASURED
//    %-authored headline (an honest measured stat), never "спестихте 0 мин".
//  - estimate baseline is explicitly labeled „оценка"; a captured per-doctor
//    baseline drops the label.
const MIN_NOTES = 3;

// Whole-minute saved value → "≈ N ч" at/above an hour, else "≈ N мин".
function fmtSaved(min: number): string {
  if (min >= 60) return `≈ ${Math.round(min / 60)} ч`;
  return `≈ ${Math.round(min)} мин`;
}

export default function ValueStatsCard({
  stats,
  loading = false,
}: {
  stats: ValueStats | null;
  loading?: boolean;
}) {
  // No stats yet. While the fetch is in flight, paint a card-shaped skeleton so
  // the surface doesn't flash empty then pop in. Settled-with-no-stats (error)
  // still renders NOTHING — the card must NEVER break new-visit.
  if (!stats) {
    if (!loading) return null;
    return (
      <div
        className="rounded-xl border px-4 py-3 mb-6"
        style={{
          borderColor: 'var(--color-border-soft)',
          background: 'var(--color-accent-soft)',
        }}
        role="status"
        aria-busy="true"
        aria-label="Зареждане…"
      >
        <SkeletonInput height="16px" width="78%" />
        <SkeletonInput height="11px" width="92%" style={{ marginTop: 10 }} />
        <SkeletonInput height="11px" width="64%" style={{ marginTop: 6 }} />
      </div>
    );
  }

  const { thisWeek, today, lastNote, baselineMinutes, baselineSource } = stats;
  const building = thisWeek.notes < MIN_NOTES;
  const showSaved = !building && thisWeek.savedMinutes >= 1;
  // Fallback when they have notes but no meaningful saved figure yet.
  const showAuthoredOnly = !building && !showSaved && thisWeek.avgAuthoredPct != null;

  const baselineNote =
    baselineSource === 'doctor'
      ? `Спрямо Вашите ${baselineMinutes} мин ръчна документация на лист.`
      : `Оценка спрямо ≈${baselineMinutes} мин/лист ръчна документация.`;

  return (
    <div
      className="rounded-xl border px-4 py-3 mb-6"
      style={{
        borderColor: 'var(--color-border-soft)',
        background: 'var(--color-accent-soft)',
      }}
      role="status"
    >
      {building ? (
        <p className="text-sm flex items-start gap-1.5" style={{ color: 'var(--color-ink)' }}>
          <Icon name="pencil" className="flex-shrink-0 mt-0.5" /> Одобрете няколко прегледа и тук ще видите колко време Ви спестява TuberMed.
        </p>
      ) : showSaved ? (
        <>
          <p className="text-sm font-semibold" style={{ color: 'var(--color-heading)' }}>
            TuberMed Ви спести {fmtSaved(thisWeek.savedMinutes)} тази седмица ({thisWeek.notes}{' '}
            {thisWeek.notes === 1 ? 'преглед' : 'прегледа'}).
          </p>
          <p className="text-xs mt-1" style={{ color: 'var(--color-ink)' }}>
            {lastNote ? `Последен лист: спестени ${fmtSaved(lastNote.savedMinutes)}. ` : ''}
            {today.savedMinutes >= 1 ? `Днес: ${fmtSaved(today.savedMinutes)}. ` : ''}
            {thisWeek.avgAuthoredPct != null
              ? `TuberMed написа ~${thisWeek.avgAuthoredPct}% от текста.`
              : ''}
          </p>
          <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
            {baselineNote}
          </p>
        </>
      ) : showAuthoredOnly ? (
        <>
          <p className="text-sm font-semibold" style={{ color: 'var(--color-heading)' }}>
            TuberMed написа ~{thisWeek.avgAuthoredPct}% от документацията за {thisWeek.notes}{' '}
            {thisWeek.notes === 1 ? 'преглед' : 'прегледа'} тази седмица.
          </p>
          <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
            Измерено от Вашите редакции — частта от генерирания текст, която запазихте непроменена.
          </p>
        </>
      ) : (
        <p className="text-sm flex items-start gap-1.5" style={{ color: 'var(--color-ink)' }}>
          <Icon name="pencil" className="flex-shrink-0 mt-0.5" /> Одобрете няколко прегледа и тук ще видите колко време Ви спестява TuberMed.
        </p>
      )}
    </div>
  );
}
