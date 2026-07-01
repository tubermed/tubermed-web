import type { Metadata } from 'next';
import Link from 'next/link';
import { interTight } from '@/lib/landing-fonts';
import { LenisProvider } from '@/components/landing/LenisProvider';
import { ScrollProgress } from '@/components/landing/ScrollProgress';
import { Header } from '@/components/landing/Header';
import { Footer } from '@/components/landing/Footer';
import { Container } from '@/components/landing/ui';

export const metadata: Metadata = {
  title: 'Политика за поверителност',
  description: 'Политика за поверителност на TuberMed.',
  // Draft scaffold — keep out of search until the real policy copy lands.
  robots: { index: false, follow: true },
};

// TODO(legal): replace the placeholder sections below with the real Политика
// за поверителност copy provided by Dimitar / legal. Do NOT auto-generate
// legal text. The consent checkbox in the access form links here, so the route
// must resolve; the section structure is scaffolding only.
const SECTIONS = [
  'Кой обработва данните ви',
  'Какви данни събираме',
  'Цел на обработката',
  'Правно основание',
  'Къде се обработват и съхраняват данните',
  'Срок на съхранение',
  'Споделяне с трети страни (обработващи)',
  'Вашите права',
  'Контакт',
];

export default function PrivacyPage() {
  return (
    <div className={`lp ${interTight.variable}`}>
      <LenisProvider />
      <ScrollProgress />
      <Header anchorBase="/" />

      <main>
        <Container className="max-w-3xl py-16 md:py-24">
          {/* Draft banner — this page is a placeholder, not the final policy. */}
          <div
            role="note"
            className="mb-10 rounded-[var(--lp-radius)] px-5 py-4 text-sm"
            style={{ background: 'var(--lp-warn-soft)', border: '1px solid var(--lp-warn-border)', color: 'var(--lp-warn-ink)' }}
          >
            <strong>Чернова.</strong> Този документ е примерна структура и предстои да бъде
            заменен с финалния правен текст. Все още не е обвързваща политика.
          </div>

          <h1
            className="font-[family-name:var(--font-inter-tight)] text-4xl font-bold tracking-[-0.02em]"
            style={{ color: 'var(--lp-ink)' }}
          >
            Политика за поверителност
          </h1>
          <p className="mt-4 text-base leading-relaxed" style={{ color: 'var(--lp-text-muted)' }}>
            TuberMed обработва личните данни на лекарите, заявили достъп до пилота, само за да
            се свърже с тях относно него. Пълният текст на политиката предстои да бъде публикуван.
          </p>

          <div className="mt-12 space-y-8">
            {SECTIONS.map((title) => (
              <section key={title}>
                <h2 className="text-lg font-bold" style={{ color: 'var(--lp-heading)' }}>
                  {title}
                </h2>
                <p className="mt-2 text-base leading-relaxed" style={{ color: 'var(--lp-text-muted)' }}>
                  Съдържанието на този раздел ще бъде предоставено в финалната версия на политиката.
                </p>
              </section>
            ))}
          </div>

          <p className="mt-12 text-sm" style={{ color: 'var(--lp-text-muted)' }}>
            Въпроси относно данните:{' '}
            <a href="mailto:contact@tubermed.com" className="font-semibold underline" style={{ color: 'var(--lp-navy)' }}>
              contact@tubermed.com
            </a>
          </p>

          <div className="mt-10">
            <Link
              href="/"
              className="lp-cta-secondary inline-flex rounded-[var(--lp-radius)] px-5 py-2.5 text-sm font-semibold transition-colors"
            >
              ← Към началната страница
            </Link>
          </div>
        </Container>
      </main>

      <Footer />
    </div>
  );
}
