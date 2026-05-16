'use client';

import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';

interface RevealEgnButtonProps {
  patientId: string;
  last4: string | null;
  /** Auto-hide after this many seconds. */
  autoHideMs?: number;
}

export default function RevealEgnButton({ patientId, last4, autoHideMs = 30_000 }: RevealEgnButtonProps) {
  const [plain, setPlain]   = useState<string | null>(null);
  const [loading, setLoad]  = useState(false);
  const [err, setErr]       = useState<string | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (hideTimer.current) clearTimeout(hideTimer.current); }, []);

  async function reveal() {
    if (loading || plain) return;
    setLoad(true); setErr(null);
    try {
      const data = await api.revealNationalId(patientId);
      setPlain(data.national_id);
      hideTimer.current = setTimeout(() => setPlain(null), autoHideMs);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Грешка');
    } finally {
      setLoad(false);
    }
  }

  if (plain) {
    return (
      <span className="inline-flex items-center gap-2">
        <span
          className="font-[family-name:var(--font-jetbrains)] text-sm"
          style={{ color: 'var(--color-text)' }}
        >
          {plain}
        </span>
        <button
          onClick={() => { if (hideTimer.current) clearTimeout(hideTimer.current); setPlain(null); }}
          className="text-xs underline-offset-2 hover:underline"
          style={{ color: 'var(--color-text-muted)' }}
        >
          скрий
        </button>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      <span className="font-[family-name:var(--font-jetbrains)] text-sm" style={{ color: 'var(--color-text)' }}>
        ····{last4 ?? '????'}
      </span>
      <button
        onClick={reveal}
        disabled={loading}
        className="text-xs underline-offset-2 hover:underline disabled:opacity-50"
        style={{ color: 'var(--color-brand)' }}
      >
        {loading ? 'зарежда…' : 'показване'}
      </button>
      {err && <span className="text-xs" style={{ color: 'var(--color-red)' }}>{err}</span>}
    </span>
  );
}
