import { Container } from './ui';
import { Reveal } from './Reveal';
import { AccessForm } from './AccessForm';
import { AmbientOrbs } from './AmbientOrbs';

export function FinalCta() {
  return (
    <section id="access" className="relative overflow-hidden" style={{ background: 'var(--lp-navy-deep)' }}>
      <AmbientOrbs subtle />
      <Container className="relative z-10 grid items-center gap-12 py-20 md:py-28 lg:grid-cols-2 lg:gap-16">
        <Reveal>
          <h2
            className="font-[family-name:var(--font-inter-tight)] text-3xl font-bold leading-[1.12] tracking-[-0.02em] md:text-[2.6rem]"
            style={{ color: '#fff' }}
          >
            Върнете си прегледа.
          </h2>
          <p className="mt-5 max-w-md text-lg leading-relaxed" style={{ color: 'var(--lp-on-navy)' }}>
            Спрете да пишете амбулаторни листове на ръка. Започнете да преглеждате готови.
          </p>
        </Reveal>

        <Reveal delay={100}>
          <AccessForm />
        </Reveal>
      </Container>
    </section>
  );
}
