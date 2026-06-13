'use client';

// Single parametrized stepper. Each step optionally carries a `sublabel` —
// when omitted, the sublabel line is not rendered (used by the 3-step new-visit
// flow); when present, it renders as today (used by the 4-step record/result flow).
export interface StepperStep {
  label: string;
  sublabel?: string;
}

interface StepperProps {
  steps: StepperStep[];
  /** Zero-based index of the active step. */
  current: number;
}

export default function Stepper({ steps, current }: StepperProps) {
  return (
    <div
      className="flex items-center gap-2 px-6 py-3 border-b print:hidden"
      style={{
        background: 'var(--color-bg-card)',
        borderColor: 'var(--color-border)',
      }}
    >
      {steps.map((step, i) => {
        const isActive = i === current;
        const isDone   = i <  current;
        return (
          <div key={i} className="flex items-center gap-2 flex-1">
            <div
              aria-current={isActive ? 'step' : undefined}
              className="flex-1 flex items-center gap-3 px-4 py-2.5 rounded-lg border transition-all"
              style={{
                background: isActive ? 'var(--color-accent)' : 'transparent',
                borderColor: isActive
                  ? 'var(--color-accent)'
                  : 'var(--color-border)',
                boxShadow: isActive ? 'var(--shadow-card)' : 'none',
              }}
            >
              <span
                className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0"
                style={{
                  background: isActive
                    ? 'rgba(255,255,255,0.18)'
                    : isDone
                    ? 'var(--color-accent)'
                    : 'transparent',
                  borderWidth: 1,
                  borderColor: isActive
                    ? 'rgba(255,255,255,0.4)'
                    : isDone
                    ? 'var(--color-accent)'
                    : 'var(--color-border-mid)',
                  color: isActive
                    ? 'white'
                    : isDone
                    ? 'white'
                    : 'var(--color-text-hint)',
                }}
              >
                {isDone ? (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                       strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M5 12l5 5L19 7" />
                  </svg>
                ) : (
                  i + 1
                )}
              </span>
              <span className="flex flex-col min-w-0">
                <span
                  className="text-sm font-medium leading-tight"
                  style={{
                    color: isActive
                      ? 'white'
                      : isDone
                      ? 'var(--color-text-muted)'
                      : 'var(--color-text-muted)',
                  }}
                >
                  {step.label}
                </span>
                {step.sublabel && (
                  <span
                    className="text-[10px] uppercase tracking-widest"
                    style={{
                      color: isActive
                        ? 'rgba(255,255,255,0.7)'
                        : 'var(--color-text-hint)',
                    }}
                  >
                    {step.sublabel}
                  </span>
                )}
              </span>
            </div>
            {i < steps.length - 1 && (
              <span
                className="w-4 h-[1.5px] flex-shrink-0 rounded-full"
                style={{
                  background:
                    i < current
                      ? 'var(--color-accent)'
                      : 'var(--color-border-soft)',
                  opacity: i < current ? 0.5 : 1,
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
