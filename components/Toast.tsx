'use client';

import { useEffect } from 'react';

export type ToastKind = 'success' | 'error' | 'info';

export interface ToastData {
  kind: ToastKind;
  message: string;
  id: number; // unique to force re-trigger on re-show
}

interface ToastProps {
  toast: ToastData | null;
  onDismiss: () => void;
  durationMs?: number;
}

export default function Toast({
  toast,
  onDismiss,
  durationMs = 2800,
}: ToastProps) {
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(onDismiss, durationMs);
    return () => clearTimeout(t);
  }, [toast, onDismiss, durationMs]);

  if (!toast) return null;

  const style = (() => {
    if (toast.kind === 'success') {
      return {
        background: 'var(--color-ok)',
        color: 'white',
      };
    }
    if (toast.kind === 'error') {
      return {
        background: 'var(--color-red)',
        color: 'white',
      };
    }
    return {
      background: 'var(--color-brand)',
      color: 'white',
    };
  })();

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-6 right-6 z-[60] px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 min-w-[260px] max-w-[420px] no-print"
      style={{
        ...style,
        animation: 'toast-in 0.18s ease-out',
      }}
    >
      <span className="text-sm font-medium flex-1">{toast.message}</span>
      <button
        onClick={onDismiss}
        aria-label="Затвори"
        className="text-lg leading-none opacity-80 hover:opacity-100 transition"
      >
        ×
      </button>
      <style jsx>{`
        @keyframes toast-in {
          from {
            opacity: 0;
            transform: translateY(8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
}
