// Regression guard — fails if a presentational emoji is used as a UI icon in the
// workspace app. Use the shared <Icon/> set (components/ui/Icon.tsx) instead; see
// AGENTS.md ("Icon system"). Same idiom as the other repo regressions:
//
//   npx tsx scripts/no-emoji-ui.ts
//
// Scope: app/ + components/, EXCLUDING the landing design world
// (components/landing, app/page.tsx, app/privacy) which keeps its own glyph set.
// Code COMMENTS (// ⚠ …, JSDoc "(remove)"), and prose arrows (→ ← ↔ ↻ in
// strings) are allowed — only PICTOGRAPHIC emoji left in rendered code/strings
// fail. The pictographic ranges mirror the P0 icon-migration inventory regex
// (deliberately NOT the 2190–21FF arrow block, which is legit in prose).

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..');
const SCAN = ['app', 'components'];
const EXCLUDE = ['components/landing', 'app/page.tsx', 'app/privacy'];

const EMOJI =
  /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2300}-\u{23FF}]/u;

// Blank out comments while preserving line/column structure (so reported line
// numbers match the source). Block + JSDoc + {/* … */} first, then line comments.
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
}

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const rel = relative(ROOT, full).replace(/\\/g, '/');
    if (EXCLUDE.some((e) => rel === e || rel.startsWith(e + '/'))) continue;
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(tsx?|jsx?)$/.test(name)) out.push(full);
  }
}

const files: string[] = [];
for (const s of SCAN) walk(join(ROOT, s), files);

const hits: string[] = [];
for (const f of files) {
  const rel = relative(ROOT, f).replace(/\\/g, '/');
  stripComments(readFileSync(f, 'utf8'))
    .split('\n')
    .forEach((line, i) => {
      const m = line.match(EMOJI);
      if (m) hits.push(`${rel}:${i + 1}  ${m[0]}  ${line.trim().slice(0, 80)}`);
    });
}

if (hits.length) {
  console.error(
    `FAIL: emoji used as a UI icon (${hits.length}) — replace with <Icon/> (components/ui/Icon.tsx):`,
  );
  for (const h of hits) console.error('  ' + h);
  process.exit(1);
}
console.log(
  `OK: no emoji-as-UI-icon in app/ + components/ (${files.length} files scanned; landing excluded).`,
);
