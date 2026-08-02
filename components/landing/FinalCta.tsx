import { Container } from './ui';
import { Reveal } from './Reveal';
import { AccessForm } from './AccessForm';

export function FinalCta() {
  return (
    // `relative` stays, `overflow-hidden` goes. AccessForm's honeypot is
    // position:absolute at left:-9999px; while the reveal is mid-flight it
    // resolves against Reveal's transformed wrapper, but on the
    // reduced-motion path Reveal renders untransformed, so the section is the
    // only guaranteed containing block. Clipping is no longer needed for it —
    // measured with overflow visible, scrollWidth === clientWidth (overflow to
    // the left of the initial containing block is not scrollable in LTR).
    <section id="access" className="relative" style={{ background: 'var(--lp-navy-deep)' }}>
      <Container className="grid items-center gap-12 py-20 md:py-28 lg:grid-cols-2 lg:gap-16">
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
