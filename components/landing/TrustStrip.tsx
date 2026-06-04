import { Container } from './ui';
import { Reveal } from './Reveal';

const BADGES = ['Данните не напускат ЕС', 'Български медицински език', 'Одобрение преди всеки експорт'];

function CheckIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function TrustStrip() {
  return (
    <section style={{ background: 'var(--lp-bg-soft)', borderBlock: '1px solid var(--lp-border)' }}>
      <Container className="py-8">
        <Reveal className="flex flex-col items-center gap-6 text-center">
          <p className="text-sm font-semibold" style={{ color: 'var(--lp-text-muted)' }}>
            В пилотна фаза с избрани кабинети в частната практика.
          </p>
          <ul className="flex flex-wrap items-center justify-center gap-3">
            {BADGES.map((b) => (
              <li
                key={b}
                className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold"
                style={{ background: '#fff', border: '1px solid var(--lp-border)', color: 'var(--lp-navy)' }}
              >
                <span style={{ color: 'var(--lp-accent)' }}>
                  <CheckIcon />
                </span>
                {b}
              </li>
            ))}
          </ul>
        </Reveal>
      </Container>
    </section>
  );
}
