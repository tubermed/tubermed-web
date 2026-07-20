// ─────────────────────────────────────────────────────────────────────────────
// lib/pacemaker-template.ts — pacemaker-v1 DISPLAY descriptor (frontend
// mirror, DATA ONLY)
// ─────────────────────────────────────────────────────────────────────────────
// A committed in-repo mirror of the render-relevant slice of the backend's
// lib/templates/pacemaker-v1.js (labels, units, dot-paths, kind, display
// refNorma). Vercel ships only this repo — never runtime-read the backend
// file (ENOENTs in prod). When the backend template changes, update this
// mirror in the same PR (same discipline as lib/echo-template.ts and
// ial-inns.json / mkb10.json).
//
// Serves EMBEDDED investigation cards only (fields.izsledvania_blocks via the
// registry in lib/investigation-blocks.ts) — there is no standalone pacemaker
// note: the backend's VALID_NOTE_TYPES gates note_type to consultation/echo.
//
// Aliases and plausibility bounds live ONLY on the backend (they drive
// extraction + flagging); the frontend needs only what it renders.
//
// ⚠ WORKING DRAFT — field list pending validation with Соколов against a real
// interrogation printout; keep trivially editable, in lockstep with the
// backend module.
//
// There is NO diagnosis/МКБ field here by construction — an interrogation is
// a readout, not a diagnosis. `path` is the dot-path into the block's fields
// object; for a measurement the value lives at `${path}.value` / `${path}.unit`.

import type { EchoSectionDescriptor } from './echo-template';

export const PACEMAKER_SECTIONS: EchoSectionDescriptor[] = [
  {
    key: 'ustroistvo',
    title: 'Устройство',
    fields: [
      { path: 'ustroistvo.tip',               label: 'Тип устройство',                kind: 'text', refNorma: 'пейсмейкър / ICD / CRT-P / CRT-D' },
      { path: 'ustroistvo.proizvoditel',      label: 'Производител',                  kind: 'text' },
      { path: 'ustroistvo.model',             label: 'Модел',                         kind: 'text' },
      { path: 'ustroistvo.data_implantatsia', label: 'Дата на имплантация / възраст', kind: 'text' },
      { path: 'ustroistvo.rezhim',            label: 'Режим на стимулация',           kind: 'text' },
    ],
  },
  {
    key: 'bateria',
    title: 'Батерия',
    fields: [
      { path: 'bateria.status',        label: 'Статус на батерията',    kind: 'text', refNorma: 'OK / ERI / EOL' },
      { path: 'bateria.voltazh',       label: 'Волтаж на батерията',    kind: 'measurement', unit: 'V', refNorma: '2.6–3.2 (нова)' },
      { path: 'bateria.dylgotrainost', label: 'Оставаща дълготрайност', kind: 'measurement', unit: 'години' },
    ],
  },
  {
    key: 'predsarden_elektrod',
    title: 'Предсърден електрод',
    fields: [
      { path: 'elektrodi.predsarden.sensing',     label: 'Предсърден електрод — сензинг (амплитуда)', kind: 'measurement', unit: 'mV', refNorma: '≥1.5' },
      { path: 'elektrodi.predsarden.prag',        label: 'Предсърден електрод — праг на стимулация',  kind: 'measurement', unit: 'V',  refNorma: '≤1.5 (@ 0.4 ms)' },
      { path: 'elektrodi.predsarden.shirina',     label: 'Предсърден електрод — ширина на импулса',   kind: 'measurement', unit: 'ms' },
      { path: 'elektrodi.predsarden.impedans',    label: 'Предсърден електрод — импеданс',            kind: 'measurement', unit: 'Ω',  refNorma: '200–1500' },
      { path: 'elektrodi.predsarden.stimulatsia', label: 'Предсърден електрод — % стимулация',        kind: 'measurement', unit: '%' },
    ],
  },
  {
    key: 'kameren_elektrod',
    title: 'Камерен електрод',
    fields: [
      { path: 'elektrodi.kameren.sensing',     label: 'Камерен електрод — сензинг (амплитуда)', kind: 'measurement', unit: 'mV', refNorma: '≥5' },
      { path: 'elektrodi.kameren.prag',        label: 'Камерен електрод — праг на стимулация',  kind: 'measurement', unit: 'V',  refNorma: '≤1.5 (@ 0.4 ms)' },
      { path: 'elektrodi.kameren.shirina',     label: 'Камерен електрод — ширина на импулса',   kind: 'measurement', unit: 'ms' },
      { path: 'elektrodi.kameren.impedans',    label: 'Камерен електрод — импеданс',            kind: 'measurement', unit: 'Ω',  refNorma: '200–1500' },
      { path: 'elektrodi.kameren.stimulatsia', label: 'Камерен електрод — % стимулация',        kind: 'measurement', unit: '%' },
    ],
  },
  {
    key: 'lyav_kameren_elektrod',
    title: 'Ляв камерен електрод (CRT)',
    fields: [
      { path: 'elektrodi.lyav_kameren.sensing',  label: 'ЛК електрод — сензинг',            kind: 'measurement', unit: 'mV' },
      { path: 'elektrodi.lyav_kameren.prag',     label: 'ЛК електрод — праг на стимулация', kind: 'measurement', unit: 'V' },
      { path: 'elektrodi.lyav_kameren.impedans', label: 'ЛК електрод — импеданс',           kind: 'measurement', unit: 'Ω', refNorma: '200–1500' },
    ],
  },
  {
    key: 'nastroiki',
    title: 'Програмирани настройки',
    fields: [
      { path: 'nastroiki.bazova_chestota',         label: 'Базова честота',                         kind: 'measurement', unit: 'уд/мин' },
      { path: 'nastroiki.maksimalna_chestota',     label: 'Максимална честота',                     kind: 'measurement', unit: 'уд/мин' },
      { path: 'nastroiki.sensitivnost_predsardna', label: 'Програмирана сензитивност — предсърдна', kind: 'measurement', unit: 'mV' },
      { path: 'nastroiki.sensitivnost_kamerna',    label: 'Програмирана сензитивност — камерна',    kind: 'measurement', unit: 'mV' },
      { path: 'nastroiki.amplituda_predsardna',    label: 'Изходна амплитуда — предсърдна',         kind: 'measurement', unit: 'V' },
      { path: 'nastroiki.amplituda_kamerna',       label: 'Изходна амплитуда — камерна',            kind: 'measurement', unit: 'V' },
    ],
  },
  {
    key: 'aritmichni_epizodi',
    title: 'Аритмични епизоди',
    fields: [
      { path: 'epizodi.af_burden', label: 'Предсърдно натоварване (AT/AF burden)', kind: 'measurement', unit: '%' },
      { path: 'epizodi.vt_vf',     label: 'Епизоди VT / VF',                       kind: 'text' },
      { path: 'epizodi.terapii',   label: 'Проведени терапии (ATP / шок)',         kind: 'text' },
      { path: 'epizodi.drugo',     label: 'NSVT / друго',                          kind: 'text' },
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
