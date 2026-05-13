'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import AppHeader from '@/components/AppHeader';
import { getSession } from '@/lib/api';
import type { DoctorInfo } from '@/lib/api';
import type { TranscribeResult } from '@/lib/types';

const RESULT_STORAGE_KEY = 'tuber_last_result';

export default function ResultPage() {
  const router = useRouter();
  const [doctor, setDoctor] = useState<DoctorInfo | null>(null);
  const [result, setResult] = useState<TranscribeResult | null>(null);

  useEffect(() => {
    const session = getSession();
    if (!session) {
      router.replace('/app/login');
      return;
    }
    setDoctor(session.doctor);

    const raw = sessionStorage.getItem(RESULT_STORAGE_KEY);
    if (!raw) {
      router.replace('/app/scribe');
      return;
    }
    try {
      setResult(JSON.parse(raw));
    } catch {
      router.replace('/app/scribe');
    }
  }, [router]);

  if (!doctor || !result) {
    return (
      <main
        className="min-h-screen flex items-center justify-center"
        style={{ color: 'var(--color-text-muted)' }}
      >
        Зареждане…
      </main>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <AppHeader doctor={doctor} />
      <main className="flex-1 px-6 py-8">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <h1
              className="text-3xl font-medium font-[family-name:var(--font-cormorant)]"
              style={{ color: 'var(--color-brand)' }}
            >
              Резултат
            </h1>
            <Link
              href="/app/scribe"
              className="text-sm px-4 py-2 rounded-md text-white font-medium transition hover:opacity-90"
              style={{ background: 'var(--gradient-brand)' }}
            >
              Нов запис →
            </Link>
          </div>

          <div
            className="bg-white rounded-2xl border p-6 mb-4"
            style={{ borderColor: 'var(--color-border)' }}
          >
            <div
              className="text-sm mb-2 px-3 py-2 rounded-md inline-block"
              style={{
                background: 'var(--color-ok-soft)',
                color: 'var(--color-ok)',
              }}
            >
              ✓ Получен резултат от backend
            </div>
            <p
              className="text-sm mt-3"
              style={{ color: 'var(--color-text-muted)' }}
            >
              Пълният интерфейс на амбулаторния лист (редактируеми полета, МКБ-10,
              медикаменти, безопасност, експорт) идва в C4.
            </p>
          </div>

          {result.fields.osnovna_diagnoza && (
            <PreviewCard label="Основна диагноза">
              <div className="text-base">{result.fields.osnovna_diagnoza}</div>
              {result.fields.osnovna_mkb && (
                <div
                  className="text-sm mt-1 font-[family-name:var(--font-jetbrains)]"
                  style={{ color: 'var(--color-gold)' }}
                >
                  МКБ-10: {result.fields.osnovna_mkb}
                </div>
              )}
            </PreviewCard>
          )}

          {result.fields.anamneza && (
            <PreviewCard label="Анамнеза">
              <div
                className="text-sm whitespace-pre-wrap"
                style={{ color: 'var(--color-text)' }}
              >
                {result.fields.anamneza}
              </div>
            </PreviewCard>
          )}

          <details className="mt-6">
            <summary
              className="cursor-pointer text-sm font-medium"
              style={{ color: 'var(--color-text-muted)' }}
            >
              Преглед на необработените данни (debug)
            </summary>
            <pre
              className="mt-3 p-4 rounded text-xs overflow-x-auto font-[family-name:var(--font-jetbrains)]"
              style={{
                background: 'var(--color-bg)',
                color: 'var(--color-text)',
                maxHeight: '500px',
              }}
            >
              {JSON.stringify(result, null, 2)}
            </pre>
          </details>
        </div>
      </main>
    </div>
  );
}

function PreviewCard({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="bg-white rounded-xl border p-5 mb-3"
      style={{ borderColor: 'var(--color-border)' }}
    >
      <div
        className="text-xs uppercase tracking-wider mb-2 font-medium"
        style={{ color: 'var(--color-text-hint)' }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}
