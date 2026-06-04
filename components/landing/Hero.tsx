import { Container, Eyebrow, Cta } from './ui';
import { Reveal } from './Reveal';
import { AmbientOrbs } from './AmbientOrbs';
import TuberMedHeroDesktop from './TuberMedHeroDesktop';

export function Hero() {
  return (
    <section className="relative overflow-hidden" style={{ background: 'var(--lp-bg)' }}>
      <AmbientOrbs />
      <Container className="relative z-10 grid items-center gap-12 py-16 md:py-24 lg:grid-cols-[0.92fr_1.08fr] lg:gap-10">
        <Reveal>
          <Eyebrow>AI медицински скрайб · България</Eyebrow>
          <h1
            className="font-[family-name:var(--font-inter-tight)] mt-5 text-4xl font-bold leading-[1.08] tracking-[-0.025em] sm:text-5xl md:text-6xl"
            style={{ color: 'var(--lp-ink)' }}
          >
            От разговор до амбулаторен лист{' '}
            <span style={{ color: 'var(--lp-accent)' }}>за секунди.</span>
          </h1>
          <p
            className="mt-6 max-w-xl text-lg leading-relaxed"
            style={{ color: 'var(--lp-text-muted)' }}
          >
            TuberMed записва консултацията и я превръща в готов, структуриран
            амбулаторен лист на български. Вие преглеждате, поправяте и
            одобрявате — за минута, не за вечер.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Cta href="#access" variant="primary">
              Заявка за достъп
            </Cta>
            <Cta href="#how" variant="secondary">
              Вижте как работи
            </Cta>
          </div>
          <p className="mt-7 text-sm font-medium" style={{ color: 'var(--lp-text-muted)' }}>
            GDPR-съвместим · Обработка в ЕС · Лекарят остава авторът
          </p>
        </Reveal>

        <Reveal delay={120}>
          {/* Dimitar's product walkthrough; loops continuously, static end-frame
              on mobile / reduced-motion. Swap-in point for a real <video>. */}
          <TuberMedHeroDesktop />
        </Reveal>
      </Container>
    </section>
  );
}
