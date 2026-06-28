// Sentry EU-ingest CSP origin derivation — mirrors next.config.ts `backendConnectOrigins()`:
// derive the connect-src origin from an env var, never hardcode it. Kept as a small PURE module
// (no @sentry import) so next.config.ts AND scripts/sentry-csp.ts both consume it, and so it is
// unit-testable WITHOUT importing the withSentryConfig-wrapped build config.
//
// EU-ONLY INVARIANT (medical product): the ONLY Sentry origin ever allowed into connect-src is
// the German (EU) ingest host `*.ingest.de.sentry.io`. A DSN pointing anywhere else (US / other
// region / self-hosted / malformed) yields NO origin — the CSP never opens a non-EU destination.

const EU_INGEST_HOST = /(^|\.)ingest\.de\.sentry\.io$/;

/** Origin of an EU Sentry ingest DSN, or null if unset / not the EU SaaS ingest host. */
export function sentryIngestOrigin(dsn: string | undefined): string | null {
  if (!dsn) return null;
  try {
    const url = new URL(dsn);
    if (!EU_INGEST_HOST.test(url.hostname)) return null; // EU guard — never a non-EU origin
    return url.origin; // scheme://host (strips DSN userinfo + project path)
  } catch {
    return null;
  }
}

/** connect-src additions for Sentry — [] unless NEXT_PUBLIC_SENTRY_DSN is an EU ingest DSN. */
export function sentryConnectOrigins(): string[] {
  const origin = sentryIngestOrigin(process.env.NEXT_PUBLIC_SENTRY_DSN);
  return origin ? [origin] : [];
}
