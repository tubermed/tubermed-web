// Export helpers — PDF (preview in new window, no auto-print),
// Word (.doc Blob), and plain text (for clipboard).
// PDF preview includes an in-page action bar with "Save as PDF" and "Close"
// buttons that are hidden when actually printing.

import type { TranscribeFields, EchoFields, InvestigationBlock } from './types';
import { filedMainTerm, filedComorbidityTerm } from './diagnosis';
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
  const mainTerm = filedMainTerm(f); // official term for a valid code; spoken fallback
  if (mainTerm) {
    const mkb = f.osnovna_mkb ? ' (МКБ: ' + f.osnovna_mkb + ')' : '';
    diagLines.push('Основна диагноза: ' + mainTerm + mkb);
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

  section('АНАМНЕЗА', f.anamneza);
  section('ОБЕКТИВНО СЪСТОЯНИЕ', f.obektivno);

  // Изследвания — embedded blocks (izsledvania_blocks) first, mirroring the
  // on-screen card order, then results (izsledvania) + ordered tests
  // (naznacheni). No blocks → byte-identical to the pre-block output.
  const izs = fieldText(f.izsledvania);
  const naz = fieldText(f.naznacheni);
  const blockTexts = serializableBlocks(f.izsledvania_blocks)
    .map(blockPlainText)
    .filter(Boolean);
  if (izs || naz || blockTexts.length > 0) {
    lines.push('ИЗСЛЕДВАНИЯ');
    for (const bt of blockTexts) {
      lines.push('');
      lines.push(bt);
    }
    if (izs) {
      lines.push('');
      lines.push('Резултати от изследвания:');
      lines.push(izs);
    }
    if (naz) {
      lines.push('');
      lines.push('Назначени изследвания:');
      lines.push(naz);
    }
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

  const nap = fieldText(f.napravlenia);
  if (nap) {
    lines.push('ИЗДАДЕНИ ДОКУМЕНТИ');
    lines.push('');
    lines.push('Направления:');
    lines.push(nap);
    lines.push('');
  }

  return lines.join('\n').trim();
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
}

function serializableBlocks(blocks: InvestigationBlock[] | undefined): SerializableBlock[] {
  if (!Array.isArray(blocks)) return [];
  const out: SerializableBlock[] = [];
  for (const b of blocks) {
    if (!b || typeof b !== 'object' || typeof b.type !== 'string') continue;
    if (!b.fields || typeof b.fields !== 'object') continue;
    const d = getInvestigationBlockDescriptor(b.type);
    if (!d) continue;
    out.push({ title: d.title, sections: d.sections, fields: b.fields });
  }
  return out;
}

// One block as a clipboard sub-section: „Ехокардиография:" + the same body the
// standalone echo paste-block emits (sans its document header), Заключение last.
function blockPlainText(b: SerializableBlock): string {
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
  const pdfMainTerm = filedMainTerm(f);
  if (pdfMainTerm) {
    diagRows += `<tr><td><strong>${escapeHtml(pdfMainTerm)}</strong></td>
       <td style="white-space:nowrap;font-family:monospace;color:#1F3A5F;font-weight:700">${escapeHtml(f.osnovna_mkb || '')}</td></tr>`;
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

      ${pdfSection('Анамнеза', f.anamneza || '')}
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

  const wordMainTerm = filedMainTerm(f); // official term for a valid code; spoken fallback

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
  wordMainTerm
    ? `<h2>Основна диагноза</h2>
<table>
  <tr>
    <td style="padding:6px 10px;border:1px solid #ccc">${escapeHtml(wordMainTerm)}</td>
    <td style="padding:6px 10px;border:1px solid #ccc;font-family:Courier New;color:#1F3A5F;white-space:nowrap;width:80px">${escapeHtml(f.osnovna_mkb || '')}</td>
  </tr>
</table>`
    : ''
}

${pdRows ? `<h2>Придружаващи заболявания</h2><table>${pdRows}</table>` : ''}

${para('Анамнеза', f.anamneza)}
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
