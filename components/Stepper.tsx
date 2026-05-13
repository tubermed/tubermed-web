'use client';

export type StepperPhase = 'login' | 'record' | 'processing' | 'result';

const STEPS: Array<{ phase: StepperPhase; num: number; label: string; sublabel: string }> = [
  { phase: 'login', num: 1, label: 'Вход', sublabel: 'Пациент' },
  { phase: 'record', num: 2, label: 'Запис', sublabel: 'Консултация' },
  { phase: 'processing', num: 3, label: 'Обработка', sublabel: 'AI анализ' },
  { phase: 'result', num: 4, label: 'Резултат', sublabel: 'Документ' },
];

export default function Stepper({ active }: { active: StepperPhase }) {
  const activeIdx = STEPS.findIndex((s) => s.phase === active);

  return (
    <div
      className="flex items-center gap-2 px-6 py-3 border-b print:hidden"
      style={{
        background: 'var(--color-bg-card)',
        borderColor: 'var(--color-border)',
      }}
    >
      {STEPS.map((step, i) => {
        const isActive = i === activeIdx;
        const isDone = i < activeIdx;
        return (
          <div key={step.phase} className="flex items-center gap-2 flex-1">
            <div
              className="flex-1 flex items-center gap-3 px-4 py-2.5 rounded-lg border transition-all"
              style={{
                background: isActive ? 'var(--color-brand)' : 'transparent',
                borderColor: isActive
                  ? 'var(--color-brand)'
                  : 'var(--color-border)',
                boxShadow: isActive
                  ? '0 3px 14px rgba(107,26,61,0.28)'
                  : 'none',
              }}
            >
              <span
                className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0"
                style={{
                  background: isActive
                    ? 'rgba(255,255,255,0.18)'
                    : 'transparent',
                  borderWidth: 1,
                  borderColor: isActive
                    ? 'rgba(255,255,255,0.4)'
                    : isDone
                    ? 'var(--color-brand)'
                    : 'var(--color-border-mid)',
                  color: isActive
                    ? 'white'
                    : isDone
                    ? 'var(--color-brand)'
                    : 'var(--color-text-hint)',
                }}
              >
                {step.num}
              </span>
              <span className="flex flex-col min-w-0">
                <span
                  className="text-base italic leading-tight font-[family-name:var(--font-cormorant)]"
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
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <span
                className="w-4 h-px flex-shrink-0"
                style={{
                  background:
                    i < activeIdx
                      ? 'var(--color-brand)'
                      : 'var(--color-border-mid)',
                  opacity: i < activeIdx ? 0.35 : 1,
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
