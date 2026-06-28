// Shared Sentry PII scrub — used by the CLIENT, SERVER, and EDGE Sentry.init sites so the
// no-PII guarantee holds BY CONSTRUCTION, not per-site discipline. Mirrors the backend
// tubermed-backend/instrument.js beforeSend EXACTLY (request body/cookies/headers/query_string +
// user) and adds the same breadcrumb drop.
//
// This is a MEDICAL product (special-category data): an error payload must never carry a
// transcript, ЕГН, request body, headers (Authorization / X-Admin-Secret), cookies, a query
// string, user identity, or console breadcrumbs. `sendDefaultPii: false` already prevents most of
// this; the scrub makes it a guarantee.
import type { ErrorEvent } from "@sentry/nextjs";

export function scrubEvent(event: ErrorEvent): ErrorEvent {
  if (event.request) {
    delete event.request.data; // bodies — could contain transcript / ЕГН
    delete event.request.cookies;
    delete event.request.headers; // could carry Authorization / X-Admin-Secret
    delete event.request.query_string;
  }
  delete event.user;
  // Breadcrumbs: Sentry's default breadcrumbsIntegration turns console.* + fetch/xhr into context
  // attached to each error — clean only as long as nobody ever logs PII. Drop them so a stray
  // future `console.log(patient)` can't ride into Sentry (guarantee by construction, same
  // rationale as the backend).
  delete event.breadcrumbs;
  return event;
}
