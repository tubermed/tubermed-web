// Static structured data for the landing page. Inline JSON only — no fetches.
// The FAQPage Q&As MUST stay byte-identical to the visible copy in Faq.tsx.

const FAQ_JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: [
    {
      '@type': 'Question',
      name: 'Ако AI сбърка, а аз подпиша - проблемът мой ли е?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Затова нищо не се експортира без вашето одобрение. Преглеждате и поправяте всяка чернова - вие сте авторът. TuberMed е помощник, не заместник.',
      },
    },
    {
      '@type': 'Question',
      name: 'Къде отиват данните на пациентите ми?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Цялата обработка е в EU инфраструктура (Франкфурт). Без прехвърляне към САЩ. DPA с всички доставчици.',
      },
    },
    {
      '@type': 'Question',
      name: 'Трябва ли да сменя софтуера или работния си процес?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Не. Записвате, преглеждате и копирате/експортирате готовия лист във вашия софтуер. Без обучение, без нови стъпки между пациентите.',
      },
    },
    {
      '@type': 'Question',
      name: 'Колко точен е българският?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Обучен е на българска медицинска терминология и жаргон. И понеже винаги преглеждате преди експорт, финалният текст е винаги ваш.',
      },
    },
    {
      '@type': 'Question',
      name: 'Колко струва?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Месечен абонамент според обема консултации. По време на пилота - индивидуална оферта. Свържете се за детайли.',
      },
    },
  ],
} as const;

const ORGANIZATION_JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'TuberMed',
  url: 'https://www.tubermed.com',
  logo: 'https://www.tubermed.com/brand/tubermed-tile.svg',
  email: 'contact@tubermed.com',
} as const;

export function JsonLd() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(FAQ_JSON_LD) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(ORGANIZATION_JSON_LD) }}
      />
    </>
  );
}
