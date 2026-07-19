// ─────────────────────────────────────────────────────────────────────────────
// lib/echo-template.ts — echo-v1 DISPLAY descriptor (frontend mirror, DATA ONLY)
// ─────────────────────────────────────────────────────────────────────────────
// A committed in-repo mirror of the render-relevant slice of the backend's
// lib/templates/echo-v1.js (labels, units, dot-paths, kind, display refNorma).
// Vercel ships only this repo — never runtime-read the backend file (ENOENTs in
// prod). When the backend template changes, update this mirror in the same PR
// (same discipline as ial-inns.json / mkb10.json).
//
// This descriptor now serves TWO containers: the standalone echo note
// (EchoNoteView, note_type='echo') AND embedded investigation cards inside the
// консултация лист (fields.izsledvania_blocks, via the registry in
// lib/investigation-blocks.ts). A backend template change must keep BOTH in
// lockstep — the registry has no descriptors of its own, it only maps block
// `type` keys onto the section lists defined here.
//
// Aliases and plausibility bounds live ONLY on the backend (they drive
// extraction + flagging); the frontend needs only what it renders.
//
// There is NO diagnosis/МКБ field here by construction — the echo document has
// no such shape. `path` is the dot-path into the EchoFields object; for a
// measurement the value lives at `${path}.value` / `${path}.unit`.

export type EchoFieldKind = 'measurement' | 'text';

export interface EchoFieldDescriptor {
  path: string;
  label: string;
  kind: EchoFieldKind;
  unit?: string;       // canonical unit (measurements only)
  refNorma?: string;   // display-only reference range; never gates anything
}

export interface EchoSectionDescriptor {
  key: string;
  title: string;
  fields: EchoFieldDescriptor[];
}

export const ECHO_SECTIONS: EchoSectionDescriptor[] = [
  {
    key: 'lyava_kamera',
    title: 'Лява камера — размери и морфометрия',
    fields: [
      { path: 'izmervania.mkp',     label: 'Междукамерна преграда',            kind: 'measurement', unit: 'mm', refNorma: '6–11' },
      { path: 'izmervania.zslk',    label: 'Задна стена на ЛК',                kind: 'measurement', unit: 'mm', refNorma: '6–11' },
      { path: 'izmervania.lktdr',   label: 'Левокамерен теледиастолен размер', kind: 'measurement', unit: 'mm', refNorma: '39–59' },
      { path: 'izmervania.lktsr',   label: 'Левокамерен телесистолен размер',  kind: 'measurement', unit: 'mm', refNorma: '22–40' },
      { path: 'izmervania.lv_edv',  label: 'Теледиастолен обем',               kind: 'measurement', unit: 'ml' },
      { path: 'izmervania.lv_esv',  label: 'Телесистолен обем',                kind: 'measurement', unit: 'ml' },
      { path: 'izmervania.lv_masa', label: 'Левокамерна маса',                 kind: 'measurement', unit: 'g' },
    ],
  },
  {
    key: 'sistolna_funktsia',
    title: 'Лявокамерна систолна функция',
    fields: [
      { path: 'izmervania.fi',      label: 'Фракция на изтласкване',        kind: 'measurement', unit: '%', refNorma: '≥50' },
      { path: 'fi_metod',           label: 'Метод',                          kind: 'text' },
      { path: 'izmervania.gls',     label: 'Глобален лонгитудинален стрейн', kind: 'measurement', unit: '%', refNorma: '≤ -18' },
      { path: 'segmentna_kinetika', label: 'Сегментна кинетика',             kind: 'text' },
    ],
  },
  {
    key: 'diastolna_funktsia',
    title: 'Диастолна функция',
    fields: [
      { path: 'izmervania.e_valna',  label: 'E вълна',                 kind: 'measurement', unit: 'm/s' },
      { path: 'izmervania.a_valna',  label: 'A вълна',                 kind: 'measurement', unit: 'm/s' },
      { path: 'izmervania.e_a',      label: 'E/A отношение',           kind: 'measurement', unit: 'ratio' },
      { path: 'izmervania.dt',       label: 'Децелерационно време',    kind: 'measurement', unit: 'ms', refNorma: '140–240' },
      { path: 'izmervania.e_prim',   label: "e' (септален/латерален)", kind: 'measurement', unit: 'cm/s' },
      { path: 'izmervania.e_e_prim', label: "E/e'",                    kind: 'measurement', unit: 'ratio', refNorma: '<14' },
      { path: 'izmervania.lavi',     label: 'Индексиран обем на ЛП',   kind: 'measurement', unit: 'ml/m²', refNorma: '≤34' },
    ],
  },
  {
    key: 'lyavo_predsardie',
    title: 'Ляво предсърдие / Междупредсърдна преграда',
    fields: [
      { path: 'izmervania.lp', label: 'Ляво предсърдие (размер)',  kind: 'measurement', unit: 'mm', refNorma: '20–40' },
      { path: 'mpp',           label: 'Междупредсърдна преграда',  kind: 'text' },
    ],
  },
  {
    key: 'dyasno_sartse',
    title: 'Дясно сърце и белодробно налягане',
    fields: [
      { path: 'izmervania.dk',     label: 'Дясна камера, базален размер',     kind: 'measurement', unit: 'mm', refNorma: '25–41' },
      { path: 'izmervania.tapse',  label: 'ТАПСЕ',                            kind: 'measurement', unit: 'mm', refNorma: '≥17' },
      { path: 'izmervania.s_prim', label: "S' (трикуспидален)",              kind: 'measurement', unit: 'cm/s', refNorma: '≥9.5' },
      { path: 'izmervania.sndk',   label: 'Систолно налягане в дясна камера', kind: 'measurement', unit: 'mmHg', refNorma: '<35' },
      { path: 'izmervania.dp',     label: 'Дясно предсърдие (размер)',        kind: 'measurement', unit: 'mm' },
    ],
  },
  {
    key: 'aorta',
    title: 'Аорта',
    fields: [
      { path: 'izmervania.ao_koren', label: 'Аортен корен (синуси на Валсалва)', kind: 'measurement', unit: 'mm', refNorma: '≤ 40' },
      { path: 'izmervania.ao_asc',   label: 'Възходяща аорта (Аорта асценденс)', kind: 'measurement', unit: 'mm', refNorma: '≤ 38' },
    ],
  },
  {
    key: 'klapi',
    title: 'Клапи',
    fields: [
      { path: 'klapi.aortna.opisanie',            label: 'Аортна клапа',                        kind: 'text' },
      { path: 'klapi.aortna.vmax',                label: 'Аортна клапа — Vmax',                 kind: 'measurement', unit: 'm/s' },
      { path: 'klapi.aortna.sreden_gradient',     label: 'Аортна клапа — среден градиент',      kind: 'measurement', unit: 'mmHg' },
      { path: 'klapi.aortna.ava',                 label: 'Аортна клапа — клапна площ',          kind: 'measurement', unit: 'cm²' },
      { path: 'klapi.aortna.regurgitatsia',       label: 'Аортна регургитация (степен)',        kind: 'text' },
      { path: 'klapi.mitralna.opisanie',          label: 'Митрална клапа',                      kind: 'text' },
      { path: 'klapi.mitralna.mva',               label: 'Митрална клапа — клапна площ',        kind: 'measurement', unit: 'cm²' },
      { path: 'klapi.mitralna.regurgitatsia',     label: 'Митрална регургитация (степен)',      kind: 'text' },
      { path: 'klapi.trikuspidalna.opisanie',     label: 'Трикуспидална клапа',                 kind: 'text' },
      { path: 'klapi.trikuspidalna.tr_vmax',      label: 'Трикуспидална клапа — TR Vmax',       kind: 'measurement', unit: 'm/s' },
      { path: 'klapi.trikuspidalna.regurgitatsia', label: 'Трикуспидална регургитация (степен)', kind: 'text' },
      { path: 'klapi.pulmonalna.opisanie',        label: 'Пулмонална клапа',                    kind: 'text' },
      { path: 'klapi.pulmonalna.regurgitatsia',   label: 'Пулмонална регургитация / стеноза',   kind: 'text' },
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

// Every editable echo field path (measurement + text) — the render/serialize
// order of the document.
export const ECHO_FIELD_PATHS: string[] = ECHO_SECTIONS.flatMap((s) => s.fields.map((f) => f.path));

// Read a dot-path off an EchoFields object without throwing on a missing link.
export function readEchoPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>(
    (o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined),
    obj,
  );
}

// Immutably set a dot-path on an EchoFields object (clones each touched level).
// Numeric segments may walk INTO arrays (embedded blocks are addressed as
// `izsledvania_blocks.${i}.fields.${path}`), so an array level must be cloned
// as an ARRAY — spreading it into `{...}` would silently turn the blocks list
// into a plain object keyed '0','1',… and corrupt the persisted note.
export function setEchoPath<T>(obj: T, path: string, value: unknown): T {
  const keys = path.split('.');
  const root: Record<string, unknown> = { ...(obj as Record<string, unknown>) };
  let node = root;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    const cur = node[k];
    const cloned = Array.isArray(cur)
      ? [...cur]
      : cur && typeof cur === 'object'
        ? { ...(cur as Record<string, unknown>) }
        : {};
    node[k] = cloned;
    node = cloned as unknown as Record<string, unknown>;
  }
  node[keys[keys.length - 1]] = value;
  return root as T;
}
