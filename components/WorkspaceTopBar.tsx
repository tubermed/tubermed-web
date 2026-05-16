'use client';

import Stepper, { type StepperStep } from './Stepper';

interface WorkspaceTopBarProps {
  /** Breadcrumb segments — last one is highlighted. Pass null for placeholders. */
  breadcrumb: Array<{ label: string; href?: string } | null>;
  /** Stepper steps and the active index (passed straight through to Stepper). */
  steps: StepperStep[];
  current: number;
  /** Slot for a page-owned search input (e.g. PatientSearch). Optional. */
  searchSlot?: React.ReactNode;
  /** Visual-only placeholders (bell / settings / initials) — non-functional in this pass. */
  showActionPlaceholders?: boolean;
  doctorInitials?: string;
}

export default function WorkspaceTopBar({
  breadcrumb,
  steps,
  current,
  searchSlot,
  showActionPlaceholders = true,
  doctorInitials,
}: WorkspaceTopBarProps) {
  const trail = breadcrumb.filter((b): b is { label: string; href?: string } => !!b);

  return (
    <header
      className="sticky top-0 z-30 flex flex-col"
      style={{
        background: 'var(--color-bg-card)',
        borderBottom: '1px solid var(--color-border)',
      }}
    >
      <div className="flex items-center gap-6 px-6 py-3">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-sm flex-shrink-0 min-w-0">
          {trail.map((seg, i) => {
            const last = i === trail.length - 1;
            return (
              <span key={i} className="flex items-center gap-2 min-w-0">
                {i > 0 && (
                  <span style={{ color: 'var(--color-text-hint)' }} aria-hidden>›</span>
                )}
                <span
                  className={last ? 'font-medium' : ''}
                  style={{
                    color: last ? 'var(--color-text)' : 'var(--color-text-muted)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    maxWidth: '220px',
                  }}
                >
                  {seg.label}
                </span>
              </span>
            );
          })}
        </nav>

        {/* Search slot */}
        <div className="flex-1 flex justify-end">
          {searchSlot}
        </div>

        {/* Action placeholders (visual only) */}
        {showActionPlaceholders && (
          <div className="flex items-center gap-2 flex-shrink-0" aria-hidden>
            <PlaceholderIcon title="Известия">
              <path d="M6 8a6 6 0 1112 0v5l1.5 3h-15L6 13V8z" />
              <path d="M10 19a2 2 0 004 0" />
            </PlaceholderIcon>
            <PlaceholderIcon title="Настройки">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" />
            </PlaceholderIcon>
            {doctorInitials && (
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold"
                style={{ background: 'var(--color-brand-soft)', color: 'var(--color-brand)' }}
              >
                {doctorInitials}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Stepper row — full-width, same component as /app/scribe/result */}
      <Stepper steps={steps} current={current} />
    </header>
  );
}

function PlaceholderIcon({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <div
      className="w-8 h-8 rounded-md flex items-center justify-center"
      style={{ color: 'var(--color-text-hint)', opacity: 0.6, cursor: 'default' }}
      title={title}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
    </div>
  );
}
