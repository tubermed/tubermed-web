import { Container, Cta } from './ui';
import { Reveal } from './Reveal';
import { AmbientOrbs } from './AmbientOrbs';
import { MagneticCta } from './MagneticCta';
import { Parallax } from './Parallax';
import TuberMedHeroDesktop from './TuberMedHeroDesktop';

export function Hero() {
  return (
    <section className="relative overflow-hidden" style={{ background: 'var(--lp-bg)' }}>
      <AmbientOrbs />
      {/* Asymmetric split: copy sits left in a narrower track, the product loop gets
          the wider track + room to grow into the right margin (see TuberMedHeroDesktop's
          height-aware fit, which reads [data-hero-copy] to match the copy column height). */}
      <Container className="relative z-10 grid items-center gap-12 py-16 md:py-24 lg:grid-cols-[minmax(0,44fr)_minmax(0,56fr)] lg:gap-8">
        <Reveal className="min-w-0">
          <div data-hero-copy>
            <h1
              className="font-[family-name:var(--font-inter-tight)] text-4xl font-bold leading-[1.08] tracking-[-0.025em] sm:text-5xl md:text-6xl"
              style={{ color: 'var(--lp-ink)' }}
            >
              От консултация до амбулаторен лист{' '}
              <span style={{ color: 'var(--lp-accent)' }}>за секунди.</span>
            </h1>
            <p
              className="mt-6 max-w-xl text-lg leading-relaxed"
              style={{ color: 'var(--lp-text-muted)' }}
            >
              TuberMed записва консултацията и я превръща в готов, структуриран
              амбулаторен лист на български. Преглеждате, поправяте и одобрявате
              за минута. Останалото време е за пациента.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <MagneticCta href="#access">Заявка за достъп</MagneticCta>
              <Cta href="#how" variant="secondary">
                Вижте как работи
              </Cta>
            </div>
            <p className="mt-7 text-sm font-medium" style={{ color: 'var(--lp-text-muted)' }}>
              GDPR-съвместим · Обработка в ЕС · Лекарят остава авторът
            </p>
          </div>
        </Reveal>

        <Reveal delay={120} className="min-w-0">
          {/* Dimitar's product walkthrough; loops continuously, static end-frame
              on mobile / reduced-motion. Swap-in point for a real <video>.
              min-w-0 stops the fixed-width mock from starving the copy column. */}
          <Parallax from={24} to={-24} className="min-w-0">
            <TuberMedHeroDesktop />
          </Parallax>
        </Reveal>
      </Container>
    </section>
  );
}
