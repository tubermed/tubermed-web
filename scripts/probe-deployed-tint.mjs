// Post-deploy probe: the AI-provenance tint must be PAIRED in what is served —
// the JS that puts `ai-authored` on a section AND the stylesheet that paints it.
//
// Why this exists (2026-08-22): the tint shipped in 7fe2dc2 (page.tsx +
// globals.css in ONE commit), CI was green, the DOM on the deployed note
// carried `class="ai-authored"` on eight sections — and the computed
// background was transparent. The deployed stylesheet was a stale compile of
// globals.css: byte-for-byte the pre-7fe2dc2 sheet (plus font hashes) while the
// JS chunk next to it was the new one. Nothing in the repo can see that: the
// source is right, the local production build is right, the DOM is right. Only
// the served pair is wrong, so only a probe of the served pair can catch it.
//
// A DOM assertion is not a visual assertion. This is not a visual assertion
// either — it is the weakest sufficient one: the rule that paints the class
// must be in the sheet the page links.
//
// Run manually after every deploy (not part of `npm test` — it needs prod):
//   node scripts/probe-deployed-tint.mjs            # app.tubermed.com
//   node scripts/probe-deployed-tint.mjs localhost:3000   # a local build/dev
//
// Exit 0: the result shell links a stylesheet that carries `.ai-authored::after`
//         with the tint token defined, AND a script that carries `ai-authored`.
// Exit 1: one side of the pair is missing — FAIL line names which.
// Exit 2: the probe could not see (no shell, no stylesheet links, network) —
//         NOT green; a gate that checked nothing must never read as passing.

import { verdict } from './deployed-tint-pairing.mjs';

const target = process.argv[2] || 'app.tubermed.com';
const base = /^https?:\/\//.test(target) ? target : (target.startsWith('localhost') ? `http://${target}` : `https://${target}`);
const SHELL = '/app/scribe/result';

async function text(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'tubermed-deployed-tint-probe' }, redirect: 'follow' });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

let html;
try {
  html = await text(base + SHELL);
} catch (e) {
  console.log(`BLIND ${base}${SHELL} — ${e.message}`);
  process.exit(2);
}

const v = await verdict(html, (u) => text(base + u));
for (const line of v.lines) console.log(line);
process.exit(v.code);
