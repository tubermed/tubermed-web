'use client';

// Workspace shell layout — dark-navy left rail + main content area.
// Used by route group (workspace) which holds /app/new-visit (and later
// /app/patients, /app/templates, /app/settings).
//
// /app/scribe and /app/scribe/result intentionally do NOT use this shell —
// they have their own minimal chrome (AppHeader + Stepper) and are reached
// FROM /app/new-visit carrying ?visit=<consultation_id>.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import ClinicSidebar, { type NavItem } from '@/components/ClinicSidebar';
import { getSession } from '@/lib/api';
import type { DoctorInfo } from '@/lib/api';

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [doctor, setDoctor] = useState<DoctorInfo | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const s = getSession();
    if (!s) {
      router.replace('/app/login');
      return;
    }
    setDoctor(s.doctor);
    setReady(true);
  }, [router]);

  if (!ready) {
    return (
      <main
        className="min-h-screen flex items-center justify-center"
        style={{ color: 'var(--color-text-muted)' }}
      >
        Зареждане…
      </main>
    );
  }

  const navItems: NavItem[] = [
    { label: 'Нов преглед', href: '/app/new-visit',                          icon: <NewVisitIcon /> },
    { label: 'Пациенти',    href: undefined, disabled: true,                  icon: <PatientsIcon /> },
    { label: 'Шаблони',     href: undefined, disabled: true,                  icon: <TemplatesIcon /> },
    { label: 'График',      href: undefined, disabled: true, badge: 'скоро',  icon: <CalendarIcon /> },
    { label: 'AI записи',   href: undefined, disabled: true, badge: 'скоро',  icon: <SparkleIcon /> },
    { label: 'Настройки',   href: undefined, disabled: true,                  icon: <SettingsIcon /> },
  ];

  return (
    <div className="min-h-screen flex" style={{ background: 'var(--color-bg)' }}>
      <ClinicSidebar doctor={doctor} items={navItems} />
      <main className="flex-1 flex flex-col min-w-0">
        {children}
      </main>
    </div>
  );
}

// ── Tiny SVG icons (no external dep) ────────────────────────────────────────
function Icon({ children }: { children: React.ReactNode }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}
const NewVisitIcon  = () => <Icon><path d="M12 4v16M4 12h16" /></Icon>;
const PatientsIcon  = () => <Icon><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0116 0" /></Icon>;
const TemplatesIcon = () => <Icon><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M8 9h8M8 13h8M8 17h5" /></Icon>;
const CalendarIcon  = () => <Icon><rect x="4" y="5" width="16" height="16" rx="2" /><path d="M16 3v4M8 3v4M4 11h16" /></Icon>;
const SparkleIcon   = () => <Icon><path d="M12 3v6M12 15v6M3 12h6M15 12h6M5.6 5.6l4.2 4.2M14.2 14.2l4.2 4.2M18.4 5.6l-4.2 4.2M9.8 14.2l-4.2 4.2" /></Icon>;
const SettingsIcon  = () => <Icon><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" /></Icon>;
