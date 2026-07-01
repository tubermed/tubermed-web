'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import Link from 'next/link';
import { Logo } from './brand';

const NAV = [
  { href: '#how', label: 'Как работи' },
  { href: '#why', label: 'Защо TuberMed' },
  { href: '#security', label: 'Сигурност' },
  { href: '#pricing', label: 'Цени' },
  { href: '#faq', label: 'Въпроси' },
];

export function Header({ anchorBase = '' }: { anchorBase?: string }) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const reduce = useReducedMotion();

  // On sub-pages (e.g. /privacy) anchors must point back to the landing.
  const anchor = (href: string) => (href.startsWith('#') ? `${anchorBase}${href}` : href);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className="sticky top-0 z-50 transition-shadow duration-200"
      style={{
        background: 'rgba(255,255,255,0.86)',
        backdropFilter: 'saturate(150%) blur(10px)',
        WebkitBackdropFilter: 'saturate(150%) blur(10px)',
        borderBottom: `1px solid ${scrolled ? 'var(--lp-border)' : 'transparent'}`,
        boxShadow: scrolled ? '0 6px 24px rgba(20,39,64,0.06)' : 'none',
      }}
    >
      <div
        className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 transition-[padding] duration-200"
        style={{ paddingTop: scrolled ? '0.6rem' : '1rem', paddingBottom: scrolled ? '0.6rem' : '1rem' }}
      >
        {/* On the landing the logo smooth-scrolls to the top (reuses the nav
            links' Lenis anchor handler via #top; #top is also a native
            scroll-to-top fragment under reduced motion). On sub-pages it keeps
            client-side navigation back home. */}
        {anchorBase === '' ? (
          <a href="#top" aria-label="TuberMed - начало на страницата" className="shrink-0">
            <Logo variant="light" size={32} />
          </a>
        ) : (
          <Link href="/" aria-label="TuberMed - начало" className="shrink-0">
            <Logo variant="light" size={32} />
          </Link>
        )}

        {/* Desktop nav */}
        <nav aria-label="Основна навигация" className="hidden items-center gap-1 lg:flex">
          {NAV.map((item) => (
            <a
              key={item.href}
              href={anchor(item.href)}
              className="lp-navlink rounded-md px-3 py-2 text-sm font-medium transition-colors"
              style={{ color: 'var(--lp-text)' }}
            >
              {item.label}
            </a>
          ))}
          <Link
            href="/app/login"
            className="lp-cta-secondary ml-2 rounded-[var(--lp-radius)] px-4 py-2 text-sm font-semibold transition-colors"
          >
            Вход за лекари
          </Link>
          <a
            href={anchor('#access')}
            className="lp-cta-primary rounded-[var(--lp-radius)] px-4 py-2 text-sm font-semibold transition-colors"
          >
            Заявка за достъп
          </a>
        </nav>

        {/* Mobile toggle */}
        <button
          type="button"
          className="rounded-md p-2 lg:hidden"
          aria-label={open ? 'Затвори менюто' : 'Отвори менюто'}
          aria-expanded={open}
          aria-controls="lp-mobile-menu"
          onClick={() => setOpen((v) => !v)}
          style={{ color: 'var(--lp-navy)' }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            {open ? (
              <>
                <path d="M6 6 L18 18" />
                <path d="M18 6 L6 18" />
              </>
            ) : (
              <>
                <path d="M3 6h18" />
                <path d="M3 12h18" />
                <path d="M3 18h18" />
              </>
            )}
          </svg>
        </button>
      </div>

      {/* Mobile menu panel — an absolute OVERLAY (top-full) so opening it never
          shifts the page content (also why the nav anchor scroll lands right).
          Subtle slide-down + fade via framer-motion (the landing's motion lib);
          reduced motion collapses it to an instant fade with no transform. */}
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            id="lp-mobile-menu"
            key="lp-mobile-menu"
            className="lg:hidden absolute inset-x-0 top-full"
            style={{
              background: '#fff',
              borderTop: '1px solid var(--lp-border)',
              boxShadow: '0 12px 24px rgba(20,39,64,0.08)',
            }}
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -8 }}
            transition={{ duration: reduce ? 0 : 0.2, ease: 'easeOut' }}
          >
          <nav aria-label="Мобилна навигация" className="mx-auto flex w-full max-w-6xl flex-col gap-1 px-6 py-4">
            {NAV.map((item) => (
              <a
                key={item.href}
                href={anchor(item.href)}
                onClick={() => setOpen(false)}
                className="rounded-md px-3 py-3 text-base font-medium transition-colors hover:bg-[var(--lp-bg-soft)]"
                style={{ color: 'var(--lp-text)' }}
              >
                {item.label}
              </a>
            ))}
            <div className="mt-2 flex flex-col gap-2">
              <Link
                href="/app/login"
                onClick={() => setOpen(false)}
                className="lp-cta-secondary rounded-[var(--lp-radius)] px-4 py-3 text-center text-base font-semibold transition-colors"
              >
                Вход за лекари
              </Link>
              <a
                href={anchor('#access')}
                onClick={() => setOpen(false)}
                className="lp-cta-primary rounded-[var(--lp-radius)] px-4 py-3 text-center text-base font-semibold transition-colors"
              >
                Заявка за достъп
              </a>
            </div>
          </nav>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </header>
  );
}
