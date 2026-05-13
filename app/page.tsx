import Link from 'next/link';

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col">
      <Nav />
      <Hero />
      <HowItWorks />
      <WhyTuberMed />
      <Pricing />
      <FinalCta />
      <Footer />
    </div>
  );
}

/* ────────────────────────────────────────────────────────────── */

function Nav() {
  return (
    <nav
      className="sticky top-0 z-50 backdrop-blur-md border-b"
      style={{
        background: 'rgba(246, 241, 236, 0.85)',
        borderColor: 'var(--color-border)',
      }}
    >
      <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
        <Link
          href="/"
          className="text-2xl font-semibold font-[family-name:var(--font-cormorant)]"
          style={{ color: 'var(--color-brand)' }}
        >
          TuberMed
        </Link>
        <div className="flex items-center gap-3">
          <a
            href="#how"
            className="hidden sm:inline text-sm hover:underline px-2 py-1"
            style={{ color: 'var(--color-text-muted)' }}
          >
            Как работи
          </a>
          <a
            href="#why"
            className="hidden sm:inline text-sm hover:underline px-2 py-1"
            style={{ color: 'var(--color-text-muted)' }}
          >
            Защо TuberMed
          </a>
          <Link
            href="/app/login"
            className="text-sm px-4 py-2 rounded-md text-white font-medium transition hover:opacity-90"
            style={{ background: 'var(--gradient-brand)' }}
          >
            Вход
          </Link>
        </div>
      </div>
    </nav>
  );
}

/* ────────────────────────────────────────────────────────────── */

function Hero() {
  return (
    <section className="px-6 pt-24 pb-32">
      <div className="max-w-4xl mx-auto text-center">
        <span
          className="inline-block text-xs uppercase tracking-widest mb-6 px-3 py-1 rounded-full"
          style={{
            background: 'var(--color-brand-soft)',
            color: 'var(--color-brand)',
          }}
        >
          AI Медицински скрайб · България
        </span>

        <h1
          className="text-5xl md:text-7xl font-semibold mb-6 leading-[1.1] font-[family-name:var(--font-cormorant)]"
          style={{ color: 'var(--color-brand)' }}
        >
          От разговор до амбулаторен лист
          <br />
          <em className="italic" style={{ color: 'var(--color-brand-mid)' }}>
            за секунди.
          </em>
        </h1>

        <p
          className="text-lg md:text-xl mb-10 max-w-2xl mx-auto leading-relaxed"
          style={{ color: 'var(--color-text-muted)' }}
        >
          AI скрайб за български лекари в частната практика. Записвай консултациите,
          получавай готови, структурирани амбулаторни листове.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/app/login"
            className="px-7 py-3.5 rounded-md text-white font-medium transition hover:opacity-90"
            style={{ background: 'var(--gradient-brand)' }}
          >
            Вход за лекари →
          </Link>
          <a
            href="mailto:contact@tubermed.com?subject=Заявка за достъп до TuberMed"
            className="px-7 py-3.5 rounded-md font-medium border transition hover:bg-white"
            style={{
              borderColor: 'var(--color-border-mid)',
              color: 'var(--color-text)',
            }}
          >
            Заявка за достъп
          </a>
        </div>

        <p className="text-xs mt-8" style={{ color: 'var(--color-text-hint)' }}>
          GDPR-съвместим · EU инфраструктура · Без прехвърляне на данни към САЩ
        </p>
      </div>
    </section>
  );
}

/* ────────────────────────────────────────────────────────────── */

function HowItWorks() {
  const steps = [
    {
      num: '01',
      title: 'Запис',
      body: 'Преди консултацията натискаш бутона за запис. Лекарят говори както обикновено — с пациента, на български, с медицински жаргон.',
    },
    {
      num: '02',
      title: 'AI обработка',
      body: 'TuberMed транскрибира разговора в EU инфраструктура и структурира анамнеза, обективен статус, диагнози, МКБ-10 и терапия.',
    },
    {
      num: '03',
      title: 'Готов амбулаторен лист',
      body: 'Проверяваш, коригираш, експортираш като PDF или Word. От 15 минути писане до 30 секунди преглед.',
    },
  ];

  return (
    <section
      id="how"
      className="px-6 py-24"
      style={{ background: 'var(--color-bg-card)' }}
    >
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-16">
          <h2
            className="text-4xl md:text-5xl font-semibold mb-4 font-[family-name:var(--font-cormorant)]"
            style={{ color: 'var(--color-brand)' }}
          >
            Как работи
          </h2>
          <p
            className="text-base max-w-xl mx-auto"
            style={{ color: 'var(--color-text-muted)' }}
          >
            Три стъпки. Без обучение. Без промяна на работния процес.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-8">
          {steps.map((s) => (
            <div key={s.num} className="text-left">
              <div
                className="text-sm font-[family-name:var(--font-jetbrains)] mb-3"
                style={{ color: 'var(--color-gold)' }}
              >
                {s.num}
              </div>
              <h3
                className="text-2xl font-medium mb-3 font-[family-name:var(--font-cormorant)]"
                style={{ color: 'var(--color-text)' }}
              >
                {s.title}
              </h3>
              <p
                className="text-base leading-relaxed"
                style={{ color: 'var(--color-text-muted)' }}
              >
                {s.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ────────────────────────────────────────────────────────────── */

function WhyTuberMed() {
  const points = [
    {
      title: 'GDPR-съвместим',
      body: 'Цялата обработка се случва в EU инфраструктура (Frankfurt). Никакво прехвърляне на данни към САЩ. Договори за обработка на данни (DPA) с всички доставчици.',
    },
    {
      title: 'Български медицински език',
      body: 'Тренирани на българска медицинска терминология. Разпознава палпаторна болезненост и б.о. — без превод от английски.',
    },
    {
      title: 'Безопасност на лекарствата',
      body: 'Автоматични предупреждения за алергии, противопоказания и взаимодействия между лекарствата от анамнезата на пациента.',
    },
    {
      title: 'МКБ-10 на български',
      body: 'Автоматично предлага най-подходящите МКБ-10 кодове на български, базирани на симптомите от консултацията.',
    },
  ];

  return (
    <section id="why" className="px-6 py-24">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-16">
          <h2
            className="text-4xl md:text-5xl font-semibold mb-4 font-[family-name:var(--font-cormorant)]"
            style={{ color: 'var(--color-brand)' }}
          >
            Защо TuberMed
          </h2>
          <p
            className="text-base max-w-xl mx-auto"
            style={{ color: 'var(--color-text-muted)' }}
          >
            Не е поредният американски скрайб. Направен за българската медицинска система.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-x-12 gap-y-10">
          {points.map((p) => (
            <div key={p.title}>
              <div className="flex items-baseline gap-3 mb-2">
                <span
                  className="text-lg font-[family-name:var(--font-cormorant)]"
                  style={{ color: 'var(--color-gold)' }}
                >
                  ◆
                </span>
                <h3
                  className="text-xl font-medium"
                  style={{ color: 'var(--color-text)' }}
                >
                  {p.title}
                </h3>
              </div>
              <p
                className="text-base leading-relaxed pl-7"
                style={{ color: 'var(--color-text-muted)' }}
              >
                {p.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ────────────────────────────────────────────────────────────── */

function Pricing() {
  return (
    <section
      className="px-6 py-24"
      style={{ background: 'var(--color-bg-card)' }}
    >
      <div className="max-w-3xl mx-auto text-center">
        <h2
          className="text-4xl md:text-5xl font-semibold mb-4 font-[family-name:var(--font-cormorant)]"
          style={{ color: 'var(--color-brand)' }}
        >
          Цени
        </h2>
        <p
          className="text-base mb-8 leading-relaxed"
          style={{ color: 'var(--color-text-muted)' }}
        >
          В момента приемаме заявки за пилотно внедряване в избрани кабинети. Месечен абонамент в зависимост от обема консултации. Свържи се с нас за индивидуална оферта.
        </p>
        <a
          href="mailto:contact@tubermed.com?subject=Запитване за цени"
          className="inline-block px-7 py-3.5 rounded-md font-medium border transition hover:bg-white"
          style={{
            borderColor: 'var(--color-border-mid)',
            color: 'var(--color-text)',
          }}
        >
          Свържи се с нас
        </a>
      </div>
    </section>
  );
}

/* ────────────────────────────────────────────────────────────── */

function FinalCta() {
  return (
    <section
      className="px-6 py-28"
      style={{ background: 'var(--gradient-brand)' }}
    >
      <div className="max-w-3xl mx-auto text-center">
        <h2 className="text-4xl md:text-5xl font-semibold mb-6 text-white font-[family-name:var(--font-cormorant)] italic">
          Готови ли сте да върнете часовете си обратно?
        </h2>
        <p className="text-base mb-10 text-white/85 max-w-xl mx-auto">
          Спрете да пишете амбулаторни листове ръчно. Започнете да преглеждате готови.
        </p>
        <a
          href="mailto:contact@tubermed.com?subject=Заявка за достъп до TuberMed"
          className="inline-block px-8 py-4 rounded-md font-medium transition hover:opacity-90"
          style={{ background: 'white', color: 'var(--color-brand)' }}
        >
          Заявка за достъп →
        </a>
      </div>
    </section>
  );
}

/* ────────────────────────────────────────────────────────────── */

function Footer() {
  return (
    <footer
      className="px-6 py-12 mt-auto border-t"
      style={{ borderColor: 'var(--color-border)' }}
    >
      <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span
            className="text-xl font-semibold font-[family-name:var(--font-cormorant)]"
            style={{ color: 'var(--color-brand)' }}
          >
            TuberMed
          </span>
          <span className="text-xs" style={{ color: 'var(--color-text-hint)' }}>
            © 2026 · GDPR-съвместим
          </span>
        </div>
        <div className="flex gap-6 text-sm">
          <a
            href="mailto:contact@tubermed.com"
            className="hover:underline"
            style={{ color: 'var(--color-text-muted)' }}
          >
            contact@tubermed.com
          </a>
          <Link
            href="/app/login"
            className="hover:underline"
            style={{ color: 'var(--color-text-muted)' }}
          >
            Вход
          </Link>
        </div>
      </div>
    </footer>
  );
}
