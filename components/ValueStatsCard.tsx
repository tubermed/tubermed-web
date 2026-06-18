import type { ValueStats } from '@/lib/api';

// B2 — the "% of notes TuberMed wrote" value card shown at the top of
// /app/new-visit. The headline is a MEASURED number (the share of generated
// note text the doctor filed unchanged), NOT a minutes/time-saved estimate.
//
// Honesty guardrail: below MIN_NOTES this week — or before any note has a
// measured fraction — show a neutral encouraging line, never a percentage. One
// heavily-edited first note must never render a discouraging "40%".
const MIN_NOTES = 3;

export default function ValueStatsCard({ stats }: { stats: ValueStats | null }) {
  // Loading or errored → render nothing. The card must NEVER break new-visit.
  if (!stats) return null;

  const { notes, avgAuthoredPct } = stats.thisWeek;
  const building = notes < MIN_NOTES || avgAuthoredPct == null;

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
        <p className="text-sm" style={{ color: 'var(--color-ink)' }}>
          ✍️ Одобрете няколко прегледа и тук ще видите колко от документацията поема TuberMed.
        </p>
      ) : (
        <>
          <p className="text-sm font-semibold" style={{ color: 'var(--color-heading)' }}>
            TuberMed написа ~{avgAuthoredPct}% от документацията за {notes}{' '}
            {notes === 1 ? 'преглед' : 'прегледа'} тази седмица.
          </p>
          <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
            Измерено от Вашите редакции — частта от генерирания текст, която запазихте
            непроменена. Не е оценка за спестено време.
          </p>
        </>
      )}
    </div>
  );
}
