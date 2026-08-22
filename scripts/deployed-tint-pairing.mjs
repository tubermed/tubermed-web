// Pure verdict for scripts/probe-deployed-tint.mjs — kept network-free so
// scripts/deployed-tint-pairing.test.ts can feed it every served shape it
// exists to reject (stale sheet, sheet without token, JS without class, shell
// without links) and prove each one goes red.

const CSS_LINK = /\/_next\/static\/[^"'\s>]+\.css/g;
const JS_LINK  = /\/_next\/static\/[^"'\s>]+\.js/g;

// The PAIR predicate is „the class is painted with the tint token", whatever
// the treatment — host background (7fe2dc2) or ::after overlay (d860e83+).
// Pinned to one treatment, the probe would also go red against a correctly
// deployed older sheet, and its red would no longer mean „stale".
export const SURFACE_RULE = /\.ai-authored(:{1,2}after)?\s*\{[^}]*background:\s*var\(--color-ai-tint\)/;
export const PRINT_RULE   = /@media print\s*\{[^@]*\.ai-authored(:{1,2}after)?[^{}]*\{[^}]*(display:\s*none|background:\s*(transparent|0 0|none))/;
export const TOKEN        = /--color-ai-tint:\s*#[0-9a-fA-F]{6}/; // ascii-safe: a hex colour
// ascii-safe: the neighbours of an ASCII class name in minified JS — a quote,
// a space, a backtick or the string end; Cyrillic cannot be adjacent to it.
export const CLASS_IN_JS  = /(^|[^A-Za-z0-9_-])ai-authored(?![A-Za-z0-9_-])/;

/**
 * @param {string} html   the served result shell
 * @param {(path: string) => Promise<string>} fetchText  fetches a /_next/static path
 * @returns {Promise<{code: 0|1|2, lines: string[]}>}
 */
export async function verdict(html, fetchText) {
  const lines = [];
  const css = [...new Set(html.match(CSS_LINK) || [])];
  const js  = [...new Set(html.match(JS_LINK) || [])];
  if (css.length === 0 || js.length === 0) {
    lines.push(`BLIND shell links ${css.length} stylesheet(s) and ${js.length} script(s) — cannot judge the pair`);
    return { code: 2, lines };
  }

  let sheetWithRule = null, sheetWithToken = null, sheetWithPrint = null;
  for (const u of css) {
    const t = await fetchText(u);
    if (SURFACE_RULE.test(t)) sheetWithRule = u;
    if (TOKEN.test(t)) sheetWithToken = u;
    if (PRINT_RULE.test(t)) sheetWithPrint = u;
  }
  let scriptWithClass = null;
  for (const u of js) {
    const t = await fetchText(u);
    if (CLASS_IN_JS.test(t)) { scriptWithClass = u; break; }
  }

  const problems = [];
  if (!scriptWithClass) problems.push('no linked script carries the ai-authored class (the shell is pre-tint)');
  if (!sheetWithRule)   problems.push('no linked stylesheet paints .ai-authored with var(--color-ai-tint) — stale CSS compile?');
  if (!sheetWithToken)  problems.push('no linked stylesheet defines --color-ai-tint (the rule would resolve to transparent)');
  if (!sheetWithPrint)  problems.push('no linked stylesheet neutralises .ai-authored under @media print');

  if (problems.length) {
    lines.push(`FAIL tint pair — ${problems.join('; ')}`);
    lines.push(`     css: ${css.join(', ')}`);
    lines.push(`     js with class: ${scriptWithClass ?? '(none)'}`);
    return { code: 1, lines };
  }
  lines.push(`ok   tint pair — rule+token+print in ${sheetWithRule}, class in ${scriptWithClass}`);
  return { code: 0, lines };
}
