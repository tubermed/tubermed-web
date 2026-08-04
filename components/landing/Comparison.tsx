import { Container, SectionHeading } from './ui';
import { Reveal } from './Reveal';

// Qualitative, defensible positioning rows only (no fabricated specs about
// competitors). It IS the brand's core positioning.
const ROWS: { feature: string; us: string; tm: string }[] = [
  { feature: 'Език', us: 'Английски, с превод', tm: 'Роден български + МКБ-10 на български' },
  // NOTE (2026-08-04): the 'Данни' row was REMOVED, not rewritten. It set a
  // claim about where competitors process data against a claim that ours was
  // handled entirely inside the EU. Our own AI step runs at a US provider, so
  // the contrast was false however our own cell is worded — swapping only our
  // side to the true storage claim leaves the implicature intact, which is the
  // same lie with deniability added. There is no honest version of this row
  // that does not invent a competitor spec, which the comment above forbids.
  // Do not restore it. (Deliberately paraphrased: quoting the old cells
  // verbatim here would trip scripts/eu-claims.test.ts, correctly.)
  { feature: 'Авторство', us: '-', tm: 'Лекарят одобрява преди всеки износ' },
  { feature: 'Пригоден за', us: 'Общия пазар', tm: 'Натоварените лекари в България' },
];

function Check() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function Comparison() {
  return (
    <section style={{ background: 'var(--lp-bg-soft)', borderBlock: '1px solid var(--lp-border)' }}>
      <Container className="py-20 md:py-28">
        <Reveal>
          <SectionHeading title="Американски скрайб срещу TuberMed" />
        </Reveal>

        <div className="mx-auto mt-12 max-w-4xl">
          {/* header (desktop) */}
          <div
            className="hidden grid-cols-[1.1fr_1fr_1fr] gap-3 px-2 pb-3 md:grid"
            aria-hidden="true"
          >
            <span />
            <span className="text-sm font-semibold" style={{ color: 'var(--lp-text-muted)' }}>
              Американски скрайб
            </span>
            <span className="text-sm font-bold" style={{ color: 'var(--lp-navy)' }}>
              TuberMed
            </span>
          </div>

          <div className="flex flex-col gap-3">
            {ROWS.map((row, i) => (
              <Reveal key={row.feature} delay={i * 70}>
                <div
                  className="grid grid-cols-1 gap-2 rounded-[var(--lp-radius)] bg-white p-4 md:grid-cols-[1.1fr_1fr_1fr] md:items-center md:gap-3"
                  style={{ border: '1px solid var(--lp-border)' }}
                >
                  <span className="text-base font-semibold" style={{ color: 'var(--lp-heading)' }}>
                    {row.feature}
                  </span>

                  <span className="text-sm" style={{ color: 'var(--lp-text-muted)' }}>
                    <span className="mr-2 font-semibold md:hidden" style={{ color: 'var(--lp-text-muted)' }}>
                      Американски:
                    </span>
                    {row.us}
                  </span>

                  <span
                    className="flex items-center gap-2 rounded-[var(--lp-radius-sm)] px-3 py-2 text-sm font-medium"
                    style={{ background: 'var(--lp-bg-tint)', color: 'var(--lp-navy)' }}
                  >
                    <span style={{ color: 'var(--lp-accent)' }}><Check /></span>
                    <span>
                      <span className="mr-1 font-bold md:hidden">TuberMed:</span>
                      {row.tm}
                    </span>
                  </span>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </Container>
    </section>
  );
}
