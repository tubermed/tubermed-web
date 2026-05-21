// Drug-allergy safety engine — ported from v13.
// Three rule types: allergy-drug, drug-drug interaction, drug-diagnosis.
//
// Source-separation rules (avoid false positives):
//   - Allergies are read from анамнеза + alergii field only.
//   - Prescribed drugs are read from терапия + medications_list only —
//     mentioning a drug in анамнеза as a past therapy or in an allergy line
//     does NOT count as "prescribed now".
//   - Diagnoses are read from osnovna_diagnoza/mkb + pridruzhavashti +
//     анамнеза (where history-of-disease is common).

import type { TranscribeFields } from './types';

export type Severity = 'critical' | 'warning';

export interface SafetyAlert {
  severity: Severity;
  message: string;
  triggers: string[];
  /** Optional concrete remediation step shown as a sub-line under message.
   *  Populated from backend Claude-generated alerts; frontend regex engine
   *  leaves it undefined. */
  action?: string;
  /** Where this alert originated. Used for deduplication and (eventually)
   *  analytics on which engine catches what. */
  source?: 'backend' | 'frontend';
}

type AllergyRule = {
  type: 'allergy';
  allergy: string[];
  drugs: string[];
  severity: Severity;
  message: string;
};

type InteractionRule = {
  type: 'interaction';
  drugs1: string[];
  drugs2: string[];
  severity: Severity;
  message: string;
};

type DrugDiagRule = {
  type: 'drug-diag';
  drugs1: string[];
  diag: string[];
  severity: Severity;
  message: string;
};

type Rule = AllergyRule | InteractionRule | DrugDiagRule;

const RULES: Rule[] = [
  // ── CRITICAL — direct contraindications ──────────────
  {
    type: 'allergy',
    allergy: ['пеницилин', 'penicillin', 'амоксицилин'],
    drugs: [
      'амоксицилин',
      'ампицилин',
      'флемоксин',
      'аугментин',
      'ко-амоксиклав',
      'оксацилин',
      'пеницилин',
      'амоксил',
      'клавуланова',
    ],
    severity: 'critical',
    message:
      'Пеницилинова алергия — противопоказан пеницилинов антибиотик',
  },
  {
    type: 'allergy',
    allergy: ['цефалоспорин', 'цефтриаксон', 'цефазолин'],
    drugs: [
      'цефтриаксон',
      'цефазолин',
      'цефалексин',
      'зинат',
      'дурацеф',
      'цефиксим',
      'цефподоксим',
    ],
    severity: 'critical',
    message:
      'Алергия към цефалоспорини — противопоказан цефалоспоринов антибиотик',
  },
  {
    type: 'allergy',
    allergy: ['аспирин', 'нспвс', 'nsaid', 'ибупрофен', 'диклофенак'],
    drugs: [
      'аспирин',
      'ибупрофен',
      'диклофенак',
      'напроксен',
      'вольтарен',
      'нурофен',
      'мелоксикам',
      'целекоксиб',
      'кетопрофен',
      'индометацин',
    ],
    severity: 'critical',
    message:
      'Алергия към НСПВС/Аспирин — противопоказан нестероиден противовъзпалителен препарат',
  },
  {
    type: 'allergy',
    allergy: ['метамизол', 'аналгин', 'баралгин'],
    drugs: ['аналгин', 'метамизол', 'баралгин', 'спазмалгон'],
    severity: 'critical',
    message:
      'Алергия към метамизол — Аналгин / Баралгин са противопоказани',
  },
  {
    type: 'allergy',
    allergy: ['сулфонамид', 'бисептол', 'ко-тримоксазол', 'sulfa'],
    drugs: [
      'бисептол',
      'ко-тримоксазол',
      'трибрисен',
      'сулфаметоксазол',
      'целекоксиб',
      'целикоксиб',
      'celecoxib',
      'целебрекс',
    ],
    severity: 'critical',
    message:
      'Алергия към сулфонамиди — Целекоксиб е сулфонамид-производен COX-2 инхибитор, директно противопоказан',
  },
  {
    type: 'allergy',
    allergy: ['макролид', 'азитромицин', 'еритромицин', 'сумамед'],
    drugs: [
      'азитромицин',
      'еритромицин',
      'кларитромицин',
      'зитромакс',
      'сумамед',
      'roxithromycin',
    ],
    severity: 'critical',
    message:
      'Алергия към макролиди — противопоказан макролиден антибиотик',
  },
  {
    type: 'allergy',
    allergy: ['статин', 'симвастатин', 'аторвастатин', 'розувастатин'],
    drugs: [
      'симвастатин',
      'аторвастатин',
      'розувастатин',
      'ловастатин',
      'правастатин',
    ],
    severity: 'critical',
    message: 'Алергия към статини — противопоказан статинов препарат',
  },
  // ── WARNING — clinically significant interactions ─────
  {
    type: 'interaction',
    drugs1: [
      'аспирин',
      'ибупрофен',
      'диклофенак',
      'напроксен',
      'вольтарен',
      'нурофен',
      'мелоксикам',
    ],
    drugs2: [
      'варфарин',
      'ксарелто',
      'ривароксабан',
      'прадакса',
      'дабигатран',
      'апиксабан',
      'елихис',
      'хепарин',
      'клопидогрел',
    ],
    severity: 'warning',
    message:
      'НСПВС + антикоагулант — повишен риск от кървене; проверете дозировките',
  },
  {
    type: 'drug-diag',
    drugs1: [
      'бисопролол',
      'метопролол',
      'карведилол',
      'атенолол',
      'пропранолол',
      'небиволол',
    ],
    diag: ['астма', 'хобб', 'j45', 'j44', 'бронхоспазъм'],
    severity: 'warning',
    message:
      'Бета-блокер при астма/ХОББ — риск от бронхоспазъм; предпочетете кардиоселективен',
  },
  {
    type: 'drug-diag',
    drugs1: [
      'аспирин',
      'ибупрофен',
      'диклофенак',
      'напроксен',
      'вольтарен',
      'мелоксикам',
      'кетопрофен',
    ],
    diag: ['гастрит', 'язва', 'улкус', 'k25', 'k26', 'k27', 'стомашна'],
    severity: 'warning',
    message: 'НСПВС при гастрит / язва — добавете гастропротекция (PPI)',
  },
  {
    type: 'interaction',
    drugs1: [
      'лизиноприл',
      'рамиприл',
      'еналаприл',
      'периндоприл',
      'каптоприл',
      'зофеноприл',
    ],
    drugs2: ['калий', 'kalium', 'панангин', 'аспаркам'],
    severity: 'warning',
    message:
      'АСЕ-инхибитор + калий — риск от хиперкалиемия; контролирайте K⁺',
  },
  {
    type: 'interaction',
    drugs1: [
      'симвастатин',
      'аторвастатин',
      'розувастатин',
      'ловастатин',
    ],
    drugs2: ['фенофибрат', 'гемфиброзил', 'безафибрат'],
    severity: 'warning',
    message:
      'Статин + фибрат — повишен риск от миопатия / рабдомиолиза',
  },
  {
    type: 'drug-diag',
    drugs1: ['метформин', 'глюкофаж', 'сиофор'],
    diag: [
      'контраст',
      'рентген',
      'ct',
      'компютърна томография',
      'ангиография',
    ],
    severity: 'warning',
    message:
      'Метформин — спрете 48 ч преди/след контрастна процедура (риск лактацидоза)',
  },
];

function str(v: unknown): string {
  return v != null ? String(v) : '';
}

// ── ONLY what the doctor is prescribing right now ───────────
function buildPrescribedText(f: TranscribeFields): string {
  return [
    str(f.terapia),
    ...(f.medications_list || []).map((m) => str(m.inn) + ' ' + str(m.dose)),
  ]
    .join(' ')
    .toLowerCase();
}

// ── Allergies live in anamneza + dedicated alergii field ────
function buildAllergyText(f: TranscribeFields): string {
  const a = Array.isArray(f.alergii) ? f.alergii.join(' ') : str(f.alergii);
  return (a + ' ' + str(f.anamneza)).toLowerCase();
}

// ── Diagnoses for drug-diag rules ───────────────────────────
function buildDiagnosesText(f: TranscribeFields): string {
  return [
    str(f.osnovna_diagnoza),
    str(f.osnovna_mkb),
    str(f.anamneza),
    ...(f.pridruzhavashti || []).map((d) => str(d.diagnoza) + ' ' + str(d.mkb)),
  ]
    .join(' ')
    .toLowerCase();
}

export function checkDrugSafety(f: TranscribeFields): SafetyAlert[] {
  const prescribedText = buildPrescribedText(f);
  const allergyText = buildAllergyText(f);
  const diagnosesText = buildDiagnosesText(f);
  const alerts: SafetyAlert[] = [];

  // If nothing is prescribed at all, no drug-related alerts are possible.
  // This is the key guard that fixes the "allergy mentioned but no drug given"
  // false positive.
  if (!prescribedText.trim()) return alerts;

  for (const rule of RULES) {
    if (rule.type === 'allergy') {
      const allergyHit = rule.allergy.some((k) => allergyText.includes(k));
      const drugHit = rule.drugs.some((k) => prescribedText.includes(k));
      if (allergyHit && drugHit) {
        alerts.push({
          severity: rule.severity,
          message: rule.message,
          triggers: rule.drugs.filter((d) => prescribedText.includes(d)),
          source: 'frontend',
        });
      }
    } else if (rule.type === 'interaction') {
      const has1 = rule.drugs1.some((d) => prescribedText.includes(d));
      const has2 = rule.drugs2.some((d) => prescribedText.includes(d));
      if (has1 && has2) {
        alerts.push({
          severity: rule.severity,
          message: rule.message,
          triggers: [...rule.drugs1, ...rule.drugs2].filter((d) =>
            prescribedText.includes(d)
          ),
          source: 'frontend',
        });
      }
    } else if (rule.type === 'drug-diag') {
      const hasDrug = rule.drugs1.some((d) => prescribedText.includes(d));
      const hasDiag = rule.diag.some((d) => diagnosesText.includes(d));
      if (hasDrug && hasDiag) {
        alerts.push({
          severity: rule.severity,
          message: rule.message,
          triggers: rule.drugs1.filter((d) => prescribedText.includes(d)),
          source: 'frontend',
        });
      }
    }
  }
  return alerts;
}

// ── Backend ↔ frontend merge ────────────────────────────────────────
// Backend Claude-generated alerts live in fields.med_alerts and are the
// preferred source — they're context-aware and explain WHY the alert fires.
// Frontend regex rules are a safety net for cases backend missed (e.g.
// drug-name typos like "дикофенак" vs "диклофенак" that survive Soniox).
//
// Strategy: take all backend alerts, then add frontend alerts whose triggers
// don't already appear in any backend alert. Deduplication is shallow on
// purpose — for safety code, a duplicate alert is better than a missed one.

interface BackendAlert {
  drug?: string;
  severity?: string;
  reason?: string;
  action?: string;
}

function normalizeBackendSeverity(s: string | undefined): Severity {
  // Backend prompt emits 'CRITICAL' | 'WARNING' (uppercase per STEP 3 contract).
  // Frontend type is lowercase. Default to 'warning' for any unknown — safer
  // to flag than to silently drop.
  if (typeof s === 'string' && s.toUpperCase() === 'CRITICAL') return 'critical';
  return 'warning';
}

function adaptBackendAlert(a: BackendAlert): SafetyAlert | null {
  // Drop entries with neither a drug nor a reason — nothing useful to show.
  const drug = (a.drug || '').trim();
  const reason = (a.reason || '').trim();
  if (!drug && !reason) return null;
  const message = reason || `Внимание: ${drug}`;
  return {
    severity: normalizeBackendSeverity(a.severity),
    message,
    triggers: drug ? [drug.toLowerCase()] : [],
    action: a.action?.trim() || undefined,
    source: 'backend',
  };
}

/**
 * Build the doctor-facing alert list by merging backend Claude alerts
 * (preferred) with frontend regex alerts (safety net for typos / cases
 * Claude missed).
 *
 * Dedup rule: a frontend alert is suppressed only when its trigger drug
 * already appears (case-insensitive substring match either direction) in
 * a backend alert's triggers. Different drugs from the same rule still
 * surface — never silently swallow a frontend hit on a drug the backend
 * didn't mention.
 */
export function mergeBackendAlerts(
  backendAlerts: unknown,
  fields: TranscribeFields
): SafetyAlert[] {
  const backend: SafetyAlert[] = Array.isArray(backendAlerts)
    ? (backendAlerts as BackendAlert[])
        .map(adaptBackendAlert)
        .filter((a): a is SafetyAlert => a !== null)
    : [];

  const frontend = checkDrugSafety(fields);

  const backendDrugs = new Set(
    backend.flatMap((a) => a.triggers).map((t) => t.toLowerCase())
  );

  const frontendDeduped = frontend.filter((fa) => {
    // Suppress only if EVERY trigger of this frontend alert is already
    // covered by some backend trigger (or its substring). Conservative —
    // partial overlap still surfaces.
    if (fa.triggers.length === 0) return true;
    return !fa.triggers.every((t) => {
      const lt = t.toLowerCase();
      for (const bt of backendDrugs) {
        if (bt.includes(lt) || lt.includes(bt)) return true;
      }
      return false;
    });
  });

  return [...backend, ...frontendDeduped];
}
