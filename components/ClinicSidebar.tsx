'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { clearSession } from '@/lib/api';
import type { DoctorInfo } from '@/lib/api';

export interface NavItem {
  label: string;
  href?: string;            // omit when disabled
  icon: React.ReactNode;
  disabled?: boolean;
  badge?: string;           // e.g. "скоро"
}

interface ClinicSidebarProps {
  doctor: DoctorInfo | null;
  /** Slug of the clinic shown in the switcher card. Today this is just decorative. */
  clinicName?: string;
  items: NavItem[];
  /** When true, every nav item AND the logout button become non-interactive.
   *  Used while a recording is in progress on /app/scribe so the doctor can't
   *  accidentally navigate away and lose the recording. */
  locked?: boolean;
}

export default function ClinicSidebar({ doctor, clinicName, items, locked = false }: ClinicSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const displayName = doctor?.name?.replace(/^д-р\s*/i, '') ?? '';

  function handleLogout() {
    clearSession();
    router.replace('/app/login');
  }

  return (
    // Two shapes, one element (2026-08-19). Below md it is a full-width sticky
    // top STRIP — one row, ~56px, icons only for the nav; at md+ it is the
    // unchanged 252px column. No drawer, no open/close state, nothing new to
    // get stuck: `locked` keeps working identically in both shapes, which
    // matters because it is what stops a doctor navigating away mid-recording.
    <aside
      className="md:h-screen sticky top-0 z-30 flex md:flex-col w-full md:w-[252px] flex-shrink-0
                 items-center md:items-stretch gap-2 md:gap-0 px-3 py-2 md:px-0 md:py-0"
      style={{
        background: 'var(--color-nav-bg)',
        color: 'var(--color-nav-text)',
        borderRight: '1px solid var(--color-nav-border)',
      }}
    >
      {/* Clinic switcher card — a plain truncated line at strip width. */}
      <div className="nav-card md:m-4 md:p-4 rounded-xl min-w-0 flex-1 md:flex-none">
        <div
          className="hidden md:block text-xs uppercase tracking-[0.18em] mb-1"
          style={{ color: 'var(--color-nav-text-muted)' }}
        >
          Клиника
        </div>
        <div
          className="text-sm md:text-base font-medium leading-snug truncate"
          style={{ color: 'var(--color-nav-text-active)' }}
        >
          {clinicName?.trim() || doctor?.organizationName?.trim() || 'Вашата практика'}
        </div>
        <div
          className="hidden md:block text-xs mt-1"
          style={{ color: 'var(--color-nav-text-muted)' }}
        >
          {doctor?.specialty || 'АМП'}
        </div>
      </div>

      {/* Nav items */}
      <nav className="flex flex-row md:flex-col md:px-3 gap-0.5 md:flex-1 md:overflow-y-auto flex-shrink-0">
        {items.map((item) => {
          const isActive   = item.href ? pathname === item.href || pathname.startsWith(item.href + '/') : false;
          const itemLocked = locked || item.disabled;
          const baseStyle: React.CSSProperties = {
            color: itemLocked
              ? 'var(--color-nav-text-muted)'
              : isActive
              ? 'white'
              : 'var(--color-nav-text)',
            background: isActive && !locked ? 'var(--color-nav-active)' : 'transparent',
            cursor: itemLocked ? 'not-allowed' : 'pointer',
            opacity: itemLocked ? 0.55 : 1,
          };
          // At strip width the label is dropped and the icon carries the item.
          // `title` + `aria-label` on the interactive element (below) keep it
          // named for screen readers and hover — a label that only exists as a
          // visual is not a label.
          const inner = (
            <span className="flex items-center gap-3 px-2.5 py-2 md:px-3 md:py-2.5 rounded-md text-sm font-medium">
              <span className="w-5 h-5 flex items-center justify-center opacity-80">{item.icon}</span>
              <span className="hidden md:block flex-1">{item.label}</span>
              {item.badge && (
                <span
                  className="hidden md:inline px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider font-semibold"
                  style={{ background: 'var(--color-warn-soft)', color: 'var(--color-warn)' }}
                >
                  {item.badge}
                </span>
              )}
            </span>
          );
          if (itemLocked || !item.href) {
            return (
              <div key={item.label} style={baseStyle} aria-disabled="true"
                   title={item.label} aria-label={item.label}>
                {inner}
              </div>
            );
          }
          return (
            <Link key={item.label} href={item.href} style={baseStyle}
                  title={item.label} aria-label={item.label}>
              {inner}
            </Link>
          );
        })}
      </nav>

      {/* User card — avatar + Изход only at strip width; the name is already
          implied by the account they are signed into and costs 100px there. */}
      <div className="nav-card md:m-3 md:p-3 rounded-xl flex items-center gap-2 md:gap-3 flex-shrink-0">
        <div
          className="w-8 h-8 md:w-9 md:h-9 rounded-full flex items-center justify-center text-sm font-semibold flex-shrink-0"
          style={{ background: 'var(--color-brand)', color: 'white' }}
        >
          {initialsOf(displayName)}
        </div>
        <div className="flex-1 min-w-0">
          <div
            className="hidden md:block text-sm font-medium truncate"
            style={{ color: 'var(--color-nav-text)' }}
          >
            д-р {displayName}
          </div>
          <button
            onClick={handleLogout}
            disabled={locked}
            className="text-xs underline-offset-2 hover:underline disabled:no-underline disabled:cursor-not-allowed"
            style={{ color: 'var(--color-nav-text-muted)', opacity: locked ? 0.5 : 1 }}
          >
            Изход
          </button>
        </div>
      </div>
    </aside>
  );
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
