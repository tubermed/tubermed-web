import { Container, SectionHeading } from './ui';
import { Reveal } from './Reveal';

const PAINS = [
  {
    icon: ClockIcon,
    text: 'Гледате монитора, докато пациентът описва оплакванията си.',
  },
  {
    icon: PillsIcon,
    text: 'Пациенти с хронични заболявания и дълги списъци с лекарства - най-бавни за описване.',
  },
  {
    icon: ShieldIcon,
    text: 'Тихият страх: „Ако нещо липсва в амбулаторния лист, отговорността е моя.“',
  },
];

export function Problem() {
  return (
    <section style={{ background: 'var(--lp-bg)' }}>
      <Container className="py-20 md:py-28">
        <Reveal>
          <SectionHeading
            title="Пишете, докато пациентът говори."
            intro="Анамнеза, обективен статус, МКБ-10, терапия. Въвеждате всичко по време на самия преглед. Знаете го от всеки работен ден. Около 35% от времето Ви отива за документиране, а пред екран и бюро прекарвате почти двойно повече, отколкото със самия пациент."
          />
        </Reveal>

        <div className="mt-14 grid gap-5 md:grid-cols-3">
          {PAINS.map((p, i) => (
            <Reveal key={p.text} delay={i * 90}>
              <article
                className="flex h-full flex-col gap-4 rounded-[var(--lp-radius)] p-6"
                style={{ background: 'var(--lp-bg-soft)', border: '1px solid var(--lp-border)' }}
              >
                <span
                  className="flex h-11 w-11 items-center justify-center rounded-[var(--lp-radius-sm)]"
                  style={{ background: '#fff', border: '1px solid var(--lp-border)', color: 'var(--lp-accent)' }}
                >
                  <p.icon />
                </span>
                <p className="text-base leading-relaxed" style={{ color: 'var(--lp-text)' }}>
                  {p.text}
                </p>
              </article>
            </Reveal>
          ))}
        </div>

        <p className="mt-8 text-xs" style={{ color: 'var(--lp-text-muted)' }}>
          По данни на международни проучвания за разпределение на лекарското време (Applied Clinical Informatics 2018, Annals of Internal Medicine 2016).
        </p>
      </Container>
    </section>
  );
}

function ClockIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function PillsIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="9" width="11" height="6" rx="3" transform="rotate(-45 8.5 12)" />
      <circle cx="16.5" cy="16.5" r="4.5" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3Z" />
      <path d="M12 8v4" />
      <path d="M12 15.5h.01" />
    </svg>
  );
}
