'use client';

// Workspace route group shared shell.
// Currently wraps /app/new-visit. /app/scribe and /app/scribe/result live
// outside this group (they're under /app/scribe/...) and call AppShell
// directly because they need to drive `sidebarLocked` from page state.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppShell from '@/components/AppShell';
import { getSession } from '@/lib/api';
import type { DoctorInfo } from '@/lib/api';

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [doctor, setDoctor] = useState<DoctorInfo | null>(null);
  const [ready, setReady]   = useState(false);

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

  return <AppShell doctor={doctor}>{children}</AppShell>;
}
