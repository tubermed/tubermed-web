import { Container, SectionHeading } from './ui';
import { Reveal } from './Reveal';

const QA = [
  {
    q: 'Ако AI сбърка, а аз подпиша - проблемът мой ли е?',
    a: 'Затова нищо не се експортира без вашето одобрение. Преглеждате и поправяте всяка чернова - вие сте авторът. TuberMed е помощник, не заместник.',
  },
  {
    q: 'Къде отиват данните на пациентите ми?',
    a: 'Цялата обработка е в EU инфраструктура (Франкфурт). Без прехвърляне към САЩ. DPA с всички доставчици.',
  },
  {
    q: 'Трябва ли да сменя софтуера или работния си процес?',
    a: 'Не. Записвате, преглеждате и копирате/експортирате готовия лист във вашия софтуер. Без обучение, без нови стъпки между пациентите.',
  },
  {
    q: 'Колко точен е българският?',
    a: 'Обучен е на българска медицинска терминология и жаргон. И понеже винаги преглеждате преди експорт, финалният текст е винаги ваш.',
  },
  {
    q: 'Колко струва?',
    a: 'Месечен абонамент според обема консултации. По време на пилота - индивидуална оферта. Свържете се за детайли.',
  },
];

export function Faq() {
  return (
    <section id="faq" style={{ background: 'var(--lp-bg-soft)', borderBlock: '1px solid var(--lp-border)' }}>
      <Container className="py-20 md:py-28">
        <Reveal>
          <SectionHeading title="Често задавани въпроси" />
        </Reveal>

        <div className="lp-faq mx-auto mt-12 max-w-3xl space-y-3">
          {QA.map((item, i) => (
            <Reveal key={item.q} delay={i * 60}>
              <details
                className="group rounded-[var(--lp-radius)] bg-white"
                style={{ border: '1px solid var(--lp-border)' }}
              >
                <summary className="flex items-center justify-between gap-4 px-5 py-4">
                  <span className="text-base font-semibold" style={{ color: 'var(--lp-heading)' }}>
                    {item.q}
                  </span>
                  <span className="lp-faq-chev shrink-0" style={{ color: 'var(--lp-accent)' }} aria-hidden="true">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="m6 9 6 6 6-6" />
                    </svg>
                  </span>
                </summary>
                <p
                  className="px-5 pb-5 text-base leading-relaxed"
                  style={{ color: 'var(--lp-text-muted)' }}
                >
                  {item.a}
                </p>
              </details>
            </Reveal>
          ))}
        </div>
      </Container>
    </section>
  );
}
