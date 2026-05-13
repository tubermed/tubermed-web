'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { clearSession } from '@/lib/api';
import type { DoctorInfo } from '@/lib/api';

export default function AppHeader({ doctor }: { doctor: DoctorInfo | null }) {
  const router = useRouter();

  function handleLogout() {
    clearSession();
    router.replace('/app/login');
  }

  const displayName = doctor?.name?.replace(/^д-р\s*/i, '') ?? '';

  return (
    <header
      className="border-b sticky top-0 z-40"
      style={{
        borderColor: 'var(--color-border)',
        background: 'var(--color-bg-card)',
      }}
    >
      <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between">
        <Link
          href="/app/scribe"
          className="text-2xl font-semibold font-[family-name:var(--font-cormorant)]"
          style={{ color: 'var(--color-brand)' }}
        >
          TuberMed
        </Link>
        <div className="flex items-center gap-4">
          {doctor && (
            <div className="text-right">
              <div
                className="text-sm font-medium"
                style={{ color: 'var(--color-text)' }}
              >
                д-р {displayName}
              </div>
              <div
                className="text-xs"
                style={{ color: 'var(--color-text-muted)' }}
              >
                {doctor.specialty || 'АМП'}
              </div>
            </div>
          )}
          <button
            onClick={handleLogout}
            className="text-sm hover:underline px-2 py-1"
            style={{ color: 'var(--color-text-muted)' }}
          >
            Изход
          </button>
        </div>
      </div>
    </header>
  );
}
