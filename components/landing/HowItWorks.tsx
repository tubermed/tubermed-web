import { Container, SectionHeading } from './ui';
import { Reveal } from './Reveal';

const STEPS = [
  {
    num: '01',
    title: 'Запис',
    body: 'Преди консултацията натискате бутона за запис. Говорите както обикновено - с пациента, на български, с медицински жаргон.',
  },
  {
    num: '02',
    title: 'AI обработка',
    body: 'TuberMed транскрибира разговора в EU инфраструктура и структурира анамнеза, обективен статус, диагнози, МКБ-10 и терапия.',
  },
  {
    num: '03',
    title: 'Готов амбулаторен лист',
    body: 'Преглеждате, коригирате, експортирате като PDF или Word. От 15 минути писане до 30 секунди преглед.',
  },
];

export function HowItWorks() {
  return (
    <section id="how" style={{ background: 'var(--lp-bg-soft)', borderBlock: '1px solid var(--lp-border)' }}>
      <Container className="py-20 md:py-28">
        <Reveal>
          <SectionHeading
            title="Три стъпки. Без обучение. Без промяна на работния процес."
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
