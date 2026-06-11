'use client';

import { useState } from 'react';

// Password field with a hold-to-reveal eye button — shared by /signup and the
// /app/login email mode (NOT the 6-digit PIN field). Styling mirrors the local
// Input helpers on those pages exactly (workspace tokens, 40px, focus ring).
//
// Reveal semantics:
//   - Pointer (mouse/touch): press-and-hold shows, release/leave hides.
//     mousedown/touchstart preventDefault so the button never steals focus
//     from the input (and no synthetic mouse events double-fire on touch).
//   - Keyboard: Space/Enter TOGGLES (hold is pointer-only). The button sits in
//     the natural tab order after the input; aria-pressed reflects the state.
type PasswordInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>;

export default function PasswordInput({ className, ...rest }: PasswordInputProps) {
  const [revealed, setRevealed] = useState(false);

  return (
    <div className="relative">
      <input
        {...rest}
        type={revealed ? 'text' : 'password'}
        className={['w-full pl-3 pr-10 outline-none', className ?? ''].filter(Boolean).join(' ')}
        style={{
          height: 40,
          background: 'white',
          border: '1px solid var(--color-border-strong)',
          borderRadius: 'var(--radius-sm)',
          fontSize: 14,
          color: 'var(--color-text-primary)',
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = 'var(--color-accent)';
          e.currentTarget.style.boxShadow = '0 0 0 2px var(--color-accent-soft)';
          rest.onFocus?.(e);
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = 'var(--color-border-strong)';
          e.currentTarget.style.boxShadow = 'none';
          rest.onBlur?.(e);
        }}
      />
      <button
        type="button"
        aria-label="Покажи паролата"
        aria-pressed={revealed}
        disabled={rest.disabled}
        className="absolute inset-y-0 right-0 flex items-center px-2.5 disabled:opacity-50"
        style={{ color: 'var(--color-text-secondary)' }}
        onMouseDown={(e) => {
          e.preventDefault(); // keep focus in the input
          setRevealed(true);
        }}
        onMouseUp={() => setRevealed(false)}
        onMouseLeave={() => setRevealed(false)}
        onTouchStart={(e) => {
          e.preventDefault(); // suppress the synthetic mouse events
          setRevealed(true);
        }}
        onTouchEnd={() => setRevealed(false)}
        onTouchCancel={() => setRevealed(false)}
        onKeyDown={(e) => {
          if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault(); // we own activation — no synthetic click
            setRevealed((v) => !v);
          }
        }}
      >
        <EyeIcon off={revealed} />
      </button>
    </div>
  );
}

function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M1 8s2.5-4.5 7-4.5S15 8 15 8s-2.5 4.5-7 4.5S1 8 1 8z" />
      <circle cx="8" cy="8" r="2.25" />
      {off && <line x1="2.5" y1="2" x2="13.5" y2="14" />}
    </svg>
  );
}
