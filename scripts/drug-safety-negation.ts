// Regression gate for Hallucination Fix #3 — negation-aware drug-safety matching.
//
// Background: the frontend regex "safety net" (lib/drug-safety.ts) matched
// diagnosis/allergy tokens with a raw `text.includes(term)`, which is
// negation-blind. anamneza such as "няма оплаквания за гастрит" (gastritis
// explicitly RULED OUT) fired a false НСПВС/PPI warning. False-positive safety
// alerts erode doctor trust, so this is locked here.
//
// No test runner is configured in this repo (only lint + build); this mirrors
// the backend's plain-script test culture. Run it as a regression gate:
//
//     npx tsx scripts/drug-safety-negation.ts
//
// Exits 0 when all assertions pass, non-zero (= number of failures) otherwise.
import { checkDrugSafety, type SafetyAlert } from '../lib/drug-safety';

let failures = 0;
function check(name: string, pass: boolean): void {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`);
  if (!pass) failures += 1;
}

// Alert classifiers, keyed on each rule's distinctive message text.
const hasPpiWarning = (a: SafetyAlert[]): boolean =>
  a.some((x) => x.message.includes('гастропротекция'));
const hasBetaBlockerWarning = (a: SafetyAlert[]): boolean =>
  a.some((x) => x.message.includes('бронхоспазъм'));
const hasPenicillinCritical = (a: SafetyAlert[]): boolean =>
  a.some((x) => x.severity === 'critical' && x.message.includes('пеницилин'));

// 1) THE BUG — gastritis ruled out in anamneza ⇒ NO НСПВС/PPI warning.
check(
  '1. negated gastritis ("няма оплаквания за гастрит") + diclofenac → NO PPI warning',
  !hasPpiWarning(
    checkDrugSafety({
      terapia: 'Диклофенак перорално, 1 таблетка два пъти дневно, след ядене.',
      medications_list: [{ inn: 'диклофенак' }],
      anamneza:
        'Болки в коляното след планински преход. Няма оточност. Няма оплаквания за гастрит.',
      osnovna_diagnoza: 'Ентезопатия на долен крайник, неуточнена',
      osnovna_mkb: 'M76.9',
    })
  )
);

// 2a) NO REGRESSION — asserted gastritis (plain text) ⇒ warning still fires.
check(
  '2a. asserted gastritis ("пациент с гастрит") + diclofenac → PPI warning fires',
  hasPpiWarning(
    checkDrugSafety({
      terapia: 'Диклофенак 50мг два пъти дневно.',
      medications_list: [{ inn: 'диклофенак' }],
      anamneza: 'Пациент с гастрит от години.',
      osnovna_diagnoza: 'Хроничен гастрит',
    })
  )
);

// 2b) NO REGRESSION — asserted via MKB code K25 ⇒ warning still fires.
check(
  '2b. asserted ulcer (osnovna_mkb "K25") + ibuprofen → PPI warning fires',
  hasPpiWarning(
    checkDrugSafety({
      terapia: 'Ибупрофен 400мг при болка.',
      medications_list: [{ inn: 'ибупрофен' }],
      osnovna_diagnoza: 'Язва на стомаха',
      osnovna_mkb: 'K25',
    })
  )
);

// 3a) SECOND RULE, SAME FLAW — negated asthma ⇒ NO beta-blocker warning.
check(
  '3a. negated asthma ("няма астма") + bisoprolol → NO beta-blocker warning',
  !hasBetaBlockerWarning(
    checkDrugSafety({
      terapia: 'Бисопролол 5мг веднъж дневно.',
      medications_list: [{ inn: 'бисопролол' }],
      anamneza: 'Артериална хипертония. Няма астма, няма ХОББ.',
      osnovna_diagnoza: 'Артериална хипертония',
      osnovna_mkb: 'I10',
    })
  )
);

// 3b) SECOND RULE — asserted asthma / J45 ⇒ warning still fires.
check(
  '3b. asserted asthma ("бронхиална астма", J45) + bisoprolol → beta-blocker warning fires',
  hasBetaBlockerWarning(
    checkDrugSafety({
      terapia: 'Бисопролол 5мг.',
      medications_list: [{ inn: 'бисопролол' }],
      anamneza: 'Пациент с бронхиална астма от детството.',
      osnovna_diagnoza: 'Бронхиална астма',
      osnovna_mkb: 'J45',
    })
  )
);

// 4) ALLERGY GUARD — a REAL penicillin allergy must still fire CRITICAL
//    (guards against over-suppression by the allergy-path negation change).
check(
  '4. real allergy (пеницилин in alergii) + амоксицилин → CRITICAL fires',
  hasPenicillinCritical(
    checkDrugSafety({
      terapia: 'Амоксицилин 500мг три пъти дневно.',
      medications_list: [{ inn: 'амоксицилин' }],
      alergii: ['Алергия към пеницилин'],
      anamneza: 'Остър фарингит.',
      osnovna_diagnoza: 'Остър фарингит',
      osnovna_mkb: 'J02',
    })
  )
);

// 5) ALLERGY NEGATION (bonus) — explicitly ruled-out allergy ⇒ NO CRITICAL.
//    Directly validates the allergy-path leg of the negation fix.
check(
  '5. negated allergy ("няма алергия към пеницилин") + амоксицилин → NO CRITICAL',
  !hasPenicillinCritical(
    checkDrugSafety({
      terapia: 'Амоксицилин 500мг три пъти дневно.',
      medications_list: [{ inn: 'амоксицилин' }],
      alergii: ['Няма алергия към пеницилин'],
      anamneza: 'Остър фарингит, без данни за лекарствена алергия.',
    })
  )
);

console.log(`\n${failures === 0 ? 'ALL PASS ✓' : `${failures} FAILED ✗`}`);
process.exit(failures);
