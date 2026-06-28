// Client-side Sentry — Next 16 runs instrumentation-client.ts before hydration. No-op unless
// NEXT_PUBLIC_SENTRY_DSN is set (optional-env pattern, mirrors the backend instrument.js), so this
// is safe to ship/build before the DSN exists.
//
// HARD CONSTRAINTS (medical product): EU DSN only; NO Session Replay (records the DOM = patient
// data); NO performance tracing; PII scrubbed by construction.
import * as Sentry from "@sentry/nextjs";
import { scrubEvent } from "./lib/sentry-scrub";

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN, // EU-region DSN (…ingest.de.sentry.io) — set in Vercel
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0, // errors only — no trace/perf data is ever sent
    replaysSessionSampleRate: 0, // NO Session Replay
    replaysOnErrorSampleRate: 0, // NO Session Replay
    sendDefaultPii: false, // never auto-attach IP / cookies / headers / user
    beforeSend: scrubEvent, // shared PII scrub (request body/headers/cookies/qs + user + breadcrumbs)
    // STRIP browserTracingIntegration. @sentry/nextjs v10 auto-adds it to the CLIENT default
    // integrations (the build-time __SENTRY_TRACING__ tree-shake that would suppress it is a
    // webpack-only flag that NO-OPS under Next 16's Turbopack), and it would patch
    // history/fetch/performance + add webVitals. We forbid ALL performance tracing, so remove it
    // here at the init site — runtime, bundler-agnostic. (replayIntegration is NOT a default
    // integration in @sentry/browser v10, so there is nothing to strip for Replay.)
    integrations: (defaultIntegrations) =>
      defaultIntegrations.filter((integration) => integration.name !== "BrowserTracing"),
  });
}
