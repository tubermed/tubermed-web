// The printable „Резюме за пациента" document.
//
// Lifted out of components/PatientSummaryModal.tsx (buildPrintHtml) — same
// markup, same styles, same copy. It moved for one reason: the modal is React
// and `npm test` is a DOM-free `node --test`, so while this lived in the .tsx
// nothing could call it. A document that leaves the building in the patient's
// hand and that no test can execute is a document whose contents are asserted
// by nobody — which is how it kept a `new Date()` through the лист date round.
//
// openPdfPreview injects the afterprint-close script + hides any `.actions`
// block (there is none here), so this is the whole document. Print and „save as
// PDF" are the same document: the browser's print dialog is the only PDF path,
// there is no second builder.

import { escapeHtml } from './exporters';

/**
 * Minimal, A5-friendly printable summary.
 *
 * There is NO patient parameter here, and there must not be one. This builder
 * took a `patientName` that rendered into the printed sheet directly above the
 * date cell; nothing ever passed it, so it was a dead channel — but a dead
 * channel into a patient-facing printed document is one call site away from a
 * live one, and the Trust Pack tells doctors, in these words: „В приложението
 * няма поле за ЕГН, име или дата на раждане — не можете да ги въведете, дори да
 * поискате." That sentence was true only because nobody had filled the argument
 * in. Removing the parameter is what makes it true because it cannot be.
 *
 * The summary identifies its визит by DATE and by nothing else. Held by
 * scripts/document-identity.test.ts, which reads the builders' signatures.
 *
 * `dateBg` is the day of the ПРЕГЛЕД, already formatted in Europe/Sofia by
 * lib/date.ts formatVisitDateBg — handed in, never computed here. This used to
 * open with `new Date().toLocaleDateString('bg-BG', …)`, so a summary generated
 * from a note recorded on 08.08 and printed on 28.08 put 28.08 in the patient's
 * hand. It is the same defect the амбулаторен лист carried (552d5ba), on the
 * one document that leaves the building.
 *
 * Empty `dateBg` = the visit's own timestamp is not known (see
 * formatVisitDateBg). The whole date block then drops out — the sheet shows NO
 * date rather than today's. Absent is a gap the doctor can see; today's date is
 * a false statement they cannot.
 */
export function buildPatientSummaryHtml(
  summary: string,
  dateBg: string,
): string {
  // The whole element, not just its text: an empty `.date` div still draws its
  // 14px margin, which reads as a document that lost its date.
  const dateHtml = dateBg ? `<div class="date">${escapeHtml(dateBg)}</div>\n` : '';
  return `<!doctype html><html lang="bg"><head><meta charset="utf-8">
<title>Резюме за пациента</title>
<style>
  @page { size: A5; margin: 14mm; }
  body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; color: #1a1a2e; line-height: 1.5; max-width: 520px; margin: 0 auto; padding: 16px; }
  h1 { font-size: 18px; margin: 0 0 2px; }
  .date { color: #888; font-size: 12px; margin-bottom: 14px; }
  .text { white-space: pre-wrap; font-size: 14px; }
</style></head><body>
<h1>Резюме за пациента</h1>
${dateHtml}<div class="text">${escapeHtml(summary)}</div>
</body></html>`;
}
