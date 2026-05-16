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
}

export default function ClinicSidebar({ doctor, clinicName, items }: ClinicSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const displayName = doctor?.name?.replace(/^д-р\s*/i, '') ?? '';

  function handleLogout() {
    clearSession();
    router.replace('/app/login');
  }

  return (
    <aside
      className="h-screen sticky top-0 flex flex-col w-[252px] flex-shrink-0"
      style={{
        background: 'var(--color-nav-bg)',
        color: 'var(--color-nav-text)',
        borderRight: '1px solid var(--color-nav-border)',
      }}
    >
      {/* Clinic switcher card */}
      <div
        className="m-4 p-4 rounded-xl"
        style={{ background: 'var(--color-nav-bg-elev)', border: '1px solid var(--color-nav-border)' }}
      >
        <div
          className="text-xs uppercase tracking-[0.18em] mb-1"
          style={{ color: 'var(--color-nav-text-muted)' }}
        >
          Клиника
        </div>
        <div
          className="text-base leading-snug font-[family-name:var(--font-cormorant)]"
          style={{ color: 'var(--color-nav-text)' }}
        >
          {clinicName ?? doctor?.clinic ?? 'МЦ „Св. Анна"'}
        </div>
        <div
          className="text-xs mt-1"
          style={{ color: 'var(--color-nav-text-muted)' }}
        >
          {doctor?.specialty || 'АМП'}
        </div>
      </div>

      {/* Nav items */}
      <nav className="px-3 flex flex-col gap-0.5 flex-1 overflow-y-auto">
        {items.map((item) => {
          const isActive = item.href ? pathname === item.href || pathname.startsWith(item.href + '/') : false;
          const baseStyle: React.CSSProperties = {
            color: item.disabled
              ? 'var(--color-nav-text-muted)'
              : isActive
              ? 'white'
              : 'var(--color-nav-text)',
            background: isActive ? 'var(--color-nav-active)' : 'transparent',
            cursor: item.disabled ? 'not-allowed' : 'pointer',
            opacity: item.disabled ? 0.55 : 1,
          };
          const inner = (
            <span className="flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium">
              <span className="w-5 h-5 flex items-center justify-center opacity-80">{item.icon}</span>
              <span className="flex-1">{item.label}</span>
              {item.badge && (
                <span
                  className="px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider font-semibold"
                  style={{ background: 'var(--color-gold)', color: '#1A1410' }}
                >
                  {item.badge}
                </span>
              )}
            </span>
          );
          if (item.disabled || !item.href) {
            return (
              <div key={item.label} style={baseStyle} aria-disabled="true">
                {inner}
              </div>
            );
          }
          return (
            <Link key={item.label} href={item.href} style={baseStyle}>
              {inner}
            </Link>
          );
        })}
      </nav>

      {/* User card */}
      <div
        className="m-3 p-3 rounded-xl flex items-center gap-3"
        style={{ background: 'var(--color-nav-bg-elev)', border: '1px solid var(--color-nav-border)' }}
      >
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold flex-shrink-0"
          style={{ background: 'var(--color-brand)', color: 'white' }}
        >
          {initialsOf(displayName)}
        </div>
        <div className="flex-1 min-w-0">
          <div
            className="text-sm font-medium truncate"
            style={{ color: 'var(--color-nav-text)' }}
          >
            д-р {displayName}
          </div>
          <button
            onClick={handleLogout}
            className="text-xs underline-offset-2 hover:underline"
            style={{ color: 'var(--color-nav-text-muted)' }}
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
