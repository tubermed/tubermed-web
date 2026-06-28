// Unit test for the shared Sentry PII scrub (lib/sentry-scrub.ts). No test runner in this repo —
// run with: npx tsx scripts/sentry-scrub.ts   (exit 0 = pass, 1 = fail)
import type { ErrorEvent } from "@sentry/nextjs";
import { scrubEvent } from "../lib/sentry-scrub";

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

// A synthetic event carrying every PII channel the scrub must close, plus an exception that must
// survive (it's the part that actually fixes bugs).
const event = {
  exception: { values: [{ type: "Error", value: "boom" }] },
  request: {
    url: "https://app.tubermed.com/app/scribe/result",
    method: "POST",
    data: { transcript: "...", egn: "7501010010" },
    cookies: { tuber_auth: "jwt" },
    headers: { Authorization: "Bearer jwt", "X-Admin-Secret": "s" },
    query_string: "visit=abc",
  },
  user: { id: "doctor-1", ip_address: "1.2.3.4", email: "doc@x" },
  breadcrumbs: [{ message: "patient ЕГН 7501010010" }],
} as unknown as ErrorEvent;

const out = scrubEvent(event);

assert(out.request !== undefined && out.request.data === undefined, "request.data stripped (bodies → transcript/ЕГН)");
assert(out.request !== undefined && out.request.cookies === undefined, "request.cookies stripped");
assert(out.request !== undefined && out.request.headers === undefined, "request.headers stripped (Authorization/X-Admin-Secret)");
assert(out.request !== undefined && out.request.query_string === undefined, "request.query_string stripped");
assert(out.user === undefined, "user stripped (no doctor/patient identity)");
assert(out.breadcrumbs === undefined, "breadcrumbs stripped (no console-context leak)");
assert(out.exception !== undefined, "exception preserved (debugging value kept)");
assert(out.request !== undefined && out.request.url === "https://app.tubermed.com/app/scribe/result", "non-PII request.url NOT over-scrubbed");

console.log(`\n${passed + failed} assertions: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
