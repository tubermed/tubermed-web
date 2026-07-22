// Single source of truth for the consultation-flow Stepper labels.
// Used by /app/new-visit (current = 0), /app/scribe (current = 1 or 2),
// and /app/scribe/result (current = 3).

import type { StepperStep } from '@/components/Stepper';

export const SCRIBE_FLOW_STEPS: StepperStep[] = [
  { label: 'Вход',     sublabel: 'Преглед'     },
  { label: 'Запис',    sublabel: 'Консултация' },
  { label: 'Обработка', sublabel: 'AI анализ'   },
  { label: 'Резултат', sublabel: 'Документ'    },
];
