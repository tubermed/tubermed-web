'use client';

// Single accessible modal primitive for the workspace — wraps
// @radix-ui/react-dialog so every modal gets a real focus-trap, focus-return,
// body scroll-lock, `role="dialog"` + `aria-modal`, an accessible name, portal,
// and Esc/outside-click handling FOR FREE. We keep 100% of the styling via the
// workspace `--color-*` tokens, matched to the previous hand-rolled modals
// (navy scrim + rounded-2xl/shadow-2xl card) so migrations are visually
// unchanged. Never hand-roll an overlay/Escape handler again — use <Dialog/>.
// See AGENTS.md ("Dialog").

import * as RadixDialog from '@radix-ui/react-dialog';
import type { ReactNode, RefObject } from 'react';
import { Icon } from '@/components/ui/Icon';

const SIZES = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
} as const;

export type DialogProps = {
  open: boolean;
  /**
   * Fired when the USER dismisses (Esc / backdrop / the close button). Wire it to
   * the modal's existing cancel/close handler. For a non-dismissible gate
   * (`dismissible={false}`) Esc + outside-click are prevented and there is no
   * close button, so this never fires from Radix — the parent closes by flipping
   * `open` after a choice is made.
   */
  onClose: () => void;
  /**
   * Accessible name (Radix Title — satisfies the dialog's `aria-labelledby`).
   * Rendered visually-hidden by default so the modal keeps its OWN visible
   * heading unchanged; pass `titleVisible` to render it.
   */
  title: ReactNode;
  titleVisible?: boolean;
  /** Optional accessible description (Radix Description, visually-hidden). */
  description?: ReactNode;
  size?: keyof typeof SIZES;
  /**
   * Default true. `false` → hard gate: Esc + outside-click do nothing and no
   * close button renders (preserves a forced consent/confirm modal).
   */
  dismissible?: boolean;
  /** Render the top-right ✕ close button. Defaults to `dismissible`. */
  showClose?: boolean;
  /** Focus this element on open instead of Radix's default first-focusable. */
  initialFocus?: RefObject<HTMLElement | null>;
  /** Extra classes on the content surface (width/height overrides, e.g. pickers). */
  className?: string;
  children: ReactNode;
};

export function Dialog({
  open,
  onClose,
  title,
  titleVisible = false,
  description,
  size = 'md',
  dismissible = true,
  showClose,
  initialFocus,
  className,
  children,
}: DialogProps) {
  const withClose = showClose ?? dismissible;
  return (
    <RadixDialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <RadixDialog.Portal>
        <RadixDialog.Overlay
          className="dialog-overlay fixed inset-0 z-50"
          style={{ background: 'rgba(27, 42, 65, 0.55)' }}
        />
        <RadixDialog.Content
          className={[
            'dialog-content fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2',
            'w-[calc(100%-2rem)]',
            SIZES[size],
            'max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl shadow-2xl focus:outline-none',
            className ?? '',
          ].join(' ')}
          style={{ background: 'var(--color-bg-card)' }}
          // No description rendered → opt out of Radix's missing-description warning.
          aria-describedby={description ? undefined : undefined}
          onEscapeKeyDown={dismissible ? undefined : (e) => e.preventDefault()}
          onInteractOutside={dismissible ? undefined : (e) => e.preventDefault()}
          onOpenAutoFocus={
            initialFocus
              ? (e) => {
                  const el = initialFocus.current;
                  if (el) {
                    e.preventDefault();
                    el.focus();
                  }
                }
              : undefined
          }
        >
          <RadixDialog.Title className={titleVisible ? undefined : 'sr-only'}>
            {title}
          </RadixDialog.Title>
          {description ? (
            <RadixDialog.Description className="sr-only">
              {description}
            </RadixDialog.Description>
          ) : null}
          {withClose && (
            <RadixDialog.Close
              aria-label="Затвори"
              className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-md transition hover:bg-[var(--color-bg)]"
              style={{ color: 'var(--color-text-hint)' }}
            >
              <Icon name="x" />
            </RadixDialog.Close>
          )}
          {children}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

export default Dialog;
