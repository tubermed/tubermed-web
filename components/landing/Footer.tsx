import Link from 'next/link';
import { Container } from './ui';
import { Logo } from './brand';

export function Footer() {
  return (
    <footer style={{ background: 'var(--lp-navy-deep)' }}>
      <Container className="py-12">
        {/* Column-centred on mobile, wordmark-left / links-right on desktop. The
            nav needs w-full while stacked: as a fit-content flex item it would
            take its 510px max-content width and overflow the 327px phone
            container instead of wrapping. */}
        <div className="flex flex-col items-center gap-6 md:flex-row md:justify-between md:gap-8">
          <Logo variant="dark" size={32} />

          <nav
            aria-label="Долна навигация"
            className="flex w-full flex-wrap items-center justify-center gap-x-6 gap-y-3 text-sm md:w-auto md:justify-end"
          >
            <a
              href="mailto:contact@tubermed.com"
              className="font-medium transition-colors hover:text-white"
              style={{ color: 'var(--lp-on-navy-mut)' }}
            >
              contact@tubermed.com
            </a>
            <Link
              href="/privacy"
              className="font-medium transition-colors hover:text-white"
              style={{ color: 'var(--lp-on-navy-mut)' }}
            >
              Политика за поверителност
            </Link>
            <Link
              href="/app/login"
              className="font-medium transition-colors hover:text-white"
              style={{ color: 'var(--lp-on-navy-mut)' }}
            >
              Вход за лекари
            </Link>
          </nav>
        </div>

        <p className="mt-6 text-center text-sm md:mt-8 md:text-left" style={{ color: 'var(--lp-on-navy-mut)' }}>
          TuberMed © 2026 · GDPR-съвместим
        </p>
      </Container>
    </footer>
  );
}
