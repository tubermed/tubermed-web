// Export helpers — PDF (preview in new window, no auto-print),
// Word (.doc Blob), and plain text (for clipboard).
// PDF preview includes an in-page action bar with "Save as PDF" and "Close"
// buttons that are hidden when actually printing.

import type { TranscribeFields } from './types';
import { filedMainTerm, filedComorbidityTerm } from './diagnosis';

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
  section('ИЗСЛЕДВАНИЯ', f.izsledvania);
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
  const naz = fieldText(f.naznacheni);
  if (nap || naz) {
    lines.push('ИЗДАДЕНИ ДОКУМЕНТИ');
    if (nap) {
      lines.push('');
      lines.push('Направления:');
      lines.push(nap);
    }
    if (naz) {
      lines.push('');
      lines.push('Назначени изследвания:');
      lines.push(naz);
    }
    lines.push('');
  }

  return lines.join('\n').trim();
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

export function generatePdfHtml(f: TranscribeFields, dateStr: string): string {
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

  const izdadeniHeader =
    fieldText(f.napravlenia) || fieldText(f.naznacheni)
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
    <div class="doc">
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
      ${pdfSection('Изследвания', f.izsledvania || '')}
      ${pdfSection('Терапия', f.terapia || '')}
      ${medsBlock}
      ${izdadeniHeader}
      ${pdfSection('Направления', f.napravlenia || '')}
      ${pdfSection('Назначени изследвания', f.naznacheni || '')}
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

export function generateWordHtml(f: TranscribeFields, dateStr: string): string {
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
<body>
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
${para('Изследвания', f.izsledvania)}
${para('Терапия', f.terapia)}

${medsRows ? `<h2>Медикаменти</h2><table>${medsRows}</table>` : ''}

${fieldText(f.napravlenia) || fieldText(f.naznacheni) ? '<h2>Издадени документи</h2>' : ''}
${para('Направления', f.napravlenia)}
${para('Назначени изследвания', f.naznacheni)}

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
