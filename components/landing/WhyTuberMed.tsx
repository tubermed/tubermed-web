import { Container, SectionHeading } from './ui';
import { Reveal } from './Reveal';

const POINTS = [
  {
    icon: LockIcon,
    title: 'GDPR-съвместим',
    body: 'Цялата обработка е в EU инфраструктура (Франкфурт). Никакво прехвърляне на данни към САЩ. Договори за обработка на данни (DPA) с всички доставчици.',
  },
  {
    icon: LangIcon,
    title: 'Български медицински език',
    body: 'Обучен на българска медицинска терминология. Разпознава „палпаторна болезненост“ и „б.о.“ — без превод от английски.',
  },
  {
    icon: PillIcon,
    title: 'Безопасност на лекарствата',
    body: 'Автоматични предупреждения за алергии, противопоказания и взаимодействия между лекарствата от анамнезата на пациента.',
  },
  {
    icon: CodeIcon,
    title: 'МКБ-10 на български',
    body: 'Автоматично предлага най-подходящите МКБ-10 кодове на български, базирани на симптомите от консултацията.',
  },
];

export function WhyTuberMed() {
  return (
    <section id="why" style={{ background: 'var(--lp-bg)' }}>
      <Container className="py-20 md:py-28">
        <Reveal>
          <SectionHeading title="Не е поредният американски скрайб. Направен за българската медицинска система." />
        </Reveal>

        <div className="mt-14 grid gap-5 sm:grid-cols-2">
          {POINTS.map((p, i) => (
            <Reveal key={p.title} delay={(i % 2) * 90}>
              <article
                className="flex h-full gap-4 rounded-[var(--lp-radius)] p-6"
                style={{ background: 'var(--lp-bg-soft)', border: '1px solid var(--lp-border)' }}
              >
                <span
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--lp-radius-sm)]"
                  style={{ background: 'var(--lp-navy)', color: '#fff' }}
                >
                  <p.icon />
                </span>
                <div>
                  <h3 className="text-lg font-bold" style={{ color: 'var(--lp-heading)' }}>
                    {p.title}
                  </h3>
                  <p className="mt-2 text-base leading-relaxed" style={{ color: 'var(--lp-text-muted)' }}>
                    {p.body}
                  </p>
                </div>
              </article>
            </Reveal>
          ))}
        </div>
      </Container>
    </section>
  );
}

function LockIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="10" width="16" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  );
}
function LangIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 5h10" />
      <path d="M9 3v2c0 4-2 7-5 9" />
      <path d="M6 9c0 2.5 2.5 4.5 6 5.5" />
      <path d="m13 21 4-9 4 9" />
      <path d="M14.5 18h5" />
    </svg>
  );
}
function PillIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="8" width="18" height="8" rx="4" />
      <path d="M12 8v8" />
    </svg>
  );
}
function CodeIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m9 8-4 4 4 4" />
      <path d="m15 8 4 4-4 4" />
    </svg>
  );
}
