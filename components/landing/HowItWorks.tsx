import { Container, SectionHeading } from './ui';
import { Reveal } from './Reveal';

const STEPS = [
  {
    num: '01',
    title: 'Запис',
    body: 'В началото на консултацията натискате бутона за запис. После говорите както обикновено с пациента.',
  },
  {
    num: '02',
    title: 'AI обработка',
    body: 'TuberMed разпознава какво е казано и го подрежда: анамнеза, обективен статус, диагнози, МКБ-10 и терапия.',
  },
  {
    num: '03',
    title: 'Готов амбулаторен лист',
    body: 'Преглеждате, поправяте и копирате готовия лист направо в системата си. От 15 минути писане до 30 секунди преглед.',
  },
];

export function HowItWorks() {
  return (
    <section id="how" style={{ background: 'var(--lp-bg-soft)', borderBlock: '1px solid var(--lp-border)' }}>
      <Container className="py-20 md:py-28">
        <Reveal>
          <SectionHeading
            title="Три стъпки. Без обучение, без промяна в работата Ви."
          />
        </Reveal>

        <ol className="mt-14 grid gap-6 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <Reveal key={s.num} as="li" delay={i * 100}>
              <div
                className="flex h-full flex-col gap-4 rounded-[var(--lp-radius)] bg-white p-7"
                style={{ border: '1px solid var(--lp-border)', boxShadow: '0 1px 2px rgba(20,39,64,0.04)' }}
              >
                <span
                  className="font-[family-name:var(--font-inter-tight)] text-3xl font-bold tracking-tight"
                  style={{ color: 'var(--lp-accent)' }}
                >
                  {s.num}
                </span>
                <h3
                  className="font-[family-name:var(--font-inter-tight)] text-xl font-bold tracking-[-0.01em]"
                  style={{ color: 'var(--lp-heading)' }}
                >
                  {s.title}
                </h3>
                <p className="text-base leading-relaxed" style={{ color: 'var(--lp-text-muted)' }}>
                  {s.body}
                </p>
              </div>
            </Reveal>
          ))}
        </ol>
      </Container>
    </section>
  );
}
