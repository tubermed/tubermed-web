import Link from 'next/link';
import { Container } from './ui';
import { Logo } from './brand';

export function Footer() {
  return (
    <footer style={{ background: 'var(--lp-navy-deep)' }}>
      <Container className="py-12">
        <div className="flex flex-col items-start justify-between gap-8 md:flex-row md:items-center">
          <Logo variant="dark" size={32} />

          <nav aria-label="Долна навигация" className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
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

        <p className="mt-8 text-sm" style={{ color: 'var(--lp-on-navy-mut)' }}>
          TuberMed © 2026 · GDPR-съвместим
        </p>
      </Container>
    </footer>
  );
}
