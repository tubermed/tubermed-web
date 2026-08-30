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

/** Replace identifier-shaped path segments with `:id`, by shape and by position. */
export function scrubPath(pathname: string): string {
  const parts = pathname.split("/");
  for (let i = 0; i < parts.length; i++) {
    const seg = parts[i];
    if (!seg) continue;
    if (isIdShaped(seg)) { parts[i] = ":id"; continue; }
    const prev = i > 0 ? parts[i - 1] : "";
    if (COLLECTIONS.includes(prev) && !COLLECTION_LITERALS.includes(seg)) parts[i] = ":id";
  }
  return parts.join("/");
}

export function scrubUrl(url: string): string {
  try {
    const u = new URL(url);
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
const ALLOWED_MESSAGE_TAGS = ["[usage-caps]"];
const REDACTED_MESSAGE = "[redacted: message not on the tag allowlist]";

function allowedMessage(text: unknown): boolean {
  return typeof text === "string" && ALLOWED_MESSAGE_TAGS.some((t) => text.startsWith(t));
}

export function scrubMessageValue(value: unknown): unknown {
  if (typeof value === "string") return allowedMessage(value) ? value : REDACTED_MESSAGE;
  if (value && typeof value === "object") {
    // Sentry's structured form: { message, formatted, params }. `params` holds
    // the interpolation values — exactly where the variable part lives — so it
    // goes unconditionally.
    const v = value as { message?: unknown; formatted?: unknown };
    const out: { message?: string; formatted?: string } = {};
    if (typeof v.message === "string") {
      out.message = allowedMessage(v.message) ? v.message : REDACTED_MESSAGE;
    }
    if (typeof v.formatted === "string") {
      out.formatted = allowedMessage(v.formatted) ? v.formatted : REDACTED_MESSAGE;
    }
    return out;
  }
  // Neither a string nor an object: not a shape we can reason about, so it does
  // not travel.
  return REDACTED_MESSAGE;
}

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
    if (typeof event.request.url === "string") {
      event.request.url = scrubUrl(event.request.url);
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
  return event;
}
