import { Container } from './ui';
import { Reveal } from './Reveal';

export function AuthorTrust() {
  return (
    <section style={{ background: 'var(--lp-bg-soft)', borderBlock: '1px solid var(--lp-border)' }}>
      <Container className="grid items-center gap-12 py-20 md:py-28 lg:grid-cols-2 lg:gap-16">
        <Reveal>
          <h2
            className="font-[family-name:var(--font-inter-tight)] text-3xl font-bold leading-[1.12] tracking-[-0.02em] md:text-[2.6rem]"
            style={{ color: 'var(--lp-heading)' }}
          >
            Вие сте авторът. Винаги.
          </h2>
          <p className="mt-5 max-w-xl text-lg leading-relaxed" style={{ color: 'var(--lp-text-muted)' }}>
            TuberMed не поставя диагнози и не решава вместо Вас. Подготвя чернова,
            която Вие четете, променяте както пожелаете и одобрявате. Листът става
            готов едва след Вашето одобрение. Решението винаги остава Ваше.
          </p>
        </Reveal>

        <Reveal delay={120}>
          <NoteMock />
        </Reveal>
      </Container>
    </section>
  );
}

// Illustrative structured note with an editable field + a transcription-
// confidence notice. That notice is an AI-uncertainty surface — it says the
// dose could not be confirmed against the recording — so it is GOLD, never
// red: red is the clinical-alert palette, and a red card on a medicines
// section reads as a drug-safety warning whatever its wording says. Clinical
// alerts are off by ruling (2026-08-01); the colour is part of the claim.
// Anonymized/illustrative data ONLY — no real patient name, ЕГН, or
// identifiable case (per the brand compliance guardrails).
function NoteMock() {
  return (
    <div role="img" aria-label="Примерен структуриран амбулаторен лист с редактируеми полета и отбелязано място за проверка (илюстративни данни)." className="relative">
      <div
        className="rounded-2xl bg-white p-6"
        style={{ border: '1px solid var(--lp-border)', boxShadow: '0 24px 50px -28px rgba(20,39,64,0.35)' }}
        aria-hidden="true"
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--lp-navy)' }}>
            Амбулаторен лист
          </span>
          <span
            className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
            style={{ background: 'var(--lp-bg-tint)', color: 'var(--lp-navy)' }}
          >
            чернова
          </span>
        </div>

        {/* Section order mirrors the real /app/scribe/result note: diagnosis first. */}
        <dl className="mt-5 space-y-4">
          <Field label="Диагноза · МКБ-10" value="Есенциална (първична) хипертония · I10" />
          <Field label="Анамнеза" value="Главоболие и световъртеж от 3 дни. Хипертония в анамнезата." editable />
          <Field label="Обективен статус" value="RR: 150/95 mmHg · ЧСС: 82/min · t°: 36.6°C" />
          <Field label="Терапия" value="Периндоприл 5 mg · Ибупрофен при болка" editable />
        </dl>
      </div>

      {/* transcription-confidence notice — gold, and an octagon rather than the
          warning triangle, matching the same notice in TuberMedHeroLoop.tsx */}
      <div
        className="mt-4 rounded-[var(--lp-radius)] p-4 sm:absolute sm:-bottom-6 sm:right-3 sm:mt-0 sm:max-w-[19rem]"
        style={{ background: 'var(--lp-warn-soft)', border: '1px solid var(--lp-warn-border)', boxShadow: '0 16px 36px -16px rgba(20,39,64,0.35)' }}
        aria-hidden="true"
      >
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5" style={{ color: 'var(--lp-warn-ink)' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86" />
              <path d="M12 8v4" />
              <path d="M12 16h.01" />
            </svg>
          </span>
          <div>
            <p className="text-xs font-bold" style={{ color: 'var(--lp-warn-ink)' }}>
              За проверка · несигурно разчитане
            </p>
            <p className="mt-1 text-xs leading-snug" style={{ color: 'var(--lp-text)' }}>
              Дозата на ибупрофен не се потвърждава от записа на прегледа.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, editable = false }: { label: string; value: string; editable?: boolean }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold" style={{ color: 'var(--lp-accent)' }}>
        {label}
      </dt>
      <dd
        className="mt-1 flex items-start justify-between gap-2 rounded-md px-2 py-1.5 text-sm leading-snug"
        style={{
          color: 'var(--lp-text)',
          background: editable ? 'var(--lp-bg-soft)' : 'transparent',
          border: editable ? '1px dashed var(--lp-border)' : '1px solid transparent',
        }}
      >
        <span>{value}</span>
        {editable ? (
          <span className="shrink-0" style={{ color: 'var(--lp-text-muted)' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
          </span>
        ) : null}
      </dd>
    </div>
  );
}
