// ─────────────────────────────────────────────────────────────────────────────
// lib/ekg-template.ts — ekg-v1 DISPLAY descriptor (frontend mirror, DATA ONLY)
// ─────────────────────────────────────────────────────────────────────────────
// A committed in-repo mirror of the render-relevant slice of the backend's
// lib/templates/ekg-v1.js (labels, units, dot-paths, kind, display refNorma,
// render style). Vercel ships only this repo — never runtime-read the backend
// file (ENOENTs in prod). When the backend template changes, update this
// mirror in the same PR (same discipline as lib/echo-template.ts /
// lib/pacemaker-template.ts and ial-inns.json / mkb10.json).
//
// Serves EMBEDDED investigation cards only (fields.izsledvania_blocks via the
// registry in lib/investigation-blocks.ts) — there is no standalone ЕКГ note:
// the backend's VALID_NOTE_TYPES gates note_type to consultation/echo.
//
// DELIBERATELY LIGHT + PROSE-FIRST: an office ECG in an амбулаторен лист is
// one short paragraph („Синусов ритъм, 68/мин, нормална електрична ос, без
// исхемични промени."), not a measurement grid. EKG_RENDER_STYLE='paragraph'
// (mirroring the backend flag) makes the exporters join populated values into
// ONE paragraph in template order instead of label/value rows. PQ/QRS/QTc are
// deliberately NOT separate fields in v1 — they belong in `nahodki` prose.
//
// ⚠ WORKING DRAFT — field split pending validation with Соколов (AHA/ACCF/HRS
// standardizes the ECG statement lexicon, not a report field template); keep
// trivially editable, in lockstep with the backend module.
//
// There is NO diagnosis/МКБ field here by construction — an ECG readout is a
// description, not a diagnosis. Aliases and plausibility bounds live ONLY on
// the backend (they drive extraction + flagging).

import type { EchoSectionDescriptor } from './echo-template';

// Mirrors EKG_RENDER_STYLE in the backend template module.
export const EKG_RENDER_STYLE = 'paragraph' as const;

export const EKG_SECTIONS: EchoSectionDescriptor[] = [
  {
    key: 'ekg',
    title: 'ЕКГ',
    fields: [
      { path: 'ritam',    label: 'Ритъм',            kind: 'text', refNorma: 'синусов ритъм' },
      { path: 'chestota', label: 'Сърдечна честота', kind: 'measurement', unit: 'уд/мин', refNorma: '60–100' },
      { path: 'nahodki',  label: 'Находки',          kind: 'text' },
    ],
  },
  {
    key: 'zakljuchenie',
    title: 'Заключение',
    fields: [
      { path: 'zakljuchenie', label: 'Заключение', kind: 'text' },
    ],
  },
];
