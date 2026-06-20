'use client';

// Small icon button used in section headers on /app/scribe/result to copy a
// single section's plain text to the clipboard. Gated behind the doctor's
// review confirmation — when `disabled` is true (reviewStatus !== 'confirmed')
// the button is muted, aria-disabled, and shows the same lock affordance used
// elsewhere on the page.
//
// Clipboard work itself goes through copyToClipboard in lib/exporters (with
// the textarea fallback for insecure contexts). The parent owns toast UX —
// CopyButton just reports success/failure through onResult so the existing
// Toast wiring on the result page handles the user-visible confirmation.

import { copyToClipboard } from '@/lib/exporters';
import { Icon } from '@/components/ui/Icon';

interface CopyButtonProps {
  /** Plain-text payload to write to the clipboard. */
  text: string;
  /** Locked when the doctor hasn't confirmed the review yet. */
  disabled: boolean;
  /** Fires after the clipboard attempt — true on success, false on failure. */
  onResult: (ok: boolean) => void;
  /** Visible text on the button. Pass "" for an icon-only chip; aria-label
   *  always falls back to "Копирай" for screen readers. */
  label?: string;
}

const LOCKED_HINT = 'Достъпно след потвърждаване на прегледа';
const READY_HINT  = 'Копирай в клипборда';

export default function CopyButton({
  text,
  disabled,
  onResult,
  label = 'Копирай',
}: CopyButtonProps) {
  async function handleClick() {
    if (disabled) return;
    let ok = false;
    try {
      ok = await copyToClipboard(text);
    } catch {
      ok = false;
    }
    onResult(ok);
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      aria-disabled={disabled}
      aria-label={label || 'Копирай'}
      title={disabled ? LOCKED_HINT : READY_HINT}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border transition hover:bg-[var(--color-bg)] disabled:opacity-40 disabled:cursor-not-allowed no-print"
      style={{
        borderColor: 'var(--color-border-mid)',
        color: 'var(--color-text-muted)',
      }}
    >
      <Icon name={disabled ? 'lock' : 'copy'} />
      {label && <span>{label}</span>}
    </button>
  );
}
