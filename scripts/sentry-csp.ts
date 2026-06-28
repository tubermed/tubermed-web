// Unit test for the Sentry EU-ingest CSP origin derivation (lib/sentry-csp.ts). No runner here —
// run with: npx tsx scripts/sentry-csp.ts   (exit 0 = pass, 1 = fail)
// Proves the connect-src contract: EU DSN set → origin added; unset → not added; non-EU DSN → not
// added (the EU guard).
import { sentryIngestOrigin, sentryConnectOrigins } from "../lib/sentry-csp";

let passed = 0,
  failed = 0;
function assert(cond: boolean, msg: string) {
  if (cond) {
    console.log(`  ✓ ${msg}`);
    passed++;
  } else {
    console.error(`  ✗ ${msg}`);
    failed++;
  }
}

// --- sentryIngestOrigin (pure DSN → origin) ---
assert(
  sentryIngestOrigin("https://abc@o123.ingest.de.sentry.io/1") === "https://o123.ingest.de.sentry.io",
  "EU DSN → ingest origin added",
);
assert(sentryIngestOrigin(undefined) === null, "unset DSN → null (not added)");
assert(sentryIngestOrigin("") === null, "empty DSN → null (not added)");
assert(sentryIngestOrigin("https://abc@o123.ingest.us.sentry.io/1") === null, "US-region DSN → null (blocked, non-EU)");
assert(sentryIngestOrigin("https://abc@o123.ingest.sentry.io/1") === null, "region-less ingest DSN → null (blocked)");
assert(sentryIngestOrigin("https://abc@de.ingest.evil.com/1") === null, "look-alike non-sentry host → null");
assert(sentryIngestOrigin("not a url") === null, "malformed DSN → null");

// --- sentryConnectOrigins (reads process.env.NEXT_PUBLIC_SENTRY_DSN) ---
delete process.env.NEXT_PUBLIC_SENTRY_DSN;
assert(JSON.stringify(sentryConnectOrigins()) === "[]", "env unset → no connect-src origin");
process.env.NEXT_PUBLIC_SENTRY_DSN = "https://abc@o123.ingest.de.sentry.io/1";
assert(
  JSON.stringify(sentryConnectOrigins()) === JSON.stringify(["https://o123.ingest.de.sentry.io"]),
  "EU env set → origin present in connect-src list",
);
process.env.NEXT_PUBLIC_SENTRY_DSN = "https://abc@o123.ingest.us.sentry.io/1";
assert(JSON.stringify(sentryConnectOrigins()) === "[]", "non-EU env set → no connect-src origin (EU guard)");
delete process.env.NEXT_PUBLIC_SENTRY_DSN;

console.log(`\n${passed + failed} assertions: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
