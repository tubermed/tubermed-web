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
export function scrubUrl(url: string): string {
  try {
    const u = new URL(url);
    // `origin` also drops any user:password@ prefix — another credential channel.
    return u.origin + u.pathname;
  } catch {
    const cut = url.search(/[?#]/);
    return cut === -1 ? url : url.slice(0, cut);
  }
}

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
  return event;
}
