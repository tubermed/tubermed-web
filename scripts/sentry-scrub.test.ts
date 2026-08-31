// ─────────────────────────────────────────────────────────────────────────────
// Sentry PII scrub — executed against the shared contract
// ─────────────────────────────────────────────────────────────────────────────
// Run: npm test   (node --test, Node 24 strips the types natively.)
//
// WHY THIS FILE REPLACES scripts/sentry-scrub.ts (T-041 / T-044).
//
// 1. THE OLD FILE NEVER RAN. It was `scripts/sentry-scrub.ts`, and the suite is
//    `node --test scripts/*.test.ts` — one letter of glob away from being a
//    test. Its header said „run with: npx tsx scripts/sentry-scrub.ts", and
//    nothing in package.json or .github/workflows/ci.yml did. A gate nobody
//    invokes is the vacuity shape by a fourth route: it did not fail, it did
//    not RUN. The rename is half this commit's value.
//
// 2. IT AGREED WITH ITS OWN FIXTURE. The scrub deleted `request.query_string` —
//    a field the browser SDK never emits; the query rides inside `request.url`.
//    The fixture URL was "https://app.tubermed.com/app/scribe/result", with no
//    query string at all, and the final assertion positively REQUIRED that URL
//    to survive, labelled "non-PII request.url NOT over-scrubbed". So the one
//    assertion that touched the hole asserted the hole. What rides there:
//        ?visit=<consultation uuid> · ?q=<free-text admin search> ·
//        ?session=<sessionId>, the phone-upload CREDENTIAL.
//    This fixture carries all three plus a fragment, and the assertion is
//    inverted: the query must NOT survive, the path must.
//
// 3. THE MIRROR CLAIM WAS PROSE, AND FALSE (T-044). lib/sentry-scrub.ts said it
//    mirrored the backend „EXACTLY" while omitting `extra` and `contexts`,
//    which the backend had dropped since B-1. Both sides now implement
//    public/sentry-scrub-contract.json — byte-mirrored into tubermed-backend
//    and verified there by scripts/verify-mirror.js, tokenlessly, on every
//    push. Each repo executes ITS implementation against ITS copy; byte-identity
//    of the contract plus two passing gates is what makes „they agree" checked.
//
// ANTI-VACUITY. Every channel the contract names must be PRESENT in the fixture
// before the scrub, or „it is gone afterwards" measures nothing. And the whole
// check runs against a do-nothing scrub and against the exact pre-fix
// implementation, both of which must FAIL — so the gate proves it can go red on
// every invocation, not just the day it was written.
// ─────────────────────────────────────────────────────────────────────────────

import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import type { ErrorEvent } from '@sentry/nextjs';
import { scrubEvent, scrubUrl } from '../lib/sentry-scrub.ts';
import { buildSubmitFailedMessage } from '../lib/pilot-lead-alert.ts';

const REPO = path.resolve(import.meta.dirname, '..');

interface Contract {
  version: number;
  delete: string[];
  keep: string[];
  url: {
    path: string;
    policy: string;
    drop: string[];
    segment_rules?: { by_shape?: unknown; by_position?: unknown };
  };
  message?: {
    paths?: string[];
    policy?: string;
    allow?: Array<{ tag?: string; pattern?: string; source?: string }>;
    drop_params?: boolean;
    drop_formatted?: boolean;
  };
  event_fields?: Record<string, { policy?: string }>;
}

const CONTRACT: Contract = JSON.parse(
  readFileSync(path.join(REPO, 'public', 'sentry-scrub-contract.json'), 'utf8'),
);

// ── The floor, hardcoded HERE and not read from the contract ─────────────────
// A refuter deleted `user` and `request.headers` from BOTH copies of the
// contract and from this repo's implementation only. The copies stayed
// byte-identical, verify-mirror stayed green, this gate stayed green — and a
// JWT and a doctor identity went onto the wire. Mirroring proves the two specs
// are IDENTICAL; it can never prove either is STRONG, and a gate that derives
// its whole strength from the file it is checking has none of its own.
const REQUIRED_CHANNELS = [
  'request.data',
  'request.cookies',
  'request.headers',
  'request.query_string',
  'user',
  'breadcrumbs',
  'extra',
  'contexts',
];

// ── Contract sanity ──────────────────────────────────────────────────────────
test('the contract never drops below this gate\'s own floor', () => {
  const missing = REQUIRED_CHANNELS.filter((c) => !CONTRACT.delete.includes(c));
  assert.deepStrictEqual(
    missing,
    [],
    `the contract no longer requires ${missing.join(', ')} to be scrubbed. ` +
      'Weakening the spec weakens every contract-driven assertion with it — ' +
      'that is why this list is written here and not read from the file.',
  );
});

test('the contract loaded and is the policy this gate knows how to check', () => {
  assert.ok(
    Array.isArray(CONTRACT.delete) && CONTRACT.delete.length >= 6,
    `VACUOUS: contract.delete has ${CONTRACT.delete?.length ?? 0} entries`,
  );
  assert.ok(Array.isArray(CONTRACT.keep) && CONTRACT.keep.length > 0, 'VACUOUS: contract.keep is empty');
  assert.strictEqual(CONTRACT.url.path, 'request.url');
  assert.strictEqual(CONTRACT.url.policy, 'route_shape');
  assert.ok(
    CONTRACT.url.segment_rules?.by_shape && CONTRACT.url.segment_rules?.by_position,
    'VACUOUS: route_shape without segment_rules is not a policy',
  );
});

// ── The message floor, hardcoded HERE for the same reason as the channel floor ─
// Weakening contract.message in BOTH copies keeps them byte-identical, keeps
// verify-mirror green, and weakens every contract-driven assertion about it in
// lockstep. The mirror proves IDENTICAL, never STRONG.
test('the contract never drops below this gate\'s own MESSAGE floor', () => {
  assert.strictEqual(CONTRACT.message?.policy, 'tag_allowlist_full_match');
  const REQUIRED_MESSAGE_PATHS = ['message', 'logentry'];
  const missing = REQUIRED_MESSAGE_PATHS.filter((c) => !(CONTRACT.message?.paths ?? []).includes(c));
  assert.deepStrictEqual(
    missing,
    [],
    `the contract no longer covers ${missing.join(', ')}. The backend's lib/usage-caps.js ` +
      'calls captureMessage today — this is not a hypothetical channel.',
  );
  assert.strictEqual(
    CONTRACT.message?.drop_params,
    true,
    'logentry.params must be dropped — it is where the variable part lives.',
  );
  assert.ok(
    Array.isArray(CONTRACT.message?.allow) && CONTRACT.message.allow.length >= 2,
    'VACUOUS: an allowlist policy with no allowlist',
  );
  // v4 floors, hardcoded HERE (shape 10): a PREFIX allowlist let arbitrary text
  // ride in behind an allowed tag, and dropping params while keeping
  // logentry.formatted kept the interpolated result.
  assert.ok(
    CONTRACT.message.allow.every((a) => typeof a.pattern === 'string'
      && a.pattern.startsWith('^') && a.pattern.endsWith('$')),
    'every allowed message must carry a FULL-STRING pattern, not a prefix',
  );
  assert.strictEqual(CONTRACT.message?.drop_formatted, true,
    'logentry.formatted IS the interpolation of message+params and must be dropped');
  for (const k of ['tags', 'fingerprint', 'transaction']) {
    assert.ok(CONTRACT.event_fields?.[k], `event_fields no longer covers ${k}`);
  }
  assert.strictEqual(CONTRACT.event_fields?.transaction?.policy, 'route_shape');
  assert.strictEqual(CONTRACT.event_fields?.tags?.policy, 'allowlist');
  assert.strictEqual(CONTRACT.event_fields?.fingerprint?.policy, 'empty_or_allowlist');
});

test('message and logentry are scrubbed, and the allowlisted one survives', () => {
  const out = scrubEvent({
    exception: { values: [{ type: 'Error', value: 'boom' }] },
    message: 'SENTINEL_MESSAGE пациентът съобщава',
    logentry: { message: 'SENTINEL_LOGENTRY %s', params: ['SENTINEL_PARAM'], formatted: 'SENTINEL_LOGENTRY x' },
  } as unknown as ErrorEvent) as unknown as Record<string, unknown>;

  const REDACTED = '[redacted: message not on the tag allowlist]';
  assert.strictEqual(out.message, REDACTED);
  const le = out.logentry as Record<string, unknown>;
  assert.strictEqual(le.message, REDACTED);
  assert.strictEqual(le.params, undefined, 'logentry.params must not survive');
  assert.ok(!JSON.stringify(out).includes('SENTINEL_'), 'a sentinel is still on the wire');

  // POSITIVE CONTROL. Without it every assertion above is satisfied by a scrub
  // that deletes all messages — and a captureMessage that arrives empty is not
  // alerting, it is noise.
  const kept = scrubEvent({
    message: '[usage-caps] extraction on org: 41/40 in the rolling 24h window',
  } as unknown as ErrorEvent) as unknown as Record<string, unknown>;
  assert.strictEqual(kept.message, '[usage-caps] extraction on org: 41/40 in the rolling 24h window');

  // ⚠ FULL-STRING, not prefix. A refuter rode arbitrary text in behind an
  // allowed tag and it survived verbatim — the caller-discipline guarantee this
  // contract exists to replace.
  const tail = scrubEvent({
    message: '[usage-caps] SENTINEL_TAIL',
  } as unknown as ErrorEvent) as unknown as Record<string, unknown>;
  assert.strictEqual(tail.message, REDACTED, 'an allowed TAG with free text after it must be redacted');

  // ⚠ logentry.formatted IS the interpolation of message+params. v3 dropped the
  // copy and kept the result, and it fired even with `message` absent entirely.
  const fmt = scrubEvent({
    logentry: { message: '[usage-caps] %s', params: ['SENTINEL_P'], formatted: '[usage-caps] SENTINEL_P' },
  } as unknown as ErrorEvent) as unknown as Record<string, unknown>;
  assert.ok(!JSON.stringify(fmt).includes('SENTINEL_P'), 'logentry.formatted leaked the interpolation');
  const fmtOnly = scrubEvent({
    logentry: { formatted: '[usage-caps] SENTINEL_F' },
  } as unknown as ErrorEvent) as unknown as Record<string, unknown>;
  assert.ok(!JSON.stringify(fmtOnly).includes('SENTINEL_F'), 'a formatted-only logentry leaked');
});

// ── This repo's OWN captureMessage caller ────────────────────────────────────
// components/landing/AccessForm.tsx reports a failed lead submission. It is the
// only witness a refused CORS preflight can ever have — the POST is never
// dispatched, so no server-side channel sees anything — which is precisely how
// the form managed to capture zero leads without anyone at TuberMed noticing.
//
// The message is built by the REAL formatter, never copied, so a drift between
// lib/pilot-lead-alert.ts and the allowlist fails HERE instead of arriving in
// Sentry as an empty redaction. The formatter's job is to be incapable of
// emitting an unmatched string, so it is fed hostile input too.
test('the lead-form alert survives beforeSend, and cannot be made not to', () => {
  const REDACTED = '[redacted: message not on the tag allowlist]';
  const scrub = (m: string) =>
    (scrubEvent({ message: m } as unknown as ErrorEvent) as unknown as Record<string, unknown>).message;

  // status 0 = no HTTP answer at all. THE case: this is what a refused
  // preflight looks like from inside the page, and the defect it would report.
  const blocked = buildSubmitFailedMessage(0, 1);
  assert.strictEqual(blocked, '[pilot-leads] submit failed: status=0 count=1');
  assert.strictEqual(scrub(blocked), blocked, 'the no-response alert must not arrive empty');

  for (const [status, count] of [[500, 1], [429, 12], [404, 3], [403, 7]] as const) {
    const m = buildSubmitFailedMessage(status, count);
    assert.strictEqual(scrub(m), m, `alert redacted for status ${status}`);
  }

  // Hostile / impossible inputs must still land inside the pattern rather than
  // redacting the whole alert.
  for (const bad of [undefined, null, NaN, 99999, -1, '403', 403.5, { toString: () => '403' }]) {
    const m = buildSubmitFailedMessage(bad, 1);
    assert.strictEqual(scrub(m), m, `alert redacted for status ${String(bad)}`);
  }

  // And the backend's half of the same tag, asserted here because the contract
  // is shared: deleting either entry from THIS repo's implementation empties an
  // alarm that the other repo is still sending.
  const backend = '[pilot-leads] insert refused: status=403 code=42501 count=1';
  assert.strictEqual(scrub(backend), backend, 'the backend 42501 alert must not arrive empty');

  // The floor: this whole test is satisfied by a scrub that keeps everything.
  assert.strictEqual(scrub('[pilot-leads] пациент Иванов ЕГН 7501010010'), REDACTED,
    'free text behind the pilot-leads tag must still be redacted');
  assert.strictEqual(scrub('[pilot-leads] submit failed: status=0 count=1 name=Иван'), REDACTED,
    'a trailing field appended to the real message must still be redacted');
});

// ── Dot-path helpers ─────────────────────────────────────────────────────────
type Bag = Record<string, unknown>;
const getPath = (o: unknown, p: string): unknown =>
  p.split('.').reduce<unknown>((n, k) => (n == null ? undefined : (n as Bag)[k]), o);

function setPath(o: Bag, p: string, v: unknown): void {
  const ks = p.split('.');
  let n: Bag = o;
  for (const k of ks.slice(0, -1)) {
    if (n[k] == null) n[k] = {};
    n = n[k] as Bag;
  }
  n[ks[ks.length - 1]] = v;
}

// ── The fixture ──────────────────────────────────────────────────────────────
const CONSULTATION_UUID = '3f2b91c4-0e77-4a1d-9c55-8a0d61b2e4aa';
const ADMIN_SEARCH = 'иванов';
const SESSION_CREDENTIAL = 'a1b2c3d4e5f6';
const DIRTY_URL =
  `https://app.tubermed.com/app/scribe/result?visit=${CONSULTATION_UUID}` +
  `&q=${encodeURIComponent(ADMIN_SEARCH)}&session=${SESSION_CREDENTIAL}#tab=SENTINEL_FRAGMENT`;
const CLEAN_URL = 'https://app.tubermed.com/app/scribe/result';
const SECRETS = [CONSULTATION_UUID, ADMIN_SEARCH, SESSION_CREDENTIAL, 'SENTINEL_FRAGMENT'];

const FILLER: Record<string, unknown> = {
  'request.data': { transcript: 'SENTINEL_BODY', egn: '7501010010' },
  'request.cookies': { tuber_auth: 'SENTINEL_JWT' },
  'request.headers': { Authorization: 'Bearer SENTINEL_JWT', 'X-Admin-Secret': 'SENTINEL_ADMIN' },
  'request.query_string': `visit=${CONSULTATION_UUID}`,
  user: { id: 'doctor-1', ip_address: '1.2.3.4', email: 'doc@example.test' },
  breadcrumbs: [{ message: 'SENTINEL_BREADCRUMB' }],
  extra: { note: 'SENTINEL_EXTRA' },
  contexts: { visit: { id: 'SENTINEL_CONTEXT' } },
};

function fixture(): ErrorEvent {
  const event: Bag = {
    exception: { values: [{ type: 'Error', value: 'boom' }] },
    request: { url: DIRTY_URL, method: 'POST' },
  };
  for (const p of CONTRACT.delete) {
    assert.ok(p in FILLER, `VACUOUS: contract names "${p}" but the fixture has nothing to put there`);
    setPath(event, p, FILLER[p]);
  }
  return event as unknown as ErrorEvent;
}

type Scrub = (e: ErrorEvent) => ErrorEvent;

// Taking the scrub as an argument is what lets the gate be pointed at a
// deliberately broken one and shown to go red, on every run.
function violations(scrub: Scrub): string[] {
  const bad: string[] = [];
  const event = fixture();
  for (const p of CONTRACT.delete) {
    if (getPath(event, p) === undefined) bad.push(`FIXTURE: "${p}" was already absent before the scrub`);
  }
  if (bad.length) return bad;

  const out = scrub(event);
  if (!out) return ['the scrub returned nothing'];

  for (const p of CONTRACT.delete) {
    if (getPath(out, p) !== undefined) bad.push(`"${p}" survived the scrub`);
  }
  for (const p of CONTRACT.keep) {
    if (getPath(out, p) === undefined) bad.push(`"${p}" was over-scrubbed — the contract keeps it`);
  }
  const url = getPath(out, CONTRACT.url.path);
  if (url !== CLEAN_URL) bad.push(`request.url is "${String(url)}", expected "${CLEAN_URL}"`);

  // A path-by-path check only finds what it names; this arm finds the rest.
  const wire = JSON.stringify(out);
  for (const s of SECRETS) if (wire.includes(s)) bad.push(`sentinel «${s}» still on the wire`);
  return bad;
}

// The implementation as it stood before T-041, verbatim, so the gate carries the
// defect it was written for and cannot quietly stop covering it.
const legacyScrub: Scrub = (event) => {
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    delete event.request.headers;
    delete event.request.query_string;
  }
  delete event.user;
  delete event.breadcrumbs;
  return event;
};

// ── 1 · the gate is not blind ────────────────────────────────────────────────

test('a do-nothing scrub fails the contract', () => {
  const bad = violations((e) => e);
  assert.ok(
    bad.length >= CONTRACT.delete.length,
    `only ${bad.length} violation(s) reported for a scrub that does nothing`,
  );
});

test('the PRE-FIX implementation fails — on the URL, and on extra/contexts', () => {
  const bad = violations(legacyScrub);
  assert.ok(bad.length > 0, 'the pre-fix scrub passed — this gate cannot catch T-041');
  assert.ok(
    bad.some((v) => v.includes(CONSULTATION_UUID)),
    `the consultation id was not reported as leaking:\n  ${bad.join('\n  ')}`,
  );
  assert.ok(
    bad.some((v) => v.includes(SESSION_CREDENTIAL)),
    `the phone-upload credential was not reported as leaking:\n  ${bad.join('\n  ')}`,
  );
  assert.ok(
    bad.some((v) => v.includes('"extra"')) && bad.some((v) => v.includes('"contexts"')),
    `T-044: extra/contexts were not reported as surviving:\n  ${bad.join('\n  ')}`,
  );
});

// ── 2 · the shipped scrub ────────────────────────────────────────────────────

test('the shipped scrub satisfies the contract', () => {
  assert.deepStrictEqual(violations(scrubEvent), []);
});

test('the query does NOT survive and the path DOES', () => {
  const out = scrubEvent(fixture());
  assert.strictEqual(out.request?.url, CLEAN_URL);
  assert.ok(!JSON.stringify(out).includes(SESSION_CREDENTIAL), 'the session credential is still on the wire');
  assert.ok(out.exception !== undefined, 'the exception was over-scrubbed — it is what fixes bugs');
});

// ── 3 · URL reduction, case by case ──────────────────────────────────────────

test('request.url is reduced to origin + pathname in every shape', () => {
  const cases: Array<[string, string, string]> = [
    ['query stripped', 'https://a.tubermed.com/p?visit=x', 'https://a.tubermed.com/p'],
    ['fragment stripped', 'https://a.tubermed.com/p#h', 'https://a.tubermed.com/p'],
    ['query and fragment stripped', 'https://a.tubermed.com/p?q=x#h', 'https://a.tubermed.com/p'],
    ['clean URL untouched', 'https://a.tubermed.com/p', 'https://a.tubermed.com/p'],
    ['root path kept', 'https://a.tubermed.com/', 'https://a.tubermed.com/'],
    ['userinfo dropped with the origin', 'https://u:pw@a.tubermed.com/p?x=1', 'https://a.tubermed.com/p'],
    // ⚠ THE FIXTURE THE RULING NAMES. This asserted the survivor
    // '/api/sessions/abc' — where `abc` IS the session credential. It scrubbed
    // one copy and asserted the other, which reads as „query = PII, path = safe".
    ['relative URL, query stripped AND the id segment redacted',
      '/api/sessions/abc?session=cred', '/api/sessions/:id'],
    ['a real session id (12 hex, randomBytes(6)) is redacted by SHAPE',
      '/api/sessions/a1b2c3d4e5f6/audio', '/api/sessions/:id/audio'],
    // ⚠ THE by_shape FLOOR. Every shape case here also sat after a COLLECTION,
    // so by_position covered them all — a refuter made isIdShaped() return false
    // in both repos and all four gates stayed green.
    ['SHAPE ONLY — hex token not after a collection', '/api/x/a1b2c3d4e5f6', '/api/x/:id'],
    ['SHAPE ONLY — uuid not after a collection',
      '/api/x/3f2b91c4-0e77-4a1d-9c55-8a0d61b2e4aa', '/api/x/:id'],
    ['SHAPE ONLY — digits not after a collection', '/api/x/12345', '/api/x/:id'],
    ['a double slash does not disable the position rule',
      '/api/sessions//NOTASECRETSHAPE', '/api/sessions//:id'],
    ['the collection match is case-insensitive', '/api/Sessions/abcdef', '/api/Sessions/:id'],
    ['a data: url is redacted wholesale', 'data:text/plain,PATIENT_X', '[redacted: non-http url]'],
    ['a blob: url is redacted wholesale',
      'blob:https://a.tubermed.com/3f2b91c4-0e77-4a1d-9c55-8a0d61b2e4aa', '[redacted: non-http url]'],
    ['a file: url is redacted wholesale', 'file:///C:/notes/X.txt', '[redacted: non-http url]'],
    ['a consultation UUID is redacted',
      'https://a.tubermed.com/api/consultations/3f2b91c4-0e77-4a1d-9c55-8a0d61b2e4aa/approve',
      'https://a.tubermed.com/api/consultations/:id/approve'],
    ['a numeric id is redacted', '/api/doctors/12345/pin', '/api/doctors/:id/pin'],
    // The route must SURVIVE — origin-only is the alternative the ruling
    // rejected. Without these, „everything becomes :id" passes every assertion.
    ['the ROUTE survives — non-id segments untouched', '/api/consultations/today', '/api/consultations/today'],
    ['an allowlisted literal after a collection stays', '/api/sessions/mobile-page', '/api/sessions/mobile-page'],
    ['a non-collection path is untouched',
      'https://a.tubermed.com/app/scribe/result', 'https://a.tubermed.com/app/scribe/result'],
    ['relative URL, fragment stripped', '/api/x#frag', '/api/x'],
    ['unparseable input is cut, never widened', 'not a url?session=cred', 'not a url'],
    ['empty string survives as itself', '', ''],
    [
      'percent-encoded Cyrillic query stripped',
      'https://a.tubermed.com/adm?q=%D0%B8%D0%B2%D0%B0%D0%BD%D0%BE%D0%B2',
      'https://a.tubermed.com/adm',
    ],
  ];
  for (const [why, input, expect] of cases) {
    assert.strictEqual(scrubUrl(input), expect, why);
  }
});

// ── 4 · shapes Sentry really sends ───────────────────────────────────────────

test('the scrub does not throw on the shapes Sentry really sends', () => {
  const shapes: Array<[string, ErrorEvent]> = [
    ['no request at all', { exception: { values: [] } } as unknown as ErrorEvent],
    ['request with no url', { request: { method: 'GET' } } as unknown as ErrorEvent],
    ['url that is not a string', { request: { url: 12345 } } as unknown as ErrorEvent],
    ['an already-scrubbed event', scrubEvent(fixture())],
    // Totality. The two implementations disagreed here and nothing could see it:
    // the backend returned a null event, this one threw.
    ['a null event', null as unknown as ErrorEvent],
    ['an undefined event', undefined as unknown as ErrorEvent],
  ];
  for (const [why, e] of shapes) {
    assert.doesNotThrow(() => scrubEvent(e), why);
  }
});

// ── The layers a refuter walked through ──────────────────────────────────────

test('the scrub takes ONE argument — Sentry calls beforeSend(event, hint)', () => {
  // ARGUMENT-INDEX BINDING. A refuter added a second parameter defaulting to
  // "scrub everything"; every gate called scrubEvent(event) with one argument,
  // so all four stayed green while the real call site — which passes a hint —
  // leaked the session credential on 100% of events. The identity assertion in
  // the backend's wiring test made it worse: it proved the right function was
  // wired, then never called it at the real arity.
  assert.ok(
    scrubEvent.length <= 1,
    `scrubEvent declares ${scrubEvent.length} parameters; Sentry passes (event, hint), ` +
      'so a second parameter changes behaviour at the real call site and no fixture would see it',
  );
  // And exercise it at the real arity, not just the convenient one.
  const hint = { originalException: new Error('boom'), syntheticException: null };
  // Cast the FUNCTION, not the argument: tsc rejects a 2-arg call on a 1-arg
  // signature (TS2554) — which is itself part of the guarantee — but the runtime
  // call at the real arity still has to be exercised.
  const atRealArity = scrubEvent as unknown as (e: ErrorEvent, h?: unknown) => ErrorEvent;
  const out = atRealArity(fixture(), hint);
  assert.strictEqual(out.request?.url, CLEAN_URL, 'called with a hint, the URL was not reduced');
  assert.ok(!JSON.stringify(out).includes(SESSION_CREDENTIAL));
});

test('no query parameter survives, whatever it is called', () => {
  // DENYLIST OF SPELLINGS. The URL cases enumerate ?visit / ?q / ?session, so a
  // refuter stripped exactly those four names and passed every gate while
  // ?egn=, ?token= and ?search= survived verbatim. The ASCII variant — delete
  // only params matching /^[a-zA-Z0-9_]+$/ — passed too, leaving ?пациент=
  // intact in a Bulgarian medical product. State the rule, not the spellings.
  const names = [
    'visit', 'q', 'session', 'egn', 'token', 'search', 'redirect_uri', 'x',
    'пациент', 'диагноза', 'търсене', 'ЕГН', 'a'.repeat(64), '1', '_', 'a-b',
  ];
  for (const n of names) {
    const url = `https://app.tubermed.com/app/x?${encodeURIComponent(n)}=SENTINEL_VALUE`;
    const out = scrubUrl(url);
    assert.strictEqual(out, 'https://app.tubermed.com/app/x', `param "${n}" survived`);
    assert.ok(!out.includes('SENTINEL_VALUE'), `param "${n}" leaked its value`);
  }
});

test('a RELATIVE url is reduced through scrubEvent, not only through scrubUrl', () => {
  // A refuter guarded the reduction on url.startsWith("https://") and passed
  // every gate: the relative cases only ever called scrubUrl directly, and the
  // shapes list only asserted doesNotThrow.
  for (const [url, expect] of [
    ['/api/sessions/abc?session=SENTINEL_VALUE', '/api/sessions/:id'],
    ['/app/scribe/result?visit=SENTINEL_VALUE#h', '/app/scribe/result'],
    ['//cdn.example.test/x?q=SENTINEL_VALUE', '//cdn.example.test/x'],
    ['http://localhost:3000/x?q=SENTINEL_VALUE', 'http://localhost:3000/x'],
  ] as Array<[string, string]>) {
    const e = { request: { url, method: 'GET' } } as unknown as ErrorEvent;
    const out = scrubEvent(e);
    assert.strictEqual(out.request?.url, expect, `relative/other-scheme url not reduced: ${url}`);
    assert.ok(!JSON.stringify(out).includes('SENTINEL_VALUE'), `value leaked from: ${url}`);
  }
});

test('the scrub behaves identically under NODE_ENV=production', () => {
  // DISABLED CONTROL. Gating the reduction on NODE_ENV passed every gate,
  // because none of them sets it — green in CI, leaking in the deployed build.
  const probe = [
    "const { scrubEvent } = await import(process.argv[1]);",
    "const e = { request: { url: 'https://a.tubermed.com/p?session=CRED', method: 'GET' }, user: { id: 'd' }, extra: { x: 1 }, contexts: { y: {} }, breadcrumbs: [], exception: { values: [] } };",
    "const out = scrubEvent(e);",
    "const bad = [];",
    "if (out.request.url !== 'https://a.tubermed.com/p') bad.push('url=' + out.request.url);",
    "for (const k of ['user','extra','contexts','breadcrumbs']) if (out[k] !== undefined) bad.push(k + ' survived');",
    "console.log(bad.join(' | '));",
    "process.exit(bad.length ? 1 : 0);",
  ].join('\n');
  const modUrl = new URL('../lib/sentry-scrub.ts', import.meta.url).href;
  const res = spawnSync(
    process.execPath,
    ['--input-type=module', '--eval', probe, modUrl],
    { env: { ...process.env, NODE_ENV: 'production' }, encoding: 'utf8' },
  );
  assert.ok(
    res.status === 0 || res.status === 1,
    `VACUOUS: the NODE_ENV probe did not run (status ${res.status}): ${res.stderr}`,
  );
  assert.strictEqual(res.status, 0, `the scrub behaves differently in production: ${res.stdout.trim()}`);
});


test('event_fields (v4): tags allowlisted, fingerprint asserted empty, transaction route-shaped', () => {
  const out = scrubEvent({
    tags: { note: 'SENTINEL_TAG' },
    fingerprint: ['SENTINEL_FP'],
    transaction: '/api/sessions/a1b2c3d4e5f6',
  } as unknown as ErrorEvent) as unknown as Record<string, unknown>;
  assert.deepStrictEqual(out.tags, {}, 'an unallowlisted tag key survived');
  assert.deepStrictEqual(out.fingerprint, [], 'a fingerprint value survived');
  // KEPT, because it is the route — but route-shaped, because on the browser SDK
  // it is derived from location.pathname, the channel request.url just closed.
  assert.strictEqual(out.transaction, '/api/sessions/:id');
  assert.ok(!JSON.stringify(out).includes('SENTINEL_'), 'a sentinel is still on the wire');
});

test('a NON-STRING request.url is deleted, not passed through', () => {
  const out = scrubEvent({
    request: { url: 12345 as unknown as string, method: 'GET' },
  } as unknown as ErrorEvent);
  assert.strictEqual(out.request?.url, undefined);
  assert.strictEqual(out.request?.method, 'GET');
});
