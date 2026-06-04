import { Container, SectionHeading } from './ui';
import { Reveal } from './Reveal';

const POINTS = [
  {
    icon: EuIcon,
    text: 'Обработка изцяло в ЕС (Франкфурт) — без прехвърляне на данни към САЩ.',
  },
  {
    icon: DocIcon,
    text: 'Договори за обработка на данни (DPA) с всеки доставчик.',
  },
  {
    icon: ControlIcon,
    text: 'Вие контролирате какво се записва и какво се експортира; нищо не излиза без одобрение.',
  },
];

export function Security() {
  return (
    <section id="security" style={{ background: 'var(--lp-navy-deep)' }}>
      <Container className="py-20 md:py-28">
        <Reveal>
          <SectionHeading
            onDark
            title="Поверителността не е добавка. Тя е в основата."
          />
        </Reveal>

        <div className="mt-14 grid gap-5 md:grid-cols-3">
          {POINTS.map((p, i) => (
            <Reveal key={p.text} delay={i * 90}>
              <article
                className="flex h-full flex-col gap-4 rounded-[var(--lp-radius)] p-6"
                style={{ background: 'var(--lp-navy)', border: '1px solid var(--lp-border-navy)' }}
              >
                <span
                  className="flex h-11 w-11 items-center justify-center rounded-[var(--lp-radius-sm)]"
                  style={{ background: 'rgba(143,192,232,0.15)', color: 'var(--lp-accent-light)' }}
                >
                  <p.icon />
                </span>
                <p className="text-base leading-relaxed" style={{ color: 'var(--lp-on-navy)' }}>
                  {p.text}
                </p>
              </article>
            </Reveal>
          ))}
        </div>
      </Container>
    </section>
  );
}

function EuIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18" />
    </svg>
  );
}
function DocIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6M9 17h6" />
    </svg>
  );
}
function ControlIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}
