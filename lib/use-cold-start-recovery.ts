'use client';

// ── Cold-start recovery for the scribe flow ─────────────────────────────────
// On a hard refresh / new tab / laptop-sleep, the in-memory + sessionStorage
// visit context (tuber_pending_visit / tuber_last_result) is gone, and the
// scribe pages would otherwise bounce to /app/new-visit. This hook recovers
// from the URL (?visit=<consultation_id>) instead:
//   GET /api/consultations/:id → status + visit metadata + note + consent ts
// It assembles a PendingVisit-shaped object so existing components consume it
// unchanged, and centralizes the status→destination matrix from the STEP 4
// investigation report.
//
// Identity-free by design: recovery reads nothing but the consultation row —
// the visit header renders from the row's own metadata.
//
// Runs ONLY when `visitId` is non-null — the pages pass null on the happy path
// (sessionStorage present), so this never fires there.
//
// Unrecoverable (404, cross-org, network failure) → redirect to /app/new-visit
// with a one-shot notice. We never render a faked screen.

import { useEffect, useState } from 'react';
import { api, ApiError, clearSession } from '@/lib/api';
import type { PendingVisit, TranscribeFields } from '@/lib/types';

export type RecoveryPage = 'scribe' | 'result';

export type ColdStartRecovery =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | {
      phase: 'recovered';
      status: string;
      pendingVisit: PendingVisit;
      note: TranscribeFields | null;
    }
  | { phase: 'redirect'; to: string };

// One-shot reason stashed in sessionStorage for /app/new-visit to surface as a
// toast after an unrecoverable / abandoned redirect.
export const RECOVERY_NOTICE_KEY = 'tuber_recovery_notice';

type Destination =
  | { kind: 'stay' }
  | { kind: 'redirect'; to: string; notice?: string };

// status → where the visit should land, per page. Loop-free by construction:
//   • generated/exported WITH a note → scribe redirects to result, result stays
//   • generated/exported WITHOUT a note (inconsistent) → BOTH pages → new-visit
//     (never ping-pongs)
//   • pending/started/error → stay on scribe; result redirects to scribe (which
//     then stays) — terminates in one hop
//   • abandoned → new-visit
function decide(
  page: RecoveryPage,
  status: string,
  hasNote: boolean,
  visitId: string,
): Destination {
  if (status === 'abandoned') {
    return { kind: 'redirect', to: '/app/new-visit', notice: 'visit_abandoned' };
  }
  if (status === 'generated' || status === 'exported') {
    if (!hasNote) {
      // Filed status but no note — inconsistent. Don't fake a note, don't loop.
      return { kind: 'redirect', to: '/app/new-visit', notice: 'visit_unavailable' };
    }
    return page === 'result'
      ? { kind: 'stay' }
      : { kind: 'redirect', to: `/app/scribe/result?visit=${visitId}` };
  }
  // pending / started / error / anything else
  return page === 'scribe'
    ? { kind: 'stay' }
    : { kind: 'redirect', to: `/app/scribe?visit=${visitId}` };
}

export function useColdStartRecovery(
  visitId: string | null,
  page: RecoveryPage,
): ColdStartRecovery {
  const [state, setState] = useState<ColdStartRecovery>({ phase: 'idle' });

  useEffect(() => {
    if (!visitId) {
      setState({ phase: 'idle' });
      return;
    }
    let cancelled = false;
    setState({ phase: 'loading' });

    const redirect = (to: string, notice?: string) => {
      if (cancelled) return;
      if (notice) {
        try {
          sessionStorage.setItem(RECOVERY_NOTICE_KEY, notice);
        } catch {
          /* sessionStorage unavailable — proceed without the notice */
        }
      }
      setState({ phase: 'redirect', to });
    };

    (async () => {
      try {
        const { consultation } = await api.getConsultation(visitId);

        const dest = decide(
          page,
          consultation.status,
          consultation.note != null,
          visitId,
        );
        if (dest.kind === 'redirect') {
          redirect(dest.to, dest.notice);
          return;
        }
        if (cancelled) return;

        // Rebuild the visit header from the row's own metadata — no patient
        // fetch, no identity.
        const pendingVisit: PendingVisit = {
          consultation_id: consultation.id,
          created_at: consultation.created_at,
          visit_metadata: {
            chief_complaint: consultation.chief_complaint,
            visit_type: consultation.visit_type,
            note_type: consultation.note_type,
          },
          consent_to_record_at: consultation.consent_to_record_at,
        };

        setState({
          phase: 'recovered',
          status: consultation.status,
          pendingVisit,
          note: consultation.note,
        });
      } catch (err) {
        // Invalid/expired token → clear the dead session BEFORE bouncing to
        // login (same clear-before-redirect rule as the scribe me() probe and
        // PcMode onAuthError). Leaving it parked rendered a broken workspace
        // on /app/new-visit and shadowed the next login. Loop-free: login
        // finds no token after the clear and just shows the form.
        if (err instanceof ApiError && err.status === 401) {
          clearSession();
          redirect('/app/login');
          return;
        }
        // 404 / cross-org / network failure → unrecoverable.
        redirect('/app/new-visit', 'visit_unavailable');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [visitId, page]);

  return state;
}
