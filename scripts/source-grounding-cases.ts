// Recall harness for the source-grounding matcher (lib/source-grounding.ts),
// driven by the 2026-06-15 traceability test session (5 real role-play
// consultations through the live pipeline). Two parts:
//
//   PART 1 — deterministic A1/A2 mechanism tests. Data is fully controlled here,
//     so each case reliably goes RED on the pre-fix matcher and GREEN after:
//       A1  therapy text fragments because dose/frequency runs (numbers + short
//           words) count toward the cluster gap → fix = CHARACTER-distance gap.
//       A2  gazetteer-normalized drug spelling in the note ≠ the raw Soniox
//           spelling in the transcript (нитрофуран[т]оин vs …туин, о↔у) → fix =
//           fuzzy (Levenshtein) token match, mirroring the backend gazetteer.
//       A2' inflected mention (метформин vs метформинът) → fix = inflection-aware
//           token match.
//
//   PART 2 — lifelike 5-case recall harness. Transcripts are VERBATIM from the
//     session; the note FIELD strings are RECONSTRUCTED from the notes+transcripts
//     (the exact field strings weren't captured in the report appendix), so this
//     part is a realistic recall check, NOT a byte-faithful reproduction of the
//     report's measured numbers. Asserts the mission target: therapy fields HIT.
//
// PRECISION guards live alongside so the recall work can't silently open false
// matches. No API, no test runner. Run from tubermed-web root:
//   npx tsx scripts/source-grounding-cases.ts

import { findSourceSpan } from '../lib/source-grounding';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string) {
  if (c) { console.log('  ✓ ' + m); passed++; }
  else { console.error('  ✗ ' + m); failed++; }
}
function hit(fieldKey: string, value: string, transcript: string): string | null {
  const r = findSourceSpan(fieldKey, value, transcript);
  return r ? transcript.slice(r.start, r.end) : null;
}

console.log('\n— PART 1: A1/A2 mechanism (deterministic RED→GREEN) —');

// A1 — dose/frequency run between two content words. Under token-gap clustering
// the 7-token numeric/short filler splits "амоксицилин" and "перорално" into two
// singleton clusters (neither clears the gate → null). Char-distance gap keeps
// them in one cluster (only ~22 chars apart).
{
  const t = 'Терапия с амоксицилин 500 мг 3 пъти на ден перорално седем дни.';
  const s = hit('terapia', 'амоксицилин перорално', t);
  assert(s !== null && s.includes('амоксицилин') && s.includes('перорално'),
    'A1: dose-run-separated content words ground as one span');
}

// A2 — the note carries the gazetteer-corrected drug name; the raw transcript has
// the Soniox corruption (о↔у). Exact matching can't bridge it; fuzzy (dist 1 on a
// 14-char word, threshold 2) can.
{
  const t = 'Предписвам нитрофурантуин сто милиграма два пъти дневно.';
  const s = hit('terapia', 'нитрофурантоин 100 мг', t);
  assert(s !== null && s.includes('нитрофурантуин'),
    'A2: gazetteer-normalized drug name fuzzy-matches the raw transcript spelling');
}

// A2' — inflected mention. "метформин" (9 chars, fuzzy threshold 1) vs the
// definite form "метформинът" is edit-distance 2 — beyond fuzzy — so it needs the
// inflection-suffix rule.
{
  const t = 'Метформинът се приема дневно сутрин.';
  const s = hit('terapia', 'метформин дневно', t);
  assert(s !== null && s.includes('Метформинът'),
    "A2': inflected drug mention (метформин→Метформинът) grounds");
}

console.log('\n— PRECISION guards (must hold after fuzzy/wider-gap) —');

// Short words must stay EXACT (threshold 0 at ≤4 chars) — no fuzzy false hits.
assert(findSourceSpan('osnovna_diagnoza', 'Грип', 'Пациентът има грях и температура.') === null,
  'precision: short word does not fuzzy-match a different short word (грип≠грях)');
// Different drugs sharing a prefix must NOT fuzzy-collapse.
assert(findSourceSpan('terapia', 'метопролол', 'Приема метформин дневно.') === null,
  'precision: метопролол does not fuzzy-match метформин');
// A drug absent from the transcript stays null.
assert(findSourceSpan('terapia', 'азитромицин', 'Кръвно налягане 150 на 90, пулс 78.') === null,
  'precision: drug absent from transcript → null');

console.log('\n— PART 2: lifelike 5-case recall (verbatim transcripts, reconstructed fields) —');

// Case 1 — Хипертония + захарен диабет
{
  const t = 'Така, записвам. Пациентката е жена на 68 години. Идва за диспансерен преглед. Има високо кръвно от години и захарен диабет тип 2. Оплаква се, че от около две седмици вечер има леко главоболие, понякога замайване, приставане. Казва, че кръвното вкъщи мери около 150 на 90. Не пуши. Рядко алкохол. Няма алергии. В момента приема периндоприл 5 мг сутрин и метформин 500 два пъти дневно. Признава, че понякога пропуска вечерната доза метформин. Обективно общо състояние е добро. В съзнание е контактна. Кръвно налягане е 152 на 94. Сърдечната дейност е ритмична, 78 удара в минута. Тегло 82 кг. Коремът е мек, неболезнен. Отоци по краката няма. Дишане често. Чисто. Диагноза: есенциална хипертония, недобре контролирана, захарен диабет тип 2. Качвам периндоприл на 10 мг сутрин. Метформинът остава същия, но обяснявам да не пропуска вечерната доза. Назначавам изследвания: кръвна захар на гладно, гликиран хемоглобин, креатинин, липиден профил. Давам направление за консултация при очен лекар за преглед на очните дена. Контролен преглед след един месец с резултатите.';
  assert(hit('osnovna_diagnoza', 'есенциална хипертония', t) !== null, 'case1 diag(spoken) HIT');
  assert(hit('terapia', 'Периндоприл 10 мг сутрин. Метформин 500 мг два пъти дневно. Да не пропуска вечерната доза.', t) !== null, 'case1 terapia HIT (mission)');
  assert(hit('naznacheni', 'Кръвна захар на гладно, гликиран хемоглобин, креатинин, липиден профил.', t) !== null, 'case1 naznacheni HIT');
  assert(hit('napravlenia', 'Консултация при очен лекар за преглед на очните дъна.', t) !== null, 'case1 napravlenia HIT');
}

// Case 2 — Остър фарингит
{
  const t = 'Пациент, мъж на 34 години, идва днес заради болки в гърлото от 3 дни. Оплаква се от болезнено преглъщане, дращене в гърлото, отпадналост с температура до 38° вчера вечерта. Хрема има лека, кашлицата е суха нощем, без задух, без болка в гърдите. Не пуши. Алергии няма известни. Не приема постоянна терапия. Общо състояние е добро. Гърлото е зачервено, сливиците са увеличени, без гноен налеп. Шийни лимфни възли леко увеличени и болезнени вдясно. Температура 37,6. Дишане чисто, двустранно, без хрипове. Сатурация 98. Ще запиша остър фарингит, най-вероятно вирусен. Не назначавам антибиотик засега. Препоръчвам почивка, повече течности, парацетамол при температура и болка, по една таблетка до три пъти дневно, и таблетки за смучене за гърлото. Обяснявам, че ако температурата се задържи над 3 дни или се появи гноен налеп, да дойде пак за преоценка. Болничен лист за 3 дни, контрол при нужда.';
  assert(hit('osnovna_diagnoza', 'остър фарингит', t) !== null, 'case2 diag(spoken) HIT');
  assert(hit('terapia', 'Парацетамол при температура и болка, до три пъти дневно. Таблетки за смучене за гърлото.', t) !== null, 'case2 terapia HIT (mission)');
}

// Case 3 — Лумбаго  (the crisp A1 case: therapy near-verbatim in the transcript)
{
  const t = 'Така, записвам нов преглед. Пациент, мъж на 46 години, професионален шофьор, дойде заради остра болка в кръста, започнала преди 2 дни и след като вдигнал тежък багаж. Тя е ниско в кръста, отдясно, усилва се при навеждане и при дълго седене зад волана. Не слиза към крака, няма изтръпване в краката, без проблеми с оринирането. Преди е имал подобни епизоди, но по-леки е, не приема редовна терапия, алергии няма. Походката е леко щадяща. По-подробно: има болезнен си мускулен спазъм, паравертебрално в лумбалната област дясно. Движенията в кръста са ограничени заради болката. Лазек отрицателен, но странно. Сетивност и сила в долните крайници запазени. Кръвно 130 на 80. Диагнозата е лумбаго, остра механична болка в кръста, без данни за притискане на нерв, незначим. Назначавам ибупрофен 400 мг три пъти дневно след храна за 5 дни и мускулен релаксант вечер. Препоръчвам да избягва вдигане на тежко и дълго шофиране няколко дни. Лека раздвижваща активност. Издавам болничен лист за 5 дни. Ако болката тръгне към крака или се появи изтръпване, да дойде веднага. При нужда — направление за физиотерапия.';
  assert(hit('osnovna_diagnoza', 'лумбаго', t) !== null, 'case3 diag(spoken) HIT');
  assert(hit('terapia', 'Ибупрофен 400 мг три пъти дневно след храна, 5 дни. Мускулен релаксант вечер.', t) !== null, 'case3 terapia HIT (mission — A1)');
  assert(hit('napravlenia', 'Физиотерапия.', t) !== null, 'case3 napravlenia HIT');
}

// Case 4 — Цистит  (the crisp A2 case: drug normalized away from the transcript)
{
  const t = 'Пациентка, жена на 29 години, идва заради паранепреуриниране и често ходене по мойка нужда от два дни. Усеща лек дискомфорт ниско в корема, без температура, без болка в кръста, без кръв в урината. Не е бременна. Последен цикъл преди 10 дни. Важно: има алергия към сулфонамиди и е получила обрив преди години. Други алергии няма. Не приема постоянни лекарства. Общо състояние добро. Афебрилна, мек корем, лека болезненост, надлонно. Бъбречните ложи са неболезнени. С окусия отрицателен двустранно. Кръвно 127/120 на 75. Диагнозата е остър неусложнен цистит. Заради алергията към сулфонамиди не назначавам котримоксазол. Предписвам нитрофурантуин, нитрофурантуин 100 мг два пъти дневно за пет дни. Препоръчвам повече течности. Обяснявам да не задържа уринирането. Назначавам изследване на урина, общо изследване и при нужда урокултура.';
  assert(hit('osnovna_diagnoza', 'остър неусложнен цистит', t) !== null, 'case4 diag(spoken) HIT');
  assert(hit('terapia', 'Нитрофурантоин 100 мг два пъти дневно, 5 дни.', t) !== null, 'case4 terapia HIT (mission — A2)');
  assert(hit('naznacheni', 'Общо изследване на урина, при нужда урокултура.', t) !== null, 'case4 naznacheni HIT');
}

// Case 5 — Педиатричен отит  (bonus A2: амоксицилин note vs амоксициклин transcript)
{
  const t = 'Преглед на дете, момче на 5 години, придружено от майка си. От снощи се оплаква от силна болка в дясното ухо, плакало през нощта. Майката съобщава температура до 38,5 и намален апетит. Преди 2-3 дни имало хрема и лека кашлица. Без повръщане, без обрив. Детето няма известни алергии и ваксините са по календар. Не приема постоянна терапия. Тегло около 19 кг. Обективно детето е леко отпаднало, но контактно. При отоскопия дясната тъпанчева мембрана е зачервена и изпъкнала, без перфорация. Лявото ухо е спокойно, гърлото леко зачервено, шийни лимфни възли леко увеличени. Дишане чисто, без хрипове, температура 38,2. Диагнозата е остър среден отит вдясно. Назначавам амоксициклин суспензия, дозирана според тялото, три пъти дневно за 7 дни, и парацетамол или ибупрофен при болка и температура в подходяща за детето доза. Обяснявам на майката признаците за влошаване.';
  assert(hit('osnovna_diagnoza', 'остър среден отит', t) !== null, 'case5 diag(spoken) HIT');
  assert(hit('terapia', 'Амоксицилин суспензия три пъти дневно, 7 дни. Парацетамол или ибупрофен при болка и температура.', t) !== null, 'case5 terapia HIT (mission — A2 амоксицилин↔амоксициклин)');
}

console.log('\n— PART 3: precision regressions fixed 2026-06-15 (from adversarial review) —');
// The first cut of A2 mirrored the gazetteer threshold min(floor(len/5),2) and an
// ≥4-char inflection base. A 6-lens adversarial sweep (51 cases) showed that was
// far too loose for MATCHING: it collapsed clinically OPPOSITE terms and distinct
// drugs (2 edits apart), and bridged short words to common Bulgarian words. The
// fix — fuzzy = exactly 1 edit on words ≥8 chars; inflection base ≥6 — must keep
// rejecting these. (Residual pre-existing limits — negation-blindness, exact
// homographs like става[joint/gets-up], scattered-but-present words — are Phase 2.)
function rejects(fieldKey: string, value: string, transcript: string): boolean {
  return findSourceSpan(fieldKey, value, transcript) === null;
}
assert(rejects('osnovna_diagnoza', 'Хипертония', 'Налягането е ниско днес, оплаква се от хипотония при ставане.'),
  'fuzzy: хипертония ↛ хипотония (opposite condition, 2 edits)');
assert(rejects('izsledvania', 'Хипергликемия', 'Кръвната захар спадна рязко, изоставаше хипогликемия преди обяд.'),
  'fuzzy: хипергликемия ↛ хипогликемия (opposite, 2 edits)');
assert(rejects('pridruzhavashti', 'Хипотиреоидизъм', 'Жлезата е свръхактивна, данни за хипертиреоидизъм по хормоните.'),
  'fuzzy: хипотиреоидизъм ↛ хипертиреоидизъм (opposite, 2 edits)');
assert(rejects('terapia', 'Азитромицин', 'Назначавам еритромицин два пъти дневно за седем дни.'),
  'fuzzy: азитромицин ↛ еритромицин (different antibiotic, 2 edits)');
assert(rejects('terapia', 'Преднизолон', 'Изписвам преднизон сутрин за десет дни и намаляваме постепенно.'),
  'fuzzy: преднизолон ↛ преднизон (different steroid, 2 edits)');
assert(rejects('terapia', 'Клоназепам', 'Вечер по половин таблетка лоразепам при безпокойство.'),
  'fuzzy: клоназепам ↛ лоразепам (different benzodiazepine)');
assert(rejects('osnovna_diagnoza', 'Нефрит', 'Пациентът има неврит на лицевия нерв вдясно.'),
  'fuzzy: нефрит ↛ неврит (1 edit but len 6 < 8 → exact-only)');
assert(rejects('obektivno', 'Скованост на врата', 'Скованост усеща, докато отваря вратата на колата.'),
  'inflection: врата(neck) ↛ вратата(door) — base < 6');
assert(rejects('izsledvania', 'Изследване на стол', 'Изследването приключи и болният стана от стола.'),
  'inflection: стол(stool) ↛ стола(chair) — base < 6');
// Positive control — a genuine 1-edit Soniox slip on a long drug name MUST still ground.
assert(hit('terapia', 'Метилпреднизолон 120 мг', 'Венозно метилпреднизалон сто двадесет милиграма еднократно.') !== null,
  'fuzzy positive control: метилпреднизолон↔метилпреднизалон (1 edit, len 16) grounds');

console.log('\n— PART 4: matched-token ranges (A4 — highlight only the matched portion) —');
// The matcher reports the individual matched-needle token ranges (not the filler
// between them), so the transcript view can light up ONLY the grounded words and
// grey the rest — a partial match can no longer falsely reassure that the whole
// field is grounded.
{
  const t = 'Терапия с амоксицилин 500 мг 3 пъти на ден перорално.';
  const r = findSourceSpan('terapia', 'амоксицилин перорално', t);
  const toks = r && r.tokens ? r.tokens.map((x) => t.slice(x.start, x.end)) : [];
  assert(toks.length === 2 && toks.includes('амоксицилин') && toks.includes('перорално'),
    'A4: tokens = the matched needle words only (амоксицилин, перорално)');
  assert(toks.length > 0 && !toks.some((x) => /\d/.test(x) || x === 'мг' || x === 'пъти' || x === 'ден'),
    'A4: matched tokens EXCLUDE dose/frequency filler (500, мг, 3, пъти, на, ден)');
  assert(!!r && r.tokens.every((x) => x.start >= r.start && x.end <= r.end),
    'A4: every matched token lies within the reported span');
}

console.log('\n— PART 5: vitals grounding (Обективен статус — numbers ARE the signal) —');
// Reproduces the live miss (P6): the Обективен-статус field is mostly numbers
// (RR 130/89, ДЧ 16) plus injected "не е измерено" placeholders. The matcher
// deliberately ignores numbers as needles, so the only content needles that match
// are "очистено"/"дишането" (2 of ~6) → below the coverage gate → null → the
// confusing "Не открихме ясен източник", even though the BP/RR was clearly said.
// Numbers must ground when they sit with their vital cue (and ONLY then).
const VITALS_FIELD =
  'RR: 130/89 mmHg | ЧСС: не е измерено | Температура: не е измерено | SpO2: не е измерено | ДЧ: 16/мин. Дишането очистено везикуларно.';
const VITALS_TRANSCRIPT =
  'Обективно, кръвно 130 на 89. Пулс не отчетох. Дишане 16 дихателни движения в минута, малко е очистено дишането.';
{
  const s = hit('obektivno', VITALS_FIELD, VITALS_TRANSCRIPT);
  assert(s !== null && s.includes('130') && s.includes('89') && s.includes('16'),
    'P6: RR 130/89 + ДЧ 16 ground to the transcript (was a blanket "no source")');
}

console.log('\n— PART 6: vitals PRECISION guards (numbers ground ONLY with a same-type cue) —');
// The numeric path is deliberately tight: a number grounds only when it equals a
// typed FIELD vital AND sits with a cue of the SAME type in the transcript. These
// lock out the false matches that motivated excluding numbers in the first place.
assert(rejects('obektivno', 'RR: 130/89 mmHg | ЧСС: не е измерено', 'Кръвно налягане 150 на 90, пулс 78.'),
  'precision: a DIFFERENT BP (150/90) does not ground RR 130/89');
assert(rejects('obektivno', 'ДЧ: 16/мин', 'Пациентът е на 16 години, без оплаквания.'),
  'precision: ДЧ 16 does not ground a bare "16 години" (no respiratory cue)');
assert(rejects('obektivno', 'RR: 130/89 mmHg', 'Изписвам 130 таблетки и 89 капки дневно.'),
  'precision: BP numbers present but not an adjacent pair near a BP cue → null');
assert(rejects('terapia', 'RR: 130/89', 'Кръвно налягане 130 на 89.'),
  'precision: numeric grounding is obektivno-scoped (terapia never number-grounds)');
// Positive control — a measured pulse near its spoken cue grounds.
{
  const s = hit('obektivno', 'ЧСС: 78/мин', 'Пулсът е 78 удара в минута.');
  assert(s !== null && s.includes('78'), 'vitals: pulse 78 grounds near "пулс/удара" cue');
}

console.log(`\n${passed + failed} assertions: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
