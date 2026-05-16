// Single source of truth for the consultation-flow Stepper labels.
// Used by /app/scribe (current = 1 or 2) and /app/scribe/result (current = 3).
// /app/new-visit uses its own 3-step inline array.

import type { StepperStep } from '@/components/Stepper';

export const SCRIBE_FLOW_STEPS: StepperStep[] = [
  { label: 'Вход',     sublabel: 'Пациент'     },
  { label: 'Запис',    sublabel: 'Консултация' },
  { label: 'Обработка', sublabel: 'AI анализ'   },
  { label: 'Резултат', sublabel: 'Документ'    },
];
