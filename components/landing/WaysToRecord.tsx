import { Container, SectionHeading } from './ui';
import { Reveal } from './Reveal';

// Sits directly after HowItWorks on purpose: step 01 there says "В началото на
// консултацията натискате бутона за запис. После говорите както обикновено с
// пациента", which reads as live-only, patient-present. Both modes are real and
// Dimitar verified them on actual recordings, so the narrowing is corrected
// where the reader acquires it rather than several sections later.
//
// DELIBERATELY NO COMPARATIVE CLAIM. "Разпознава и двата режима" is verified;
// "еднакво добре" is a measurable claim nobody has measured. Do not add a
// quality, speed or accuracy comparison between dialogue and dictation here
// without a measurement to cite.
const MODES = [
  {
    icon: ClockIcon,
    title: 'По време на прегледа или след него',
    body: 'Запишете консултацията на живо в кабинета или продиктувайте амбулаторния лист, след като пациентът си тръгне.',
  },
  {
    icon: SpeechIcon,
    title: 'Диалог или монолог, изборът е Ваш',
    body: 'Системата разпознава както разговора с пациента, така и самостоятелното диктуване.',
  },
];

export function WaysToRecord() {
  return (
    <section id="modes" style={{ background: 'var(--lp-bg)' }}>
      <Container className="py-20 md:py-28">
        <Reveal>
          <SectionHeading title="Работи както работите Вие." />
        </Reveal>

        <div className="mt-14 grid gap-5 sm:grid-cols-2">
          {MODES.map((m, i) => (
            <Reveal key={m.title} delay={i * 90}>
              <article
                className="flex h-full gap-4 rounded-[var(--lp-radius)] p-6"
                style={{ background: 'var(--lp-bg-soft)', border: '1px solid var(--lp-border)' }}
              >
                <span
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--lp-radius-sm)]"
                  style={{ background: 'var(--lp-navy)', color: '#fff' }}
                >
                  <m.icon />
                </span>
                <div>
                  <h3 className="text-lg font-bold" style={{ color: 'var(--lp-heading)' }}>
                    {m.title}
                  </h3>
                  <p className="mt-2 text-base leading-relaxed" style={{ color: 'var(--lp-text-muted)' }}>
                    {m.body}
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

function ClockIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}
function SpeechIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 15V6a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H7l-4 3z" />
      <path d="M18 9h1a2 2 0 0 1 2 2v9l-3-2.5h-6a2 2 0 0 1-2-2V15" />
    </svg>
  );
}
