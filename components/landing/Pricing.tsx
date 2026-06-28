import { Container } from './ui';
import { Reveal } from './Reveal';
import { MagneticCta } from './MagneticCta';

export function Pricing() {
  return (
    <section id="pricing" style={{ background: 'var(--lp-bg)' }}>
      <Container className="py-20 md:py-28">
        <Reveal>
          <div
            className="mx-auto max-w-3xl rounded-2xl px-7 py-12 text-center md:px-14"
            style={{ background: 'var(--lp-bg-soft)', border: '1px solid var(--lp-border)' }}
          >
            <h2
              className="font-[family-name:var(--font-inter-tight)] text-3xl font-bold leading-[1.12] tracking-[-0.02em] md:text-[2.6rem]"
              style={{ color: 'var(--lp-heading)' }}
            >
              Сега набираме кабинети за пилот.
            </h2>
            <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed" style={{ color: 'var(--lp-text-muted)' }}>
              TuberMed е в ранна фаза. Приемаме заявки от избрани кабинети. Месечен
              абонамент според обема консултации, индивидуална оферта.
            </p>
            <div className="mt-8 flex justify-center">
              <MagneticCta href="#access">Заявка за достъп</MagneticCta>
            </div>
          </div>
        </Reveal>
      </Container>
    </section>
  );
}
