// Shared Sentry PII scrub — used by the CLIENT, SERVER, and EDGE Sentry.init sites so the
// no-PII guarantee holds BY CONSTRUCTION, not per-site discipline.
//
// This is a MEDICAL product (special-category data): an error payload must never carry a
// transcript, ЕГН, request body, headers (Authorization / X-Admin-Secret), cookies, a query
// string, user identity, console breadcrumbs, or attached extra/contexts. `sendDefaultPii: false`
// already prevents most of this; the scrub makes it a guarantee.
//
// ── The URL was the hole (T-041, 2026-08-30) ────────────────────────────────
// This function deleted `request.query_string` for months. On the BROWSER SDK
// path that field is never emitted at all — the query lives inside
// `request.url`, which nothing here touched. So the channel that was closed was
// never open, and the one that was open stayed open. What rides in it:
//
//     ?visit=<consultation uuid>       an identifier for a specific note
//     ?q=<free-text admin search>      whatever the operator typed
//     ?session=<sessionId>             the phone-upload CREDENTIAL
//
// `request.url` is now reduced to origin + pathname. The fragment goes too: the
// browser reports `location.href`, and a hash is client-authored text.
//
// ── The mirror is CHECKED, not claimed (T-044) ──────────────────────────────
// This used to say it mirrored tubermed-backend/instrument.js EXACTLY while
// omitting `extra` and `contexts`, which the backend dropped. Both are handled
// here now, and the shared contract both sides implement is
// `public/sentry-scrub-contract.json` — byte-mirrored into the backend and
// verified there by `scripts/verify-mirror.js`. Each repo's own gate executes
// its implementation against its copy of the contract.
//
// ⚠ This file must NOT read the contract. An implementation that reads its own
// spec satisfies it by construction, which is the comment-satisfies-predicate
// bypass wearing a JSON file.
import type { ErrorEvent } from "@sentry/nextjs";

/**
 * Reduce a URL to origin + pathname, dropping the query string and the fragment.
 * Absolute and relative forms both handled; anything unparseable is cut at the
 * first `?` or `#`, so the failure direction is "scrub more", never "scrub less".
 */
// ── Route shape (contract v3) ───────────────────────────────────────────────
// origin + pathname kept every path segment, and the two identifiers the query
// carried also travel as path params: /api/sessions/<id> IS the phone-upload
// credential, and thirteen /api/consultations/<uuid>/... routes carry the note
// id. Origin-only would take the route off every event, which is most of what
// makes one actionable. Keep the route, drop the identifiers.

// ascii-safe: URL path segments — percent-encoded, so ASCII by construction.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// ascii-safe: hex token. The phone session id is randomBytes(6).toString("hex"),
// always 12 lowercase hex; 8 is the floor. No route literal in either repo is
// eight-or-more characters drawn only from [0-9a-f].
const HEX_RE = /^[0-9a-f]{8,}$/i;
// ascii-safe: a bare numeric segment.
const DIGITS_RE = /^[0-9]+$/;

// The segment after one of these is an identifier by construction.
const COLLECTIONS = ["sessions", "consultations", "doctors", "visits", "organizations"];
// …unless it is one of these. Deliberately tiny: anything not listed is treated
// as an id, so a mistake costs a route detail rather than publishing a credential.
const COLLECTION_LITERALS = ["today", "start", "mobile-page"];

function isIdShaped(seg: string): boolean {
  return UUID_RE.test(seg) || HEX_RE.test(seg) || DIGITS_RE.test(seg);
}

/**
 * Replace identifier-shaped path segments with `:id`, by shape and by position.
 *
 * ⚠ `prev` is the previous NON-EMPTY segment. A double slash used to defeat the
 * position rule outright: for the segment after `//` the previous segment was
 * the empty string, so no collection matched and `/api/consultations//ivanov`
 * came through untouched. One extra slash — trivially produced by joining a
 * trailing-slash base to a leading-slash path — turned the rule off.
 *
 * ⚠ The collection comparison is case-INSENSITIVE. Express routing is not
 * case-sensitive by default, so `/api/Sessions/<id>` reaches the same handler.
 */
export function scrubPath(pathname: string): string {
  const parts = pathname.split("/");
  let prev = "";
  for (let i = 0; i < parts.length; i++) {
    const seg = parts[i];
    if (!seg) continue;
    if (isIdShaped(seg)) { parts[i] = ":id"; prev = ":id"; continue; }
    if (COLLECTIONS.includes(prev.toLowerCase()) && !COLLECTION_LITERALS.includes(seg.toLowerCase())) {
      parts[i] = ":id";
      prev = ":id";
      continue;
    }
    prev = seg;
  }
  return parts.join("/");
}

// A URL whose origin is not http(s) has no meaningful origin/pathname split:
// `new URL('data:text/plain,PATIENT…').origin` is the literal string "null", and
// concatenating that onto the path produced `nulltext/plain,PATIENT…` with the
// free text intact. Same for blob:, file:, javascript: and mailto:.
const REDACTED_URL = "[redacted: non-http url]";

export function scrubUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return REDACTED_URL;
    // `origin` also drops any user:password@ prefix — another credential channel.
    return u.origin + scrubPath(u.pathname);
  } catch {
    // Unparseable: cut query/fragment, then apply the same segment rules.
    // Failing to parse must not mean failing to scrub.
    const cut = url.search(/[?#]/);
    const withoutQuery = cut === -1 ? url : url.slice(0, cut);
    return scrubPath(withoutQuery);
  }
}

// ── message / logentry (contract v3) ────────────────────────────────────────
// The backend's lib/usage-caps.js calls Sentry.captureMessage today, so "assert
// it empty" is not available on that side, and this side must implement the same
// contract. The commit that dropped breadcrumbs argued that a guarantee resting
// on every caller's discipline is not a guarantee; that applies here identically.
// ⚠ FULL-STRING PATTERNS, NOT PREFIXES (contract v4). v3 matched
// `text.startsWith(tag)` and a refuter rode arbitrary text in behind an allowed
// tag: „[usage-caps] пациент Иванов ЕГН 7501010010" survived verbatim. A prefix
// allowlist IS the caller-discipline guarantee this contract exists to replace —
// the same argument that dropped breadcrumbs. Each pattern admits counts and
// closed enums and nothing else.
//
// ⚠ These are DUPLICATED from the contract on purpose. An implementation that
// read its own spec would satisfy it by construction; the gates hold the floor.
// ascii-safe: these match machine-generated alert strings built from ASCII
// enums and digits. The one non-ASCII character is the em dash, matched
// literally.
// ⚠ EXPORTED so a gate can compare the regexes that actually RUN against
// public/sentry-scrub-contract.json. A refuter downgraded both [pilot-leads]
// entries back to v3 PREFIX matches — here AND in the backend implementation —
// and every gate in both repos stayed green while a name, an e-mail and an ЕГН
// rode out to Sentry behind an allowed tag. The contract gate checked that its
// own JSON strings start with ^ and end with $; nothing compared them to these.
// The byte-mirror proves the two JSON copies are identical, never that either
// matches its implementation.
// This file still must not READ the contract — an implementation that reads its
// own spec agrees with it by construction. Being read BY a gate is the opposite.
export const ALLOWED_MESSAGE_PATTERNS: RegExp[] = [
  /^\[usage-caps\] [a-z_]+ on [a-z]+: \d+\/\d+ in the rolling 24h window$/,
  /^\[account-status\] UNANSWERABLE — revocation NOT ENFORCED\. kind=[a-z_]+ unanswerable_total=\d+ checks_total=\d+$/,
  // [pilot-leads], 2026-08-31 — two call sites, one per side of the network.
  // The backend route reports an insert the DB refused; components/landing/
  // AccessForm.tsx reports a submission that got no answer at all (status=0),
  // which is the ONLY witness available when a refused CORS preflight means the
  // POST is never dispatched — that is the shape that hid this defect for the
  // whole life of the table. Counts and a status only: the form's payload is a
  // name and an e-mail address and never rides the event.
  /^\[pilot-leads\] insert refused: status=\d{1,3} code=[A-Z0-9_]{1,10} count=\d+$/,
  /^\[pilot-leads\] submit failed: status=\d{1,3} count=\d+$/,
];
const REDACTED_MESSAGE = "[redacted: message not on the tag allowlist]";

function allowedMessage(text: unknown): boolean {
  return typeof text === "string" && ALLOWED_MESSAGE_PATTERNS.some((re) => re.test(text));
}

export function scrubMessageValue(value: unknown): unknown {
  if (typeof value === "string") return allowedMessage(value) ? value : REDACTED_MESSAGE;
  if (value && typeof value === "object") {
    // Sentry's structured form: { message, formatted, params }.
    //
    // ⚠ BOTH `params` and `formatted` go, unconditionally. v3 dropped `params`
    // with the reasoning "it holds the interpolation values" and KEPT
    // `formatted` — but `formatted` IS the interpolated result of message+params.
    // Dropping the copy and keeping the result left the whole value on the wire,
    // and it fired even with `message` absent entirely.
    const v = value as { message?: unknown };
    const out: { message?: string } = {};
    if (typeof v.message === "string") {
      out.message = allowedMessage(v.message) ? v.message : REDACTED_MESSAGE;
    }
    return out;
  }
  // Neither a string nor an object: not a shape we can reason about, so it does
  // not travel.
  return REDACTED_MESSAGE;
}

// ── event_fields (contract v4) ──────────────────────────────────────────────
// tags / fingerprint / transaction were "safe by discipline, RULING OWED" in v3.
// The ruling: allowlist tags and fingerprint, keep transaction but route-shape
// it. `transaction` on the browser SDK is derived from location.pathname — the
// exact channel request.url just closed — so shipping it raw would reopen it.
const ALLOWED_TAG_KEYS: string[] = [];
const ALLOWED_FINGERPRINTS = ["{{ default }}"];

/**
 * Sentry `beforeSend`.
 *
 * ⚠ ARITY (bypass catalogue #11). Sentry calls this as `beforeSend(event, hint)`
 * — see instrumentation-client.ts, sentry.server.config.ts and
 * sentry.edge.config.ts, all of which pass it by reference. Every gate used to
 * call `scrubEvent(event)` with ONE argument, so a second parameter that changed
 * behaviour would have been green everywhere and leaked 100%.
 *
 * It deliberately DECLARES ONE PARAMETER, and the gate asserts that
 * (`scrubEvent.length <= 1`) while calling it with two. JavaScript discards the
 * extra argument, so the hint — which carries the original exception and is NOT
 * part of the transmitted payload — cannot influence what is scrubbed. Adding a
 * second parameter here is precisely the change that assertion exists to catch.
 */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  // Totality, not just fields. A cross-implementation diff over 33 adversarial
  // events found exactly one disagreement: the backend returned a null event,
  // this threw `Cannot read properties of null`. The contract specifies WHICH
  // fields are scrubbed and structurally cannot state that — so it is stated here.
  if (!event) return event;
  if (event.request) {
    delete event.request.data; // bodies — could contain transcript / ЕГН
    delete event.request.cookies;
    delete event.request.headers; // could carry Authorization / X-Admin-Secret
    delete event.request.query_string;
    // ⚠ A NON-STRING url is DELETED, not passed through. The reduction used to
    // be gated on `typeof === 'string'`, so a String object or a { href } shape
    // survived verbatim — a scrub-less failure direction.
    if (typeof event.request.url === "string") {
      event.request.url = scrubUrl(event.request.url);
    } else if ("url" in event.request) {
      delete event.request.url;
    }
  }
  delete event.user;
  // Breadcrumbs: Sentry's default breadcrumbsIntegration turns console.* + fetch/xhr into context
  // attached to each error — clean only as long as nobody ever logs PII. Drop them so a stray
  // future `console.log(patient)` can't ride into Sentry (guarantee by construction, same
  // rationale as the backend).
  delete event.breadcrumbs;
  // extra / contexts can carry arbitrary attached data — anything a future
  // captureException(err, { extra }) or setContext would surface. Dropped for
  // the same by-construction reason, and because the backend has dropped them
  // since B-1 while this file claimed to mirror it.
  delete event.extra;
  delete event.contexts;
  // message / logentry — see the policy above. Only touched when present, so an
  // ordinary exception event keeps the shape Sentry expects.
  const e = event as unknown as Record<string, unknown>;
  if ("message" in e) e.message = scrubMessageValue(e.message);
  if ("logentry" in e) e.logentry = scrubMessageValue(e.logentry);

  // event_fields (v4).
  if ("tags" in e && e.tags && typeof e.tags === "object") {
    const src = e.tags as Record<string, unknown>;
    const kept: Record<string, unknown> = {};
    for (const k of ALLOWED_TAG_KEYS) if (k in src) kept[k] = src[k];
    e.tags = kept;
  }
  if ("fingerprint" in e) {
    const fp = Array.isArray(e.fingerprint) ? e.fingerprint : [];
    e.fingerprint = fp.filter((x) => typeof x === "string" && ALLOWED_FINGERPRINTS.includes(x));
  }
  // transaction is KEPT — it is the route name — but route-shaped, because on
  // the browser SDK it is derived from location.pathname.
  if (typeof e.transaction === "string") e.transaction = scrubPath(e.transaction);
  else if ("transaction" in e) delete e.transaction;
  return event;
}
