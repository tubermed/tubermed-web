// ── Result-page identity resolution ─────────────────────────────────────────
// The result page has three places a consultation identity can come from:
//   • the URL (?visit=<id>)            — what the doctor asked to see;
//   • tuber_last_result (sessionStorage) — the AI blob written at generation,
//     whose consultationId becomes `original.consultationId`, the target of
//     EVERY mutating call (/edit, /approve, /seal, /erase, /export);
//   • tuber_pending_visit (sessionStorage) — the staging context that renders
//     the visit header.
//
// They MUST agree. The 2026-07-29 P0 came from exactly this: the blob and the
// pending visit outlive their own visit in sessionStorage (only „+ Нова
// консултация" clears them), so opening ANOTHER consultation by URL — a
// notes-library click, a back-navigation — painted a chimera: the URL row's
// lifecycle (sealed + approved) over the previous visit's header and
// transcript, and, far worse, aimed every write at the PREVIOUS visit's row.
// A doctor could edit note B on screen and silently overwrite note A, or
// approve/erase a row they were not looking at — the лекарят-остава-авторът
// invariant broken client-side while the backend behaved perfectly.
//
// The rule this module encodes: the URL id is the page's identity. Stored
// context is used ONLY when it provably belongs to that identity; anything
// else is ignored and the page cold-start-recovers from the server row alone.
// The mismatched blob is left in storage untouched — it still belongs to its
// own visit and must keep working there.

import type { PendingVisit, TranscribeResult } from './types';

export type ResultBootstrapDecision =
  /** Paint the blob now; reconcile against the server when the URL names the
   *  visit. `pendingVisit` is null unless it belongs to the SAME consultation. */
  | {
      mode: 'paint';
      result: TranscribeResult;
      pendingVisit: PendingVisit | null;
      reconcileVisitId: string | null;
    }
  /** No usable blob for this visit — rebuild everything from GET /:id. */
  | { mode: 'recover'; visitId: string }
  /** No blob and no URL id — nothing to show; leave the page. */
  | { mode: 'bounce' };

function parseBlob(raw: string): TranscribeResult | null {
  try {
    const parsed = JSON.parse(raw) as TranscribeResult;
    if (!parsed || typeof parsed.consultationId !== 'string' || !parsed.fields) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function resolveResultBootstrap(
  rawBlob: string | null,
  rawPendingVisit: string | null,
  visitId: string | null,
): ResultBootstrapDecision {
  const blob = rawBlob ? parseBlob(rawBlob) : null;

  if (!blob) {
    return visitId ? { mode: 'recover', visitId } : { mode: 'bounce' };
  }

  // The identity assertion. A blob from another consultation is not painted
  // and must never become the write target — recover the URL's row instead.
  if (visitId && blob.consultationId !== visitId) {
    return { mode: 'recover', visitId };
  }

  // The visit header context is subject to the same rule: adopt it only when
  // it belongs to the consultation being rendered.
  let pendingVisit: PendingVisit | null = null;
  if (rawPendingVisit) {
    try {
      const pv = JSON.parse(rawPendingVisit) as PendingVisit;
      if (pv && pv.consultation_id === blob.consultationId) pendingVisit = pv;
    } catch {
      /* malformed — render without the visit header */
    }
  }

  return { mode: 'paint', result: blob, pendingVisit, reconcileVisitId: visitId };
}

// ── Scribe entry gate ────────────────────────────────────────────────────────
// The same identity rule, applied to STARTING a recording. tuber_pending_visit
// is the staging handoff from /app/new-visit — a ticket to record into ONE
// consultation row. The trap (follow-up to the P0 above): the ticket outlives
// the visit, and a matching consultation_id was the scribe's only check, so
// browser-back to /app/scribe?visit=<finished id> started a second recording
// into an already-`generated` row — whose submit can only 409 into a dead end.
//
// The client-side proof that a visit already has its note is the result blob:
// it is written at exactly one place (transcription submit) and carries the
// consultationId it belongs to. Pending + blob for the SAME id = spent ticket
// → recover; cold-start recovery's status matrix then routes the doctor to
// the result page. A missing, foreign, or malformed blob proves nothing and
// must not block the recording (mid-visit refresh, fresh staging over an old
// blob) — when in doubt, the server's status is the arbiter via recovery.

export type ScribeGateDecision =
  /** Valid staging ticket for this URL row — proceed to record. */
  | { mode: 'record'; pendingVisit: PendingVisit }
  /** No usable ticket (absent, foreign, malformed, or already spent) —
   *  clear it and let cold-start recovery route by server status. */
  | { mode: 'recover' };

export function resolveScribeGate(
  rawPendingVisit: string | null,
  rawBlob: string | null,
  visitId: string,
): ScribeGateDecision {
  let pending: PendingVisit | null = null;
  if (rawPendingVisit) {
    try {
      pending = JSON.parse(rawPendingVisit) as PendingVisit;
    } catch {
      /* malformed — treat as absent */
    }
  }
  if (!pending || pending.consultation_id !== visitId) {
    return { mode: 'recover' };
  }

  const blob = rawBlob ? parseBlob(rawBlob) : null;
  if (blob && blob.consultationId === visitId) {
    return { mode: 'recover' };
  }

  return { mode: 'record', pendingVisit: pending };
}
