// The landing lead form's failure alert — the MESSAGE, extracted from the
// component so a gate can execute it.
//
// This file exists for the reason instrument.js's header already records: the
// scrub was once an inline closure inside Sentry.init, so nothing could reach it
// without a DSN and a real client, nothing ever ran it, and it shipped a hole.
// A formatter whose output must match a full-string pattern in
// public/sentry-scrub-contract.json has exactly that property — if it drifts,
// every alert it sends arrives as „[redacted: message not on the tag
// allowlist]", which is an alarm that fires empty. components/landing/
// AccessForm.tsx is a JSX component and cannot be imported by
// `node --test scripts/*.test.ts`, so the string lives here instead and
// scripts/sentry-scrub.test.ts runs it through the REAL scrub.
//
// WHY THERE IS AN ALERT AT ALL (2026-08-31): the form had captured zero leads
// since it shipped, and the only place that ever showed was the visitor's own
// screen. The backend could not have seen it — the CORS preflight was refused,
// so the POST was never dispatched and no request existed to log. A browser is
// the only witness a refused preflight ever has; `status = 0` is that case.
//
// PII: the name, e-mail and message this form collects NEVER ride the event.
// A status and a count, nothing else.

/** status 0 = no HTTP answer at all (refused preflight, DNS, offline, abort). */
export function normaliseSubmitStatus(status: unknown): number {
  return typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599
    ? status
    : 0;
}

/**
 * The exact string sent to Sentry.
 * Contract pattern: ^\[pilot-leads\] submit failed: status=\d{1,3} count=\d+$
 */
export function buildSubmitFailedMessage(status: unknown, count: number): string {
  const n = Number.isInteger(count) && count >= 0 ? count : 0;
  return `[pilot-leads] submit failed: status=${normaliseSubmitStatus(status)} count=${n}`;
}
