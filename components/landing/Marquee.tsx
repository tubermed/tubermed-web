// Slow infinite marquee of supported specialties (NOT fake partner logos —
// pre-launch honesty). CSS-only: pauses on hover, static under reduced-motion.
const SPECIALTIES = [
  'Общопрактикуващ лекар',
  'Кардиология',
  'Ендокринология',
  'Гастроентерология',
  'Неврология',
  'Пневмология',
  'Вътрешни болести',
  'Гинекология',
  'Урология',
  'Дерматология',
  'Ортопедия',
  'Психиатрия',
  'Педиатрия',
];

export function Marquee() {
  // duplicate the list so the -50% translate loops seamlessly
  const items = [...SPECIALTIES, ...SPECIALTIES];
  return (
    <section
      aria-label="Поддържани специалности"
      style={{ background: 'var(--lp-bg)', borderBlock: '1px solid var(--lp-border)' }}
    >
      <div className="py-7">
        <div className="lp-marquee">
          <div className="lp-marquee-track">
            {items.map((s, i) => (
              <span
                key={i}
                className="inline-flex items-center"
                aria-hidden={i >= SPECIALTIES.length ? true : undefined}
              >
                <span className="px-5 text-base font-semibold" style={{ color: 'var(--lp-navy)' }}>
                  {s}
                </span>
                <span aria-hidden="true" style={{ color: 'var(--lp-accent)' }}>•</span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
