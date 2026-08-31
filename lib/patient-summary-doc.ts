// The printable „Резюме за пациента" document — Вариант A (2026-08-31).
//
// The visual target is Dimitar's approved mock (Cowork/design/rezume-variant-A,
// chosen twice: once in grayscale, once at 2.5× content). The mock is a
// 794×1123px screen artefact; this file is the real thing — A4 geometry in mm,
// normal flow instead of the mock's flex column, and page-break behaviour the
// mock cannot express.
//
// This module stays a pure, DOM-free builder so `npm test` can execute it —
// that is why it was lifted out of the modal in the first place (a printed
// document nobody can call is a document whose contents are asserted by
// nobody). openPdfPreview injects the afterprint-close script; print and „save
// as PDF" are the same document, there is no second builder.
//
// ── The page box ────────────────────────────────────────────────────────────
// `@page { margin: 6mm 15mm 11mm }` and deliberately NO `size:` declaration.
// The task brief asked for `size: A4`, but the measured matrix in
// scripts/print-margin.test.ts says a `size` declaration is exactly what cost
// this document its margins last time: where the declared size does not match
// the destination paper, Chrome discards the CSS margins and stamps its own
// dated header. The size-less form was measured clean on A5, A4 AND Letter;
// `size: A4` would protect A4 only. A4 is Chrome's default page box here, so
// on A4 paper the two forms are identical — the size-less one just doesn't
// break on the printer we didn't think of. 6mm top: Chrome's header threshold
// is 9mm (ABSENT ≤8mm, DRAWN ≥9mm), so 6mm buys 3mm of headroom. Sides 15mm
// and bottom 11mm reproduce the mock's proportions (57px ≈ 15mm, 40px ≈ 11mm).
//
// ── What the builder is handed, and what it may not be handed ───────────────
// There is NO patient parameter here, and there must not be one. The third
// parameter is DOCTOR-side identity only (ExportIdentity — the same shape the
// амбулаторен лист header reads from api.me()), and this document renders
// exactly four of its fields: practiceName, doctorName, specialty, phone.
// Why they are here at all: the old sheet said „потърсете Вашия лекар" and
// named nobody — a patient holding it a week later had medical advice with no
// author. The letterhead fixes that. Patient identity stays impossible by
// name: scripts/document-identity.test.ts sweeps every builder signature and
// interface in this module's import graph, and `identity` / every field of
// ExportIdentity is on its doctor-side allowlist by design.
//
// `dateBg` is the day of the ПРЕГЛЕД, already formatted in Europe/Sofia by
// lib/date.ts formatVisitDateBg — handed in, never computed here. Empty means
// the visit's own timestamp is not known and the whole date cell drops out:
// absent is a gap the doctor can see; today's date is a false statement they
// cannot. (This builder once opened with `new Date().toLocaleDateString(…)` —
// see scripts/summary-date.test.ts for the whole saga.)
//
// ── Layout, not content ─────────────────────────────────────────────────────
// The summary TEXT is rendered exactly as handed in. The parser below only
// decides which frame each run of text sits in, keyed on the four section
// headings the backend prompt mandates (lib/patient-summary.js SUMMARY_SYSTEM
// — a cross-repo mirror: change the headings there and here TOGETHER):
//
//   Какво установихме / Вашата терапия / На какво да обърнете внимание /
//   Следващи стъпки
//
// Text under no known heading (a doctor's free edit) renders as plain
// paragraphs in the same frame — nothing is invented, and nothing is dropped
// except the ONE named case below. Exactly two typographic separators are
// absorbed into layout, both from the approved mock: a matched heading's
// trailing „:" (the eyebrow row replaces it) and the first „ — " between a
// medication's dose-bearing lead and its regimen inside a therapy card (the
// card's two-span line replaces it). The one drop: a known heading with
// NOTHING under it vanishes whole, heading line included — the backend's own
// instruction is „пропусни раздел без съдържание", and an empty warning box
// is an alarm about nothing. All three rules are pinned by
// scripts/summary-print.test.ts's conservation oracle, which re-derives them
// independently — a divergence between this file and that model is red.
//
// ── Grayscale is the delivery medium ────────────────────────────────────────
// Most clinic printers are monochrome, and Chrome's print dialog ships with
// „background graphics" OFF. Both solid fills that carry meaning (the warning
// header band, the medication card fill) declare `print-color-adjust: exact`
// so they survive the default dialog; the warning box additionally earns its
// weight from a 3px ink border that is not a background and always prints.
// `#C0392B` appears nowhere in this document on purpose: red is reserved for
// medication-safety alerts, and this sheet must not spend it (gated).

import { escapeHtml, type ExportIdentity } from './exporters';

// ── Print tokens ────────────────────────────────────────────────────────────
// Defined ONCE here, emitted as CSS custom properties, referenced everywhere
// else as var(--…). The first six mirror app tokens from globals.css @theme;
// the last two are PRINT tokens in their own right (documented in
// Fundamentals/Design-System-App.md): they happen to share values with
// --color-border-strong and --color-brand-light today, but the printed sheet
// must not restyle itself when the app palette moves, so they are bound here,
// not there.
const PRINT_TOKENS: Record<string, string> = {
  'print-accent': '#274C77',      // brand navy        (--color-accent)
  'print-ink': '#142740',         // darkest ink       (--color-ink)
  'print-text': '#1C2733',        // body text         (--color-text-primary)
  'print-text-soft': '#586472',   // secondary text    (--color-text-secondary)
  'print-text-hint': '#8893A1',   // muted / footer    (--color-text-muted-new)
  'print-hairline': '#E7ECF2',    // section hairline  (--color-hairline)
  'print-rule': '#C2CAD4',        // print rule / card border (print token)
  'print-med-fill': '#E8EFF7',    // medication card fill      (print token)
};

const tokenCss = (): string =>
  Object.entries(PRINT_TOKENS).map(([k, v]) => `--${k}:${v}`).join(';');

// ── The summary's structure ─────────────────────────────────────────────────

/** The disclaimer's load-bearing phrase — same marker the modal splits on. */
export const DISCLAIMER_MARKER = /не замества медицинска консултация/i;

type SectionKey = 'findings' | 'therapy' | 'warning' | 'next' | 'plain';

/** Mirror of the backend prompt's mandated headings (lib/patient-summary.js
 *  SUMMARY_SYSTEM). Order here is presentation-neutral: sections render in the
 *  order they appear in the TEXT, never reordered. */
const HEADINGS: ReadonlyArray<{ key: SectionKey; label: string }> = [
  { key: 'findings', label: 'Какво установихме' },
  { key: 'therapy', label: 'Вашата терапия' },
  { key: 'warning', label: 'На какво да обърнете внимание' },
  { key: 'next', label: 'Следващи стъпки' },
];

interface ParsedSection {
  key: SectionKey;
  /** The heading as it appears in the text (minus the trailing colon), or null
   *  for text under no known heading. */
  label: string | null;
  text: string;
}

export interface ParsedSummary {
  sections: ParsedSection[];
  disclaimer: string;
}

/** Split the flat summary text into frames. Pure re-arrangement: joining the
 *  parts back together (headings with their colons, disclaimer at the end)
 *  reproduces the input's text — the conservation test holds this. */
export function parsePatientSummary(summary: string): ParsedSummary {
  const text = (summary || '').replace(/\r\n/g, '\n').trim();

  // The disclaimer is pulled from the END of the text only, and at LINE
  // grain. composeFinal appends it as the final paragraph, so only the final
  // paragraph is inspected, and within it only the line carrying the marker
  // is the disclaimer. Two refuter finds shaped this (2026-08-31): a summary
  // whose doctor edit used single newlines throughout was ONE paragraph, so a
  // paragraph-grain pull relocated the entire clinical content into the legal
  // fine print; and a marker phrase the doctor wrote MID-text was yanked to
  // the footer, reordering clinical advice into legalese. Now: mid-text
  // marker lines stay exactly where they were written and render as content;
  // if no marker line ends the text, nothing is pulled and nothing is lost —
  // the builder never writes a disclaimer of its own (the modal's composeFinal
  // owns appending it; the backend owns its wording).
  const paragraphs = text === '' ? [] : text.split(/\n{2,}/);
  let disclaimer = '';
  if (paragraphs.length > 0) {
    const lastLines = paragraphs[paragraphs.length - 1].split('\n');
    for (let i = lastLines.length - 1; i >= 0; i--) {
      if (DISCLAIMER_MARKER.test(lastLines[i])) {
        disclaimer = lastLines[i].trim();
        lastLines.splice(i, 1);
        break;
      }
    }
    if (disclaimer) {
      const rest = lastLines.join('\n').trim();
      if (rest) paragraphs[paragraphs.length - 1] = rest;
      else paragraphs.pop();
    }
  }

  const sections: ParsedSection[] = [];
  let current: ParsedSection = { key: 'plain', label: null, text: '' };
  const flush = () => {
    const t = current.text.replace(/^\n+|\n+$/g, '');
    if (t || current.label) sections.push({ ...current, text: t });
  };

  for (const line of paragraphs.join('\n\n').split('\n')) {
    const trimmed = line.trim();
    const lower = trimmed.toLowerCase();
    let heading: { key: SectionKey; typed: string; inline: string } | null = null;
    for (const h of HEADINGS) {
      const l = h.label.toLowerCase();
      if (lower === l || lower === `${l}:`) {
        heading = { key: h.key, typed: trimmed.replace(/:$/, ''), inline: '' };
        break;
      }
      if (lower.startsWith(`${l}:`)) {
        heading = {
          key: h.key,
          typed: trimmed.slice(0, h.label.length),
          inline: trimmed.slice(h.label.length + 1).trim(),
        };
        break;
      }
    }
    if (heading) {
      flush();
      current = { key: heading.key, label: heading.typed, text: heading.inline };
    } else {
      current.text += (current.text ? '\n' : '') + line;
    }
  }
  flush();

  // A heading the model emitted with nothing under it renders as nothing — an
  // empty warning box would read as an alarm about nothing.
  return { sections: sections.filter((s) => s.text !== ''), disclaimer };
}

// ── Renderers ───────────────────────────────────────────────────────────────

const paras = (text: string): string[] =>
  text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);

/** Plain paragraphs. `white-space: pre-line` keeps single newlines. */
const paragraphsHtml = (text: string, cls: string): string =>
  paras(text).map((p) => `<p class="${cls}">${escapeHtml(p)}</p>`).join('\n');

const eyebrowHtml = (label: string): string =>
  `<div class="eyebrow">${escapeHtml(label)}</div>\n<div class="hairline"></div>`;

/** One therapy paragraph → one medication card. If its first line opens with a
 *  short, dose-carrying lead followed by „ — ", the lead renders as the card's
 *  mono headline and the first sentence after the dash as the regimen span —
 *  the mock's treatment. Anything that doesn't match that shape renders as a
 *  plain paragraph inside the same card: the styling degrades, the text never
 *  changes. */
function medCardHtml(paragraph: string): string {
  // The split's guards, each bought by a refuter find (2026-08-31):
  //  · the dash must be SPACE-dash-SPACE on the first line — `\s` matched a
  //    newline, so a dashed bullet list was absorbed across lines;
  //  · the text after the dash must not open with a digit — „по 1 – 2
  //    таблетки" and „над 38 — 38.5" are RANGES, and splitting one garbles a
  //    dose instruction on a patient sheet;
  //  · the regimen/note cut happens only at a sentence boundary (period
  //    before an uppercase letter), not at any period — „по 1 табл. сутрин"
  //    was being broken mid-sentence at the abbreviation dot.
  const m = /^(\S[^\n]{0,58}?) [—–-] ([^\n][\s\S]*)$/.exec(paragraph);
  if (m && /\d/.test(m[1]) && !/^\d/.test(m[2])) {
    const lead = m[1];
    const rest = m[2];
    const dot = rest.search(/\.(?=\s+[А-ЯA-Z])/u);
    const regimen = dot >= 0 ? rest.slice(0, dot + 1) : rest;
    const note = dot >= 0 ? rest.slice(dot + 1).trim() : '';
    return (
      `<div class="med-card">\n` +
      `<div class="med-line"><span class="med-name">${escapeHtml(lead)}</span> ` +
      `<span class="med-dose">${escapeHtml(regimen)}</span></div>\n` +
      (note ? `<p class="med-note">${escapeHtml(note)}</p>\n` : '') +
      `</div>`
    );
  }
  return `<div class="med-card">\n<p class="med-note">${escapeHtml(paragraph)}</p>\n</div>`;
}

/** The warning box. Every non-empty line is one red flag row; the whole box
 *  refuses to split across a page break, and so does each row (defence in
 *  depth for the day the box outgrows a page and Chrome breaks it anyway). */
function warningHtml(label: string, text: string): string {
  const items = text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map(
      (l) =>
        `<div class="warn-item"><span class="warn-marker"></span>` +
        `<p class="warn-text">${escapeHtml(l)}</p></div>`,
    )
    .join('\n');
  return (
    `<section class="warn">\n` +
    `<div class="warn-head"><span class="warn-title">${escapeHtml(label)}</span>` +
    `<span class="warn-tag">ВАЖНО</span></div>\n` +
    `<div class="warn-body">\n${items}\n</div>\n` +
    `</section>`
  );
}

function sectionHtml(s: ParsedSection): string {
  if (s.key === 'warning') return warningHtml(s.label ?? '', s.text);
  const head = s.label ? eyebrowHtml(s.label) + '\n' : '';
  if (s.key === 'therapy') {
    return `<section class="sec">\n${head}${paras(s.text).map(medCardHtml).join('\n')}\n</section>`;
  }
  return `<section class="sec">\n${head}${paragraphsHtml(s.text, 'body')}\n</section>`;
}

// ── The document ────────────────────────────────────────────────────────────

export function buildPatientSummaryHtml(
  summary: string,
  dateBg: string,
  identity: ExportIdentity = {},
): string {
  const v = (s?: string | null) => (s || '').trim();
  const practice = v(identity.practiceName);
  const doctor = v(identity.doctorName);
  const specialty = v(identity.specialty);
  const phone = v(identity.phone);

  const { sections, disclaimer } = parsePatientSummary(summary);

  // Letterhead: practice eyebrow left, преглед date right. Either half may be
  // absent; the whole element (not just its text), because an empty flex row
  // still draws its padding.
  const practiceHtml = practice ? `<div class="practice">${escapeHtml(practice)}</div>` : '';
  const dateHtml = dateBg ? `<div class="date">${escapeHtml(dateBg)}</div>` : '';
  const letterhead =
    practiceHtml || dateHtml
      ? `<div class="letterhead">${practiceHtml}${dateHtml}</div>\n`
      : '';

  const byline =
    doctor || specialty
      ? `<div class="byline">${escapeHtml(doctor)}` +
        (doctor && specialty ? `<span class="sep"> · </span>` : '') +
        (specialty ? `<span class="spec">${escapeHtml(specialty)}</span>` : '') +
        `</div>\n`
      : '';

  const contact =
    practice || phone
      ? `<div class="contact">${escapeHtml(practice)}` +
        (practice && phone ? `<span class="sep"> · </span>` : '') +
        (phone ? `тел. <span class="tel">${escapeHtml(phone)}</span>` : '') +
        `</div>`
      : '<div class="contact"></div>';

  const rendered = sections.map(sectionHtml);

  // The document's tail: the LAST content block travels with the disclaimer
  // and footer as one unbreakable group, so a page break can never leave the
  // legal line alone on a page with no clinical content above it. On a short
  // note the same group simply follows the content — the sheet ends where the
  // document ends, like a letter, instead of pushing the footer to the paper's
  // edge across a field of white (the mock's `flex: 1` spacer did exactly
  // that, and it is gone).
  const last = rendered.length > 0 ? rendered[rendered.length - 1] : '';
  const beforeLast = rendered.slice(0, -1).join('\n');

  const footer =
    (disclaimer ? `<p class="disclaimer">${escapeHtml(disclaimer)}</p>\n` : '') +
    `<div class="foot-rule"></div>\n` +
    `<div class="footer">${contact}<div class="mark">изготвено с TuberMed</div></div>`;

  return `<!doctype html><html lang="bg"><head><meta charset="utf-8">
<title>Резюме за пациента</title>
<style>
  @page { margin: 6mm 15mm 11mm; }
  :root { ${tokenCss()}; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: Inter, -apple-system, 'Segoe UI', Roboto, sans-serif;
    color: var(--print-text);
    background: #FFFFFF;
    overflow-wrap: break-word;
  }
  .date, .tel, .med-name, .med-dose, .warn-tag {
    font-family: 'JetBrains Mono', Consolas, 'Courier New', monospace;
    font-variant-numeric: tabular-nums;
  }
  .letterhead { display: flex; justify-content: space-between; align-items: flex-end; gap: 24px; padding: 5px 0 10px; }
  .practice { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.18em; color: var(--print-accent); }
  .date { font-size: 13px; color: var(--print-text-soft); margin-left: auto; }
  .brand-rule { height: 2px; background: var(--print-accent); print-color-adjust: exact; -webkit-print-color-adjust: exact; }
  .masthead { padding: 24px 0 22px; }
  h1 { margin: 0; font-size: 29px; font-weight: 600; color: var(--print-ink); letter-spacing: -0.015em; }
  .byline { margin-top: 6px; font-size: 15px; color: var(--print-text); }
  .sep { color: var(--print-text-hint); }
  .spec { color: var(--print-text-soft); }
  .content { max-width: 640px; }
  .sec { margin: 0 0 26px; }
  .eyebrow { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.18em; color: var(--print-accent); break-after: avoid; }
  .hairline { height: 1px; background: var(--print-hairline); margin: 9px 0 0; break-after: avoid; }
  p.body { margin: 12px 0 0; font-size: 15.5px; line-height: 1.72; white-space: pre-line; text-wrap: pretty; }
  .med-card {
    border: 1px solid var(--print-rule); border-radius: 8px; background: var(--print-med-fill);
    padding: 18px 20px; margin: 12px 0 0; break-inside: avoid;
    print-color-adjust: exact; -webkit-print-color-adjust: exact;
  }
  .med-line { display: flex; flex-wrap: wrap; align-items: baseline; gap: 10px; }
  .med-name { font-size: 17px; font-weight: 700; color: var(--print-ink); }
  .med-dose { font-size: 14.5px; color: var(--print-accent); }
  .med-note { margin: 8px 0 0; font-size: 15px; line-height: 1.7; white-space: pre-line; }
  .med-card > .med-note:first-child { margin-top: 0; }
  .warn { border: 3px solid var(--print-ink); border-radius: 8px; overflow: hidden; margin: 0 0 26px; break-inside: avoid; }
  .warn-head {
    background: var(--print-ink); padding: 11px 20px;
    display: flex; align-items: center; justify-content: space-between; gap: 16px;
    print-color-adjust: exact; -webkit-print-color-adjust: exact;
  }
  .warn-title { font-size: 11.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.18em; color: #FFFFFF; }
  .warn-tag { font-size: 11px; letter-spacing: 0.08em; color: var(--print-rule); }
  .warn-body { padding: 6px 20px 16px; }
  .warn-item { display: flex; gap: 16px; align-items: flex-start; margin: 10px 0 0; break-inside: avoid; }
  .warn-marker { width: 10px; height: 10px; background: var(--print-ink); margin-top: 9px; flex: none; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
  .warn-text { margin: 0; font-size: 17px; line-height: 1.66; font-weight: 500; color: var(--print-ink); white-space: pre-line; text-wrap: pretty; }
  .tail { break-inside: avoid; }
  .disclaimer { margin: 32px 0 0; max-width: 640px; font-size: 14px; line-height: 1.6; font-style: italic; color: var(--print-text-soft); }
  .foot-rule { height: 1px; background: var(--print-rule); margin: 14px 0; }
  .footer { display: flex; justify-content: space-between; align-items: baseline; gap: 20px; }
  .contact { font-size: 15px; color: var(--print-text); }
  .mark { font-size: 10px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.18em; color: var(--print-text-hint); white-space: nowrap; }
  @media screen { body { max-width: 680px; margin: 0 auto; padding: 24px; } }
</style></head><body>
${letterhead}<div class="brand-rule"></div>
<div class="masthead">
<h1>Резюме за пациента</h1>
${byline}</div>
<div class="content">
${beforeLast ? beforeLast + '\n' : ''}<div class="tail">
${last ? last + '\n' : ''}${footer}
</div>
</div>
</body></html>`;
}
