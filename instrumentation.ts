// Next 16 server instrumentation entry point (root; instrumentation is stable in Next 16 — no
// experimental flag needed). register() loads the runtime-appropriate Sentry init; onRequestError
// forwards server/route/render errors to Sentry (scrubbed by the server config's beforeSend).
// All a no-op without a DSN (each sentry.*.config guards its own Sentry.init).
import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
