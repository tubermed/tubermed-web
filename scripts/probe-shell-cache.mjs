// Post-deploy probe: asserts the /app/* shells are no longer CDN-cached.
//
// Why this exists: on 2026-07-28 and again on 07-29 the deployed
// /app/scribe/result document failed to load at the browser level while the
// source was provably fine (local prod build clean, all wire probes from a
// second vantage 200 + valid brotli). The only serving-layer state that fits
// is a corrupted edge-cache object, so the shells are force-dynamic now and
// x-vercel-cache must never answer HIT/STALE/PRERENDER for them again.
//
// Run manually after every deploy (not part of `npm test` — it needs prod):
//   node scripts/probe-shell-cache.mjs
//
// Exit 0: every shell route answers 200 with an uncached x-vercel-cache and a
// body that decodes to complete HTML. Exit 1 with a FAIL line otherwise.
//
// Deliberately Node https, not curl: the dev machine's curl (Schannel build)
// has no HTTP/2 and silently downgrades — see docs/history/2026-07.md.

import https from 'node:https';
import zlib from 'node:zlib';

const HOST = 'app.tubermed.com';
const ROUTES = [
  '/app/login',
  '/app/new-visit',
  '/app/scribe',
  '/app/scribe/result',
  '/app/settings',
];
const CACHED_VERDICTS = new Set(['HIT', 'STALE', 'PRERENDER']);

function probe(path) {
  return new Promise((resolve) => {
    const req = https.request(
      {
        host: HOST,
        path,
        headers: {
          'Accept-Encoding': 'br',
          Accept: 'text/html',
          'User-Agent': 'tubermed-shell-cache-probe',
        },
        timeout: 20000,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks);
          let html = null;
          try {
            html =
              res.headers['content-encoding'] === 'br'
                ? zlib.brotliDecompressSync(raw).toString('utf8')
                : raw.toString('utf8');
          } catch {
            /* html stays null → reported as decode failure below */
          }
          resolve({
            path,
            status: res.statusCode,
            cache: res.headers['x-vercel-cache'] ?? '(absent)',
            bytes: raw.length,
            htmlComplete: html !== null && /<\/html>\s*$/i.test(html.trimEnd()),
          });
        });
      },
    );
    req.on('error', (e) => resolve({ path, error: e.message }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ path, error: 'timeout' });
    });
    req.end();
  });
}

let failed = false;
for (const path of ROUTES) {
  const r = await probe(path);
  const problems = [];
  if (r.error) problems.push(`request error: ${r.error}`);
  else {
    if (r.status !== 200) problems.push(`status ${r.status}`);
    if (CACHED_VERDICTS.has(r.cache)) problems.push(`x-vercel-cache: ${r.cache} (still CDN-cached)`);
    if (!r.htmlComplete) problems.push('body is not complete HTML');
  }
  if (problems.length) {
    failed = true;
    console.log(`FAIL ${path} — ${problems.join('; ')}`);
  } else {
    console.log(`ok   ${path} — 200, x-vercel-cache: ${r.cache}, ${r.bytes} bytes`);
  }
}
process.exit(failed ? 1 : 0);
