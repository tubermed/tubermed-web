// Server-side Sentry (Node runtime) — imported by instrumentation.ts register() when
// NEXT_RUNTIME === 'nodejs'. No-op unless a DSN is set. EU DSN only, NO tracing, PII scrubbed.
// (Session Replay is browser-only and is not added anywhere.)
import * as Sentry from "@sentry/nextjs";
import { scrubEvent } from "./lib/sentry-scrub";

const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn, // EU-region DSN (…ingest.de.sentry.io)
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0, // errors only — NO performance tracing
    sendDefaultPii: false, // never auto-attach IP / cookies / headers / user
    beforeSend: scrubEvent, // shared PII scrub (request body/headers/cookies/qs + user + breadcrumbs)
  });
}
