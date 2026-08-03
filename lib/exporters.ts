// Export helpers — PDF (preview in new window, no auto-print),
// Word (.doc Blob), and plain text (for clipboard).
// PDF preview includes an in-page action bar with "Save as PDF" and "Close"
// buttons that are hidden when actually printing.

import type { TranscribeFields, EchoFields, InvestigationBlock } from './types';
import { mainDiagnosisPresentation, filedComorbidityTerm } from './diagnosis';
import type { MainDiagnosisPresentation } from './diagnosis';
import { ECHO_SECTIONS, readEchoPath, type EchoSectionDescriptor } from './echo-template';
import { getInvestigationBlockDescriptor } from './investigation-blocks';

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function clean(s: string): string {
  return s.replace(/\[\[(.+?)\]\]/g, '$1');
}

function fieldText(s: string | undefined): string {
  return clean((s || '').trim());
}

// ─── Practice / document identity (export header) ─────────────
// The doctor's OWN practice identifiers, printed in the header of the exported
// Амбулаторен лист (required on the НЗОК primary-document format). Sourced from
// api.me() on the result page. EVERY field is optional — an empty identity (no
// field set, or /me failed) renders the document BYTE-IDENTICAL to the
// pre-header version (backward-compatible).
export interface ExportIdentity {
  practiceName?: string | null;
  address?: string | null;
  rziNumber?: string | null;
  nzokContract?: string | null;
  phone?: string | null;
  doctorName?: string | null;
  specialty?: string | null;
  uin?: string | null;
}

// The provenance lines under the filed diagnosis, as an inline-styled fragment.
// Shared by the PDF and the Word doc (Word renders independently of the
// document's own <style>, so the styling has to be inline in both).
function diagNotesHtml(main: MainDiagnosisPresentation): string {
  const notes = [main.attributionLine, main.parentRubricLine].filter(Boolean);
  if (notes.length === 0) return '';
  return `<div style="margin-top:3px;font-size:9pt;font-weight:400;color:#586472">${notes
    .map((n) => escapeHtml(n))
    .join('<br>')}</div>`;
}

function identityHasContent(id: ExportIdentity): boolean {
  return [
    id.practiceName, id.address, id.rziNumber, id.nzokContract,
    id.phone, id.doctorName, id.specialty, id.uin,
  ].some((s) => !!(s && s.trim()));
}

// ─── PLAIN TEXT (for copy) ────────────────────────────────────

export function formatPlainText(f: TranscribeFields): string {
  const lines: string[] = [];

  const diagLines: string[] = [];
  // Filed term + code first (what an НЗОК reviewer anchors on), then the
  // provenance line — the dictated wording, or the explicit no-code marker.
  const main = mainDiagnosisPresentation(f);
  if (main.hasContent) {
    const mkb = main.code ? ' (МКБ: ' + main.code + ')' : '';
    diagLines.push('Основна диагноза: ' + main.term + mkb);
    for (const note of [main.attributionLine, main.parentRubricLine]) {
      if (note) diagLines.push('  ' + note);
    }
  }
  const co = (f.pridruzhavashti || []).filter(
    (d) => filedComorbidityTerm(d) || (d.mkb && d.mkb.trim())
  );
  if (co.length > 0) {
    diagLines.push('');
    diagLines.push('Придружаващи заболявания:');
    co.forEach((d, i) => {
      const mkb = d.mkb ? ' (МКБ: ' + d.mkb + ')' : '';
      diagLines.push(`${i + 1}. ${filedComorbidityTerm(d)}${mkb}`);
    });
  }
  if (diagLines.length > 0) {
    lines.push('ДИАГНОЗИ МКБ-10');
    lines.push(diagLines.join('\n'));
    lines.push('');
  }

  const section = (title: string, value: string | undefined) => {
    const v = fieldText(value);
    if (!v) return;
    lines.push(title);
    lines.push(v);
    lines.push('');
  };

  section('АНАМНЕЗА', anamnezaSectionText(f));
  section('ОБЕКТИВНО СЪСТОЯНИЕ', f.obektivno);

  // Изследвания — the shared section body (izsledvaniaSectionText below), so
  // the full-document copy and the per-section copy button cannot drift.
  const izsBody = izsledvaniaSectionText(f);
  if (izsBody) {
    lines.push('ИЗСЛЕДВАНИЯ');
    lines.push('');
    lines.push(izsBody);
    lines.push('');
  }

  section('ТЕРАПИЯ', f.terapia);

  if (f.medications_list && f.medications_list.length > 0) {
    lines.push('МЕДИКАМЕНТИ');
    f.medications_list.forEach((m) => {
      const parts = [m.inn, m.dose, m.regimen, m.route, m.duration].filter(Boolean);
      lines.push('• ' + parts.join(' · '));
    });
    lines.push('');
  }

  const izdBody = izdadeniSectionText(f);
  if (izdBody) {
    lines.push('ИЗДАДЕНИ ДОКУМЕНТИ');
    lines.push('');
    lines.push(izdBody);
    lines.push('');
  }

  return lines.join('\n').trim();
}

// ─── Анамнеза, with the allergy history folded in ────────────────────────────
// The амбулаторен лист has NO allergy field. Three independent sources agree on
// that (the НЗОК primary-document format, НЗИС nomenclature CL011, and the
// filed листове we have seen), so the allergies could not simply become a
// fourth section: adding a field the official form does not carry to a document
// with материална доказателствена сила is a change to what the document claims
// to be, not a formatting choice.
//
// Анамнеза is where an allergy history legally belongs, and it is already where
// the on-screen section sits, so the лист and the screen agree.
//
// TWO RULES, both deliberate:
//
//   1. The narrative is never rewritten. The allergy line is APPENDED after the
//      doctor's dictated text, never merged into it — the doctor is the legal
//      author and their wording is what was reviewed and confirmed.
//
//   2. An EMPTY allergy list renders NOTHING. It does not render "Няма известни
//      алергии". An empty array means nothing was extracted; it is not a
//      recorded denial, and printing one on a filed document would assert a
//      clinical fact the visit may never have established — the same reasoning
//      that removed the "няма открити рискове" empty state from the alerts
//      surface (2026-08-01). Absence of a line is honest; a manufactured denial
//      is not.
//
// Field notices (AI-uncertainty marks on individual allergens) deliberately do
// NOT travel here. They are a review aid, exactly like uncertain_spans, and no
// exporter has ever carried those onto the document.
const ALLERGY_LABEL = 'Алергии';

export function anamnezaSectionText(f: TranscribeFields): string {
  const narrative = fieldText(f.anamneza);

  const allergens = (Array.isArray(f.alergii) ? f.alergii : [])
    .map((a) => fieldText(typeof a === 'string' ? a : ''))
    .filter(Boolean);

  if (allergens.length === 0) return narrative;

  const line = `${ALLERGY_LABEL}: ${allergens.join(', ')}`;
  // Blank line between the dictated narrative and the appended line so the
  // reader can see where the doctor's text ends. Allergies with no narrative
  // still render — losing them because анамнеза happened to be empty would be
  // the exact omission this change exists to close.
  return narrative ? `${narrative}\n\n${line}` : line;
}

// ─── Per-section copy bodies (Изследвания / Издадени документи) ──────────────
// The result page's per-section CopyButtons for the two composite sections put
// EXACTLY these strings on the clipboard, and formatPlainText composes the
// full document from the SAME functions — one source of truth, so the section
// copy, the full copy, and (via blockPlainText → blockParagraph) the on-screen
// block cards can never drift apart. Empty section → '' (button copies
// nothing-worthy, exporter omits the header).

export function izsledvaniaSectionText(f: TranscribeFields): string {
  // Embedded blocks first, mirroring the on-screen card order, then results
  // (izsledvania) + ordered tests (naznacheni). No blocks → byte-identical to
  // the pre-block output.
  const segments = serializableBlocks(f.izsledvania_blocks)
    .map(blockPlainText)
    .filter(Boolean);
  const izs = fieldText(f.izsledvania);
  if (izs) segments.push('Резултати от изследвания:\n' + izs);
  const naz = fieldText(f.naznacheni);
  if (naz) segments.push('Назначени изследвания:\n' + naz);
  return segments.join('\n\n');
}

export function izdadeniSectionText(f: TranscribeFields): string {
  const nap = fieldText(f.napravlenia);
  return nap ? 'Направления:\n' + nap : '';
}

// ─── ECHO paste block (Изследвания → Резултати) ───────────────
// The echo readout serialized as a Изследвания→Резултати-shaped block for
// pasting into a hospital system — Соколов's „изследвания" mental model at the
// output layer. Measurements render as „Label: value unit", free-text sections
// as „Label: text"; only populated fields are emitted, in template order (incl.
// the aorta section). There is NO diagnosis/МКБ line — the echo document has no
// such shape by construction.
function echoMeasurementText(f: EchoFields, path: string, fallbackUnit?: string): string {
  const m = readEchoPath(f, path) as { value?: string; unit?: string } | undefined;
  const val = m && typeof m.value === 'string' ? m.value.trim() : '';
  if (!val) return '';
  const unit = m && typeof m.unit === 'string' && m.unit ? m.unit : (fallbackUnit || '');
  return unit ? `${val} ${unit}` : val;
}

// Shared serialization core for a template-sectioned fields object — used by
// the standalone echo document AND (per block) by embedded izsledvania_blocks.
// Only populated fields are emitted, in template order; Заключение is captured
// separately so every caller can place it last with its own chrome.
function templatePlainBody(
  f: EchoFields,
  sections: EchoSectionDescriptor[],
): { sectionLines: string[]; conclusion: string } {
  const sectionLines: string[] = [];
  let conclusion = '';
  for (const section of sections) {
    if (section.key === 'zakljuchenie') {
      conclusion = fieldText(readEchoPath(f, 'zakljuchenie') as string | undefined);
      continue;
    }
    const rows: string[] = [];
    for (const fld of section.fields) {
      const val = fld.kind === 'measurement'
        ? echoMeasurementText(f, fld.path, fld.unit)
        : fieldText(readEchoPath(f, fld.path) as string | undefined);
      if (val) rows.push(`  ${fld.label}: ${val}`);
    }
    if (rows.length > 0) {
      sectionLines.push(section.title.toUpperCase());
      sectionLines.push(...rows);
      sectionLines.push('');
    }
  }
  return { sectionLines, conclusion };
}

export function formatEchoPlainText(f: EchoFields): string {
  const lines: string[] = ['ЕХОКАРДИОГРАФСКО ИЗСЛЕДВАНЕ', ''];
  const { sectionLines, conclusion } = templatePlainBody(f, ECHO_SECTIONS);
  lines.push(...sectionLines);

  if (conclusion) {
    lines.push('ЗАКЛЮЧЕНИЕ:');
    lines.push(conclusion);
  }

  return lines.join('\n').trim();
}

// Printable / PDF HTML for the echo document — a clean report (title + date +
// sections + conclusion + disclaimer). Reuses openPdfPreview like the
// консултація path. No НЗОК diagnosis block (the echo readout has none).
// HTML twin of templatePlainBody: section header + label/value table per
// populated section. Header size/margin are parameterized so the standalone
// echo document keeps its exact markup (13pt / 20px — the defaults) while an
// embedded block renders the same structure one visual level down.
function templateHtmlSections(
  f: EchoFields,
  sections: EchoSectionDescriptor[],
  opts?: { headerFontPt?: number; headerMargin?: string },
): { secHtml: string[]; conclusion: string } {
  const esc = escapeHtml;
  const size = opts?.headerFontPt ?? 13;
  const margin = opts?.headerMargin ?? '20px 0 4px';
  const secHtml: string[] = [];
  let conclusion = '';

  for (const section of sections) {
    if (section.key === 'zakljuchenie') {
      conclusion = fieldText(readEchoPath(f, 'zakljuchenie') as string | undefined);
      continue;
    }
    const rows: string[] = [];
    for (const fld of section.fields) {
      const val = fld.kind === 'measurement'
        ? echoMeasurementText(f, fld.path, fld.unit)
        : fieldText(readEchoPath(f, fld.path) as string | undefined);
      if (!val) continue;
      rows.push(
        `<tr><td style="padding:3px 16px 3px 0;color:#5B6472;vertical-align:top">${esc(fld.label)}</td>` +
        `<td style="padding:3px 0;color:#1F2933;font-weight:600">${esc(val)}</td></tr>`,
      );
    }
    if (rows.length > 0) {
      secHtml.push(
        `<h2 style="font-family:'Inter',-apple-system,sans-serif;font-size:${size}pt;color:#1F3A5F;font-weight:600;margin:${margin};border-bottom:1px solid #DCE1E8;padding-bottom:3px">${esc(section.title)}</h2>` +
        `<table style="border-collapse:collapse;font-size:11pt">${rows.join('')}</table>`,
      );
    }
  }
  return { secHtml, conclusion };
}

export function generateEchoHtml(f: EchoFields, dateStr: string): string {
  const esc = escapeHtml;
  const { secHtml, conclusion } = templateHtmlSections(f, ECHO_SECTIONS);

  const conclusionHtml = conclusion
    ? `<h2 style="font-family:'Inter',-apple-system,sans-serif;font-size:13pt;color:#1F3A5F;font-weight:600;margin:20px 0 4px;border-bottom:1px solid #DCE1E8;padding-bottom:3px">Заключение</h2><p style="font-size:11pt;color:#1F2933;white-space:pre-wrap;margin:4px 0">${esc(conclusion)}</p>`
    : '';

  const disclaimer = typeof f._disclaimer === 'string' && f._disclaimer.trim()
    ? `<p style="font-size:8.5pt;color:#8A94A6;margin-top:28px;border-top:1px solid #ECEFF3;padding-top:8px">${esc(f._disclaimer)}</p>`
    : '';

  return `<!DOCTYPE html><html lang="bg"><head><meta charset="utf-8"><title>Ехокардиографско изследване</title></head>
<body style="font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:800px;margin:24px auto;padding:0 24px;color:#1F2933">
<div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:16px;margin-bottom:8px">
  <h1 style="font-size:20pt;color:#1F3A5F;font-weight:700;margin:0">Ехокардиографско изследване</h1>
  <span style="font-size:10pt;color:#5B6472">${esc(dateStr)}</span>
</div>
${secHtml.join('\n')}
${conclusionHtml}
${disclaimer}
</body></html>`;
}

// ─── Embedded investigation blocks → Изследвания sub-sections ─────────────────
// Serialize fields.izsledvania_blocks for the три consultation exporters.
// Tolerant reader, mirroring InvestigationBlockCard: a malformed block or an
// unregistered `type` contributes NOTHING; rows without the key serialize
// byte-identically to today. No new export path — these helpers only feed the
// existing (approval-gated) clipboard/PDF/Word flows.
interface SerializableBlock {
  title: string;
  sections: EchoSectionDescriptor[];
  fields: EchoFields;
  renderStyle?: 'paragraph';
}

function serializableBlocks(blocks: InvestigationBlock[] | undefined): SerializableBlock[] {
  if (!Array.isArray(blocks)) return [];
  const out: SerializableBlock[] = [];
  for (const b of blocks) {
    if (!b || typeof b !== 'object' || typeof b.type !== 'string') continue;
    if (!b.fields || typeof b.fields !== 'object') continue;
    const d = getInvestigationBlockDescriptor(b.type);
    if (!d) continue;
    out.push({ title: d.title, sections: d.sections, fields: b.fields, renderStyle: d.renderStyle });
  }
  return out;
}

// A renderStyle:'paragraph' block (ЕКГ) exports as ONE short paragraph — the
// populated values joined in template order, reading as the doctor's own
// sentence („Синусов ритъм, 68 уд/мин, нормална електрична ос, без исхемични
// промени."), never a stack of label/value rows. Заключение, when dictated,
// is appended as a labelled final sentence.
// EXPORTED as the single source of truth for the paragraph wording:
// InvestigationBlockCard renders the SAME string on-screen, so the card and
// the three exporters cannot drift.
export function blockParagraph(fields: EchoFields, sections: EchoSectionDescriptor[]): string {
  const parts: string[] = [];
  let conclusion = '';
  for (const section of sections) {
    for (const fld of section.fields) {
      const val = fld.kind === 'measurement'
        ? echoMeasurementText(fields, fld.path, fld.unit)
        : fieldText(readEchoPath(fields, fld.path) as string | undefined);
      if (!val) continue;
      if (section.key === 'zakljuchenie') conclusion = val;
      else parts.push(val);
    }
  }
  if (parts.length === 0 && !conclusion) return '';
  let p = parts.join(', ');
  if (p) {
    p = p.charAt(0).toUpperCase() + p.slice(1);
    if (!/[.!?]$/.test(p)) p += '.';
  }
  if (conclusion) p = p ? `${p} Заключение: ${conclusion}` : `Заключение: ${conclusion}`;
  if (!/[.!?]$/.test(p)) p += '.';
  return p;
}

// One block as a clipboard sub-section: „Ехокардиография:" + the same body the
// standalone echo paste-block emits (sans its document header), Заключение last.
function blockPlainText(b: SerializableBlock): string {
  if (b.renderStyle === 'paragraph') {
    const para = blockParagraph(b.fields, b.sections);
    return para ? `${b.title}: ${para}` : '';
  }
  const { sectionLines, conclusion } = templatePlainBody(b.fields, b.sections);
  if (sectionLines.length === 0 && !conclusion) return '';
  const lines: string[] = [b.title + ':', ''];
  lines.push(...sectionLines);
  if (conclusion) {
    lines.push('ЗАКЛЮЧЕНИЕ:');
    lines.push(conclusion);
  }
  return lines.join('\n').trimEnd();
}

// One block as an HTML sub-section (PDF + Word — inline styles only, so the
// fragment is independent of either document's global css). Same structure as
// the standalone echo report, one visual level below the Изследвания h2.
function blockHtml(b: SerializableBlock): string {
  if (b.renderStyle === 'paragraph') {
    const para = blockParagraph(b.fields, b.sections);
    if (!para) return '';
    return `<div style="margin:10px 0 14px"><div style="font-size:11.5pt;color:#1F3A5F;font-weight:600;margin:12px 0 0">◇ ${escapeHtml(b.title)}</div>` +
      `<p style="font-size:11pt;color:#1F2933;white-space:pre-wrap;margin:4px 0">${escapeHtml(para)}</p></div>`;
  }
  const { secHtml, conclusion } = templateHtmlSections(b.fields, b.sections, {
    headerFontPt: 10.5,
    headerMargin: '12px 0 2px',
  });
  if (secHtml.length === 0 && !conclusion) return '';
  const conclusionHtml = conclusion
    ? `<h2 style="font-family:'Inter',-apple-system,sans-serif;font-size:10.5pt;color:#1F3A5F;font-weight:600;margin:12px 0 2px;border-bottom:1px solid #DCE1E8;padding-bottom:3px">Заключение</h2>` +
      `<p style="font-size:11pt;color:#1F2933;white-space:pre-wrap;margin:4px 0">${escapeHtml(conclusion)}</p>`
    : '';
  return `<div style="margin:10px 0 14px"><div style="font-size:11.5pt;color:#1F3A5F;font-weight:600;margin:12px 0 0">◇ ${escapeHtml(b.title)}</div>${secHtml.join('')}${conclusionHtml}</div>`;
}

// ─── COPY TO CLIPBOARD ────────────────────────────────────────

export async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return fallbackCopy(text);
    }
  }
  return fallbackCopy(text);
}

function fallbackCopy(text: string): boolean {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  document.body.removeChild(ta);
  return ok;
}

// ─── PDF / Print preview ──────────────────────────────────────

function pdfSection(title: string, content: string): string {
  const v = fieldText(content);
  if (!v) return '';
  return `<h2 style="font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14pt;color:#1F3A5F;font-weight:600;letter-spacing:-0.01em;margin:24px 0 6px;border-bottom:1px solid #DCE1E8;padding-bottom:4px">${escapeHtml(title)}</h2>
       <p style="margin:0;line-height:1.75;white-space:pre-wrap;font-size:11pt">${escapeHtml(v)}</p>`;
}

function pdfIdentityHeader(id: ExportIdentity): string {
  const v = (s?: string | null) => escapeHtml((s || '').trim());
  const pn = v(id.practiceName), addr = v(id.address), ph = v(id.phone);
  const rzi = v(id.rziNumber), nzok = v(id.nzokContract);
  const dn = v(id.doctorName), sp = v(id.specialty), uin = v(id.uin);
  const left = [
    pn   ? `<div style="font-weight:600;color:#1F3A5F;font-size:11pt">${pn}</div>` : '',
    addr ? `<div>${addr}</div>` : '',
    ph   ? `<div>тел.: ${ph}</div>` : '',
    rzi  ? `<div>Рег. № (РЗИ): ${rzi}</div>` : '',
    nzok ? `<div>Договор с НЗОК: ${nzok}</div>` : '',
  ].filter(Boolean).join('');
  const right = [
    dn  ? `<div style="font-weight:600;color:#1F3A5F">${dn}</div>` : '',
    sp  ? `<div>${sp}</div>` : '',
    uin ? `<div>УИН: ${uin}</div>` : '',
  ].filter(Boolean).join('');
  if (!left && !right) return '';
  return `<div style="display:flex;justify-content:space-between;gap:24px;font-size:9.5pt;color:#586472;line-height:1.5;margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid #DCE1E8">
        <div>${left}</div>
        <div style="text-align:right">${right}</div>
      </div>`;
}

function pdfSignatureLine(id: ExportIdentity): string {
  const dn = escapeHtml((id.doctorName || '').trim());
  return `<div style="margin-top:40px;display:flex;justify-content:flex-end">
        <div style="text-align:center;font-size:10pt;color:#586472">
          <div style="border-top:1px solid #8893A1;width:240px;margin-bottom:4px"></div>
          Подпис и печат${dn ? ' — ' + dn : ''}
        </div>
      </div>`;
}

export function generatePdfHtml(f: TranscribeFields, dateStr: string, identity?: ExportIdentity): string {
  const hasId = !!identity && identityHasContent(identity);
  const idHeader = hasId ? pdfIdentityHeader(identity!) : '';
  const idSignature = hasId ? pdfSignatureLine(identity!) : '';

  let diagRows = '';
  // Filed term + code is the anchor row; the provenance line rides inside the
  // same cell so the row border never separates a term from what explains it.
  const pdfMain = mainDiagnosisPresentation(f);
  if (pdfMain.hasContent) {
    diagRows += `<tr><td><strong>${escapeHtml(pdfMain.term)}</strong>${diagNotesHtml(pdfMain)}</td>
       <td style="white-space:nowrap;font-family:monospace;color:#1F3A5F;font-weight:700">${escapeHtml(pdfMain.code)}</td></tr>`;
  }
  (f.pridruzhavashti || []).forEach((d) => {
    const coTerm = filedComorbidityTerm(d);
    if (!coTerm && !d.mkb?.trim()) return;
    diagRows += `<tr><td>${escapeHtml(coTerm)}</td>
       <td style="white-space:nowrap;font-family:monospace;color:#1F3A5F">${escapeHtml(d.mkb || '')}</td></tr>`;
  });

  let medsBlock = '';
  if (f.medications_list && f.medications_list.length > 0) {
    const rows = f.medications_list
      .map((m) => {
        const parts = [m.dose, m.regimen, m.route, m.duration]
          .filter(Boolean)
          .join(' · ');
        return `<tr><td style="padding:4px 8px 4px 0"><strong>${escapeHtml(m.inn)}</strong></td>
                  <td style="padding:4px 0;color:#586472">${escapeHtml(parts)}</td></tr>`;
      })
      .join('');
    medsBlock = `<h2 style="font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14pt;color:#1F3A5F;font-weight:600;letter-spacing:-0.01em;margin:24px 0 6px;border-bottom:1px solid #DCE1E8;padding-bottom:4px">Медикаменти</h2>
       <table>${rows}</table>`;
  }

  // Embedded blocks render right under the Изследвания header, ahead of the
  // free-text subsections (same order as the on-screen cards). '' when absent.
  const blocksHtml = serializableBlocks(f.izsledvania_blocks).map(blockHtml).join('');

  const izsledvaniaHeader =
    fieldText(f.izsledvania) || fieldText(f.naznacheni) || blocksHtml
      ? `<h2 style="font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14pt;color:#1F3A5F;font-weight:600;letter-spacing:-0.01em;margin:24px 0 6px;border-bottom:1px solid #DCE1E8;padding-bottom:4px">Изследвания</h2>`
      : '';

  const izdadeniHeader =
    fieldText(f.napravlenia)
      ? `<h2 style="font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14pt;color:#1F3A5F;font-weight:600;letter-spacing:-0.01em;margin:24px 0 6px;border-bottom:1px solid #DCE1E8;padding-bottom:4px">Издадени документи</h2>`
      : '';

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
    <title>Амбулаторен лист — ${escapeHtml(dateStr)}</title>
    <style>
      body{margin:0;padding:32px 48px;font-family:'Inter','Segoe UI',Arial,sans-serif;font-size:11pt;color:#1C2733;background:#F3F5F8}
      h1{font-family:'Inter','Segoe UI',Arial,sans-serif;font-size:22pt;font-weight:600;letter-spacing:-0.01em;margin:0 0 4px;color:#1F3A5F}
      table{width:100%;border-collapse:collapse;margin-top:8px}
      td{padding:5px 10px 5px 0;border-bottom:1px solid #EDF0F4;vertical-align:top}

      /* In-preview action bar — only visible on screen, never on paper */
      .actions{
        position:sticky;top:0;z-index:10;
        display:flex;gap:8px;justify-content:flex-end;align-items:center;
        background:#FFFFFF;border-bottom:1px solid #DCE1E8;
        margin:-32px -48px 24px;padding:12px 48px;
      }
      .actions button{
        font-family:inherit;font-size:13px;font-weight:500;
        padding:8px 16px;border-radius:6px;cursor:pointer;
        border:1px solid transparent;transition:opacity .15s,background .15s;
      }
      .actions button.primary{
        background:#1F3A5F;color:#FFFFFF;border-color:#1F3A5F;
      }
      .actions button.primary:hover{opacity:.9}
      .actions button.secondary{
        background:transparent;color:#586472;border-color:#C2CAD4;
      }
      .actions button.secondary:hover{background:#EDF0F4}

      .doc{background:white;max-width:780px;margin:0 auto;padding:0}

      @media print{
        body{background:white;padding:16px 24px}
        .actions{display:none !important}
        .doc{max-width:none;padding:0}
        @page{margin:15mm}
      }
    </style></head><body>
    <div class="actions">
      <button class="secondary" onclick="window.close()">Затвори</button>
      <button class="primary" onclick="window.print()">⬇ Запази като PDF</button>
    </div>
    <div class="doc">${idHeader}
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:4px">
        <h1>Амбулаторен лист</h1>
        <div style="text-align:right;font-size:10pt;color:#8893A1">Дата: ${escapeHtml(dateStr)}</div>
      </div>
      <hr style="border:none;border-top:2px solid #1F3A5F;margin:0 0 20px">

      ${
        diagRows
          ? `<h2 style="font-family:'Inter','Segoe UI',Arial,sans-serif;font-size:14pt;color:#1F3A5F;font-weight:600;letter-spacing:-0.01em;margin:0 0 6px;border-bottom:1px solid #DCE1E8;padding-bottom:4px">Диагнози МКБ-10</h2>
      <table>${diagRows}</table>`
          : ''
      }

      ${pdfSection('Анамнеза', anamnezaSectionText(f))}
      ${pdfSection('Обективно състояние', f.obektivno || '')}
      ${izsledvaniaHeader}${blocksHtml}
      ${pdfSection('Резултати от изследвания', f.izsledvania || '')}
      ${pdfSection('Назначени изследвания', f.naznacheni || '')}
      ${pdfSection('Терапия', f.terapia || '')}
      ${medsBlock}
      ${izdadeniHeader}
      ${pdfSection('Направления', f.napravlenia || '')}${idSignature}
    </div>
  </body></html>`;
}

export interface OpenPreviewOpts {
  autoPrint?: boolean;
}

export function openPdfPreview(html: string, opts?: OpenPreviewOpts): boolean {
  const win = window.open('', '_blank', 'width=900,height=900');
  if (!win) return false;

  // Inject two things into the HTML before writing:
  //  1. `afterprint` listener that closes the window when the print dialog
  //     dismisses (save OR cancel). Prevents the lingering preview window.
  //  2. If autoPrint is on, hide the in-page action bar so nothing flashes
  //     on screen before the print dialog opens.
  const closeScript =
    "<script>window.addEventListener('afterprint',function(){setTimeout(function(){try{window.close()}catch(_){}},150)});</script>";
  const hideActionsCss = opts?.autoPrint
    ? '<style>.actions{display:none !important}</style>'
    : '';

  const finalHtml = html
    .replace('</head>', hideActionsCss + '</head>')
    .replace('</body>', closeScript + '</body>');

  win.document.write(finalHtml);
  win.document.close();

  if (opts?.autoPrint) {
    const tryPrint = () => {
      try {
        win.focus();
        win.print();
      } catch {
        // best-effort
      }
    };
    if (win.document.readyState === 'complete') {
      setTimeout(tryPrint, 250);
    } else {
      win.addEventListener('load', () => setTimeout(tryPrint, 100));
    }
  }
  return true;
}

// ─── WORD (.doc download) ────────────────────────────────────

function wordIdentityHeader(id: ExportIdentity): string {
  const v = (s?: string | null) => escapeHtml((s || '').trim());
  const pn = v(id.practiceName), addr = v(id.address), ph = v(id.phone);
  const rzi = v(id.rziNumber), nzok = v(id.nzokContract);
  const dn = v(id.doctorName), sp = v(id.specialty), uin = v(id.uin);
  const left = [
    pn   ? `<div style="font-weight:bold;color:#1F3A5F">${pn}</div>` : '',
    addr ? `<div>${addr}</div>` : '',
    ph   ? `<div>тел.: ${ph}</div>` : '',
    rzi  ? `<div>Рег. № (РЗИ): ${rzi}</div>` : '',
    nzok ? `<div>Договор с НЗОК: ${nzok}</div>` : '',
  ].filter(Boolean).join('');
  const right = [
    dn  ? `<div style="font-weight:bold;color:#1F3A5F">${dn}</div>` : '',
    sp  ? `<div>${sp}</div>` : '',
    uin ? `<div>УИН: ${uin}</div>` : '',
  ].filter(Boolean).join('');
  if (!left && !right) return '';
  return `<table border="0" style="width:100%;border-collapse:collapse;margin-bottom:16px;font-size:9pt;color:#586472">
  <tr>
    <td style="vertical-align:top;border:none;padding:0">${left}</td>
    <td style="vertical-align:top;border:none;padding:0;text-align:right">${right}</td>
  </tr>
</table>`;
}

function wordIdentitySignature(id: ExportIdentity): string {
  const dn = escapeHtml((id.doctorName || '').trim());
  return `<p style="margin-top:36pt;text-align:right">Подпис и печат: ____________________${
    dn ? '<br><span style="font-size:9pt;color:#888">' + dn + '</span>' : ''
  }</p>`;
}

export function generateWordHtml(f: TranscribeFields, dateStr: string, identity?: ExportIdentity): string {
  const hasId = !!identity && identityHasContent(identity);
  const idHeader = hasId ? wordIdentityHeader(identity!) : '';
  const idSignature = hasId ? wordIdentitySignature(identity!) : '';

  let pdRows = '';
  (f.pridruzhavashti || []).forEach((d, i) => {
    const coTerm = filedComorbidityTerm(d);
    if (!coTerm && !d.mkb?.trim()) return;
    pdRows += `<tr>
      <td style="padding:6px 10px;border:1px solid #ccc;width:50px;color:#555">${i + 1}.</td>
      <td style="padding:6px 10px;border:1px solid #ccc">${escapeHtml(coTerm)}</td>
      <td style="padding:6px 10px;border:1px solid #ccc;font-family:Courier New;color:#1F3A5F;white-space:nowrap">${escapeHtml(d.mkb || '')}</td>
    </tr>`;
  });

  let medsRows = '';
  (f.medications_list || []).forEach((m) => {
    const parts = [m.dose, m.regimen, m.route, m.duration]
      .filter(Boolean)
      .join(' · ');
    medsRows += `<tr>
      <td style="padding:6px 10px;border:1px solid #ccc"><strong>${escapeHtml(m.inn)}</strong></td>
      <td style="padding:6px 10px;border:1px solid #ccc;color:#586472">${escapeHtml(parts)}</td>
    </tr>`;
  });

  const para = (title: string, value: string | undefined) => {
    const v = fieldText(value);
    if (!v) return '';
    return `<h2>${escapeHtml(title)}</h2><p>${escapeHtml(v).replace(/\n/g, '<br>')}</p>`;
  };

  const wordMain = mainDiagnosisPresentation(f);

  // Embedded blocks — same inline-styled fragment as the PDF (Word renders it
  // independently of this document's global h2 css). '' when absent.
  const blocksHtml = serializableBlocks(f.izsledvania_blocks).map(blockHtml).join('');

  return `
<html xmlns:o='urn:schemas-microsoft-com:office:office'
      xmlns:w='urn:schemas-microsoft-com:office:word'
      xmlns='http://www.w3.org/TR/REC-html40'>
<head><meta charset='UTF-8'>
<style>
  body { font-family: 'Inter', 'Segoe UI', Arial, sans-serif; font-size: 11pt; margin: 2cm; color: #1C2733; }
  h1 { font-size: 14pt; text-align: center; border-bottom: 2px solid #1F3A5F; padding-bottom: 8px; margin-bottom: 20px; }
  h2 { font-size: 10pt; text-transform: uppercase; letter-spacing: 1px; color: #1F3A5F; margin: 18px 0 6px; border-bottom: 1px solid #dde1e7; padding-bottom: 4px; }
  p { line-height: 1.7; margin: 4px 0 10px; }
  table { border-collapse: collapse; width: 100%; margin-bottom: 10px; }
  .meta { font-size: 9pt; color: #888; text-align: right; margin-bottom: 20px; }
</style>
</head>
<body>${idHeader}
<h1>АМБУЛАТОРЕН ЛИСТ</h1>
<p class="meta">Дата: ${escapeHtml(dateStr)}</p>

${
  wordMain.hasContent
    ? `<h2>Основна диагноза</h2>
<table>
  <tr>
    <td style="padding:6px 10px;border:1px solid #ccc">${escapeHtml(wordMain.term)}${diagNotesHtml(wordMain)}</td>
    <td style="padding:6px 10px;border:1px solid #ccc;font-family:Courier New;color:#1F3A5F;white-space:nowrap;width:80px">${escapeHtml(wordMain.code)}</td>
  </tr>
</table>`
    : ''
}

${pdRows ? `<h2>Придружаващи заболявания</h2><table>${pdRows}</table>` : ''}

${para('Анамнеза', anamnezaSectionText(f))}
${para('Обективно състояние', f.obektivno)}

${fieldText(f.izsledvania) || fieldText(f.naznacheni) || blocksHtml ? '<h2>Изследвания</h2>' : ''}${blocksHtml}
${para('Резултати от изследвания', f.izsledvania)}
${para('Назначени изследвания', f.naznacheni)}

${para('Терапия', f.terapia)}

${medsRows ? `<h2>Медикаменти</h2><table>${medsRows}</table>` : ''}

${fieldText(f.napravlenia) ? '<h2>Издадени документи</h2>' : ''}
${para('Направления', f.napravlenia)}
${idSignature}
</body></html>`;
}

export function downloadWord(html: string, filename: string): void {
  const blob = new Blob(['\ufeff', html], { type: 'application/msword' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
