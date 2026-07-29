'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import AppShell from '@/components/AppShell';
import Stepper from '@/components/Stepper';
import { SCRIBE_FLOW_STEPS } from '@/lib/flow';
import EditableField from '@/components/EditableField';
import SkeletonInput from '@/components/SkeletonInput';
import MkbPicker from '@/components/MkbPicker';
import MkbTypeahead from '@/components/MkbTypeahead';
import MedsPanel from '@/components/MedsPanel';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Button } from '@/components/ui/Button';
import { NoteSectionHead } from '@/components/ui/NoteSection';
import VisitHeaderStrip from '@/components/VisitHeaderStrip';
import Toast, { type ToastData, type ToastKind } from '@/components/Toast';
import { api, ApiError, getSession } from '@/lib/api';
import type { DoctorInfo } from '@/lib/api';
import { useColdStartRecovery } from '@/lib/use-cold-start-recovery';
import { resolveResultBootstrap } from '@/lib/result-identity';
import type {
  TranscribeResult,
  TranscribeFields,
  ComorbidDiagnosis,
  Medication,
  PendingVisit,
  ExportSignalPayload,
  MkbReview,
  EchoFields,
  EchoMeasurement,
} from '@/lib/types';
import EchoNoteView from '@/components/EchoNoteView';
import InvestigationBlockCard from '@/components/InvestigationBlockCard';
import { setEchoPath } from '@/lib/echo-template';
import { mergeBackendAlerts, groupAlerts, type SafetyAlert } from '@/lib/drug-safety';
import { loadMkb, getMkbDataSync, resolveMkb } from '@/lib/mkb10';
import { filedMainTerm, filedComorbidityTerm, spokenDivergesFromOfficial } from '@/lib/diagnosis';
import { loadIal } from '@/lib/ial-meds';
import { findHighlights } from '@/lib/vital-rules';
import { findSourceSpan, type SourceSpan } from '@/lib/source-grounding';
import { storedSpanFor } from '@/lib/field-sources';
import { mkbReviewCopy } from '@/lib/mkb-review';
import {
  resolveUncertainSpans,
  UNCERTAIN_FIELDS,
  uncertainAckKey,
  type ResolvedUncertainSpan,
} from '@/lib/uncertain-spans';
import {
  formatPlainText,
  copyToClipboard,
  generatePdfHtml,
  openPdfPreview,
  generateWordHtml,
  downloadWord,
  formatEchoPlainText,
  generateEchoHtml,
  izsledvaniaSectionText,
  izdadeniSectionText,
  type ExportIdentity,
} from '@/lib/exporters';
import CopyButton from '@/components/CopyButton';
import PatientSummaryModal from '@/components/PatientSummaryModal';

const RESULT_STORAGE_KEY  = 'tuber_last_result';
const PENDING_VISIT_KEY   = 'tuber_pending_visit';

// Extraction returns the literal Bulgarian phrase "не е посочена" when the
// doctor didn't specify a med field. Treat it as empty so the editable row
// renders the missing-field flag instead of literal text the doctor would
// have to delete before typing. Hard requirement: never auto-fill defaults.
const NOT_SPECIFIED = 'не е посочена';

function normalizeMedField(v: string | undefined): string | undefined {
  if (!v) return undefined;
  const t = v.trim();
  if (!t || t.toLowerCase() === NOT_SPECIFIED) return undefined;
  return v;
}

function normalizeMedications(
  list: Medication[] | undefined
): Medication[] {
  if (!list) return [];
  return list.map((m) => ({
    inn: m.inn,
    dose: normalizeMedField(m.dose),
    regimen: normalizeMedField(m.regimen),
    route: normalizeMedField(m.route),
    duration: normalizeMedField(m.duration),
  }));
}

type ReviewStatus = 'pending' | 'confirmed';

interface NavItem {
  id: string;
  label: string;
  indent?: boolean;
  scrollMode?: 'section' | 'top';
}

const NAV_ITEMS: NavItem[] = [
  { id: 'sec-diag', label: 'Диагнози МКБ-10' },
  { id: 'sec-anamneza', label: 'Анамнеза' },
  { id: 'sec-obektivno', label: 'Обективен статус' },
  { id: 'sec-izsledvania', label: 'Изследвания' },
  { id: 'sec-naznacheni', label: 'Назначени изследвания', indent: true },
  { id: 'sec-terapia', label: 'Терапия' },
  { id: 'sec-meds-panel', label: 'Медикаменти', scrollMode: 'top' },
  { id: 'sec-izdadeni', label: 'Издадени документи' },
  { id: 'sec-napravlenia', label: 'Направления', indent: true },
];

type MkbTarget = { kind: 'osnovna' } | { kind: 'co'; index: number } | { kind: 'co-add' };

// Single, simple measure used by all the chars_changed math on this page.
// Defined once here so the per-edit value sent to /edit and the per-field
// rollup sent to /export can never disagree.
//
// Rule: absolute difference in character LENGTH between the current value
// and the AI-extracted original of the SAME field. Always >= 0. Behaves
// well under undo — restoring a field to its original value yields 0,
// without needing per-keystroke history.
//
// Nested fields (medications_list, pridruzhavashti) are serialized with
// JSON.stringify; arrays of strings join via the same path. This is an
// approximation — flipping an item's order or swapping a synonym of equal
// length contributes 0 — but the user explicitly asked for "a basic
// character diff count, keep it simple", and the alternative (real
// structural diff) is over-engineering.
function stringifyForDiff(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return JSON.stringify(value);
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

// useSearchParams() must live inside a Suspense boundary in Next.js 16.
// ── МКБ reconcile helpers (Bug 1 Phase 2) ───────────────────────────────────
// Client-side mirror of the backend gate (validateMkbCodes) for INSTANT feedback
// as the doctor edits. The server re-validates on save and is the final authority
// (the 409 backstop). Returns null when the nomenclature isn't loaded yet — in
// that case we keep the server's mkb_review rather than guess.
function clientMkbReview(code: string): {
  mkb_review: MkbReview;
  osnovna_mkb_term?: string;
  osnovna_mkb_term_source?: 'exact' | 'parent';
} | null {
  const c = (code || '').trim();
  if (!c) return { mkb_review: { needs_review: true, reason: 'missing_code', code: '' } };
  const data = getMkbDataSync();
  if (!data) return null; // nomenclature not loaded — defer to the server's mkb_review
  const r = resolveMkb(data, c);
  if (!r.ok) return { mkb_review: { needs_review: true, reason: 'invalid_code', code: c } };
  return {
    mkb_review: { needs_review: false },
    osnovna_mkb_term: r.term,
    osnovna_mkb_term_source: r.source,
  };
}

// Localized block message for the approve toast + the 409 backstop. Reads from
// the single mkbReviewCopy source (lib/mkb-review.ts) so it can never drift from
// the inline DiagnosesSection banner, and mirrors the backend mkbReviewBlock()
// copy so the toast and the 409 backstop read identically.
function mkbBlockMessage(review?: MkbReview | null): string {
  return mkbReviewCopy(review).blockMessage;
}

export default function ResultPage() {
  return (
    <Suspense fallback={<BootSplash />}>
      <ResultPageInner />
    </Suspense>
  );
}

function BootSplash() {
  return (
    <main className="min-h-screen p-6">
      <span className="sr-only">Зареждане…</span>
      <div className="max-w-3xl mx-auto">
        <NoteSkeleton />
      </div>
    </main>
  );
}

// Note-shaped loading placeholder — ONE calm document sheet matching the real
// de-boxed note (bg-white rounded-2xl border / --color-border, p-6 sm:p-8): a
// document-header row then sections in the canonical order (Диагнози → Анамнеза
// → Обективно състояние → Изследвания → Терапия). Each section MIRRORS
// NoteSectionHead — a tick + a short label line + a hairline divider (same
// --color-hairline + mb-3/mt-2 spacing) + content rows — so neither box edges
// NOR section dividers reflow when the note lands. Reuses .nv-skeleton via
// SkeletonInput (reduced-motion hard-stop honored in globals.css). doctor is
// still null during this wait, so AppShell can't mount — this is the centered
// single-column document; the real 3-column grid takes over once doctor + the
// note resolve.
function NoteSkeleton() {
  const sections: { label: string; lines: string[]; chips?: boolean }[] = [
    { label: '88px',  lines: ['100%', '92%', '70%'], chips: true }, // Диагнози (+ comorbidity chips)
    { label: '76px',  lines: ['100%', '96%', '60%'] },              // Анамнеза
    { label: '150px', lines: ['100%', '84%'] },                     // Обективно състояние
    { label: '92px',  lines: ['100%', '72%'] },                     // Изследвания
    { label: '64px',  lines: ['100%', '88%', '64%'] },              // Терапия
  ];
  return (
    <div
      className="bg-white rounded-2xl border p-6 sm:p-8"
      style={{ borderColor: 'var(--color-border)' }}
      aria-hidden
    >
      {/* document header — title + date, matching the real note */}
      <div className="flex items-baseline justify-between flex-wrap gap-4 mb-6">
        <SkeletonInput height="32px" width="240px" />
        <SkeletonInput height="18px" width="90px" />
      </div>
      <div className="space-y-8">
        {sections.map((s, i) => (
          <div key={i}>
            {/* NoteSectionHead mirror: tick + icon + label line + hairline divider */}
            <div className="mb-4">
              <div className="flex items-center gap-2 min-h-[24px]">
                <span
                  className="inline-block flex-shrink-0 rounded-full"
                  style={{ width: 3, height: 16, background: 'var(--color-hairline)' }}
                />
                <SkeletonInput height="16px" width="16px" />
                <SkeletonInput height="14px" width={s.label} />
              </div>
              <div className="mt-2" style={{ borderBottom: '1px solid var(--color-hairline)' }} />
            </div>
            <div className="space-y-2">
              {s.lines.map((w, j) => (
                <SkeletonInput key={j} height="14px" width={w} />
              ))}
            </div>
            {s.chips && (
              <div className="flex flex-wrap gap-2 mt-3">
                <SkeletonInput height="28px" width="120px" style={{ borderRadius: '9999px' }} />
                <SkeletonInput height="28px" width="96px" style={{ borderRadius: '9999px' }} />
                <SkeletonInput height="28px" width="110px" style={{ borderRadius: '9999px' }} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ResultPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Cold-start recovery: set to ?visit= when tuber_last_result is absent
  // (hard refresh / new tab). Drives useColdStartRecovery; null on happy path.
  const [recoverVisitId, setRecoverVisitId] = useState<string | null>(null);
  // Server-reconcile target: set to ?visit= when we DID paint from the stale
  // tuber_last_result blob. Drives the reconcile effect below, which overwrites
  // the rendered fields with the server's extracted_fields (the edited truth).
  const [reconcileVisitId, setReconcileVisitId] = useState<string | null>(null);
  const [doctor, setDoctor] = useState<DoctorInfo | null>(null);
  // Practice/doctor identity for the exported document header. Best-effort —
  // a failed /me leaves this undefined and the export renders the old header.
  const [exportIdentity, setExportIdentity] = useState<ExportIdentity | undefined>(undefined);
  const [pendingVisit, setPendingVisit] = useState<PendingVisit | null>(null);
  const [original, setOriginal] = useState<TranscribeResult | null>(null);
  const [fields, setFields] = useState<TranscribeFields>({});
  const [reviewStatus, setReviewStatus] = useState<ReviewStatus>('pending');
  const [reviewPopupOpen, setReviewPopupOpen] = useState(false);
  const [activeNav, setActiveNav] = useState<string>('sec-diag');
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  // Per-field source grounding (Traceability Phase 1a): the char range in the
  // transcript that the LAST-clicked field came from (null = no clear source).
  // sourceTick re-fires the scroll effect even when the same span is reselected.
  const [sourceSpan, setSourceSpan] = useState<SourceSpan | null>(null);
  const [sourceTick, setSourceTick] = useState(0);
  // Honest source states (trust Batch B): 'stored' = backend-resolved offsets
  // (confident, solid highlight); 'guess' = the alias-bridge, reachable ONLY
  // via the explicit „Покажи предположение" opt-in (dashed highlight) — never
  // the silent default. activeSourceField powers the „няма ясен източник"
  // banner + its guess button for the last clicked unresolved field.
  const [sourceMode, setSourceMode] = useState<'stored' | 'guess' | null>(null);
  const [activeSourceField, setActiveSourceField] = useState<{ fieldKey: string; value: string } | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [mkbOpen, setMkbOpen] = useState(false);
  const [mkbTarget, setMkbTarget] = useState<MkbTarget | null>(null);
  const [lastRemovedMedName, setLastRemovedMedName] = useState<string | null>(
    null
  );
  const [toast, setToast] = useState<ToastData | null>(null);
  const toastIdRef = useRef(0);

  const editTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingEditField = useRef<string | null>(null);
  // chars_changed for the next debounced flush. Captured at the moment
  // updateField runs (when we still have both old and new values).
  const pendingCharsChangedRef = useRef<number>(0);
  // Per-field running |current − original| char-length deltas. Map key is
  // the field name (e.g. 'anamneza', 'osnovna_mkb', 'pridruzhavashti').
  // Read at export time to compute total_chars_edited (sum) and
  // fields_edited_count (size). Once a field is touched, it stays in the
  // map even if its delta returns to 0 — so undoing every edit leaves
  // fields_edited_count > 0 but total_chars_edited = 0.
  const editedFieldsRef = useRef<Map<string, number>>(new Map());
  // Guards the export signal — fire exactly once per consultation session
  // so multiple format clicks (PDF then Word) don't double-count.
  const exportSignalledRef = useRef(false);
  // ── The visit-over seal (backend migration 024) ──────────────────────────
  // Non-null = the лист is closed for editing, permanently. Corrections after
  // this happen in Хипократ, which is the practice's real record.
  //
  // The backend is the enforcement (POST /:id/edit → 409 note_sealed); this
  // state only decides how the page RENDERS. It arrives from GET /:id, so it
  // is set on cold-start recovery and on the same-tab reconcile — the two
  // paths by which a note from an earlier visit gets reopened.
  const [sealedAt, setSealedAt] = useState<string | null>(null);
  const isSealed = sealedAt !== null;

  // ── Article-17 erasure state ────────────────────────────────────────────
  // Non-null = this note's clinical content was scrubbed on request. Distinct
  // from „no note" (pending/error/abandoned): the visit happened, the record
  // skeleton and the consent/approval timestamps survive, and the лист must
  // SAY the content was removed rather than render a bare empty state.
  const [erasedAt, setErasedAt] = useState<string | null>(null);
  const isErased = erasedAt !== null;
  const [eraseConfirmOpen, setEraseConfirmOpen] = useState(false);
  const [erasing, setErasing] = useState(false);

  // A sealed note is APPROVED by construction (the backend only ever seals
  // approved rows), so it must never render as locked: Копирай / Печат / PDF /
  // export stay live. Sealed means cannot be changed, not cannot be used — a
  // doctor may legitimately re-copy the лист into Хипократ weeks later, and
  // unlike an unapproved note he can no longer edit-and-approve his way in.
  //
  // An ERASED note is the opposite case and wins over both: there is no content
  // left, so exporting or summarising it would emit an empty document dressed
  // as a лист. Lock it.
  const isLocked = isErased || (!isSealed && reviewStatus !== 'confirmed');

  // „Render as a document, not a form." True for a sealed note (closed for
  // editing) and for an erased one (nothing left to edit — and an /edit POST
  // from a stale tab is exactly how scrubbed content could crawl back).
  const bodyReadOnly = isSealed || isErased;

  // ── Bootstrap ────────────────────────────────────────────────
  useEffect(() => {
    const session = getSession();
    if (!session) {
      router.replace('/app/login');
      return;
    }
    setDoctor(session.doctor);

    // ONE identity per view of this page: the URL names the consultation, and
    // stored context (blob + pending visit) is adopted ONLY when it provably
    // belongs to it — decision table + tests in lib/result-identity.ts.
    // (P0 2026-07-29: both outlive their visit in sessionStorage, so opening
    // another consultation by URL painted the previous visit's header and
    // transcript under THIS row's sealed+approved lifecycle — and aimed every
    // mutating call, /edit /approve /seal /erase /export, at the PREVIOUS row.)
    const visitId = searchParams.get('visit');

    // This effect re-runs on a same-route ?visit= change with NO remount —
    // every piece of per-consultation state must reset here, or the previous
    // consultation's approved/sealed/erased presentation and edit tracking
    // carry over into the one being opened. The reconcile/recovery below
    // re-derives the real lifecycle from the server.
    //
    // (A still-debounced edit from the previous identity is flushed against
    // the OLD row by the visitParam-keyed cleanup next to the unmount flush —
    // cleanups run before this body, while `original`/fieldsRef still hold the
    // old visit.)
    editedFieldsRef.current = new Map();
    pendingCharsChangedRef.current = 0;
    exportSignalledRef.current = false;
    setReviewStatus('pending');
    setSealedAt(null);
    setErasedAt(null);
    setPendingVisit(null);
    setRecoverVisitId(null);
    setReconcileVisitId(null);

    const decision = resolveResultBootstrap(
      sessionStorage.getItem(RESULT_STORAGE_KEY),
      sessionStorage.getItem(PENDING_VISIT_KEY),
      visitId,
    );
    if (decision.mode === 'bounce') {
      // No blob and no URL id — nothing to show; back to the scribe.
      router.replace('/app/scribe');
      return;
    }
    if (decision.mode === 'recover') {
      // Cold start (hard refresh / new tab), a malformed blob, or a blob that
      // belongs to a DIFFERENT consultation: rebuild everything — note, header,
      // lifecycle AND the write-target identity — from the backend row alone.
      setRecoverVisitId(decision.visitId);
      return;
    }
    setOriginal(decision.result);
    setFields({
      ...decision.result.fields,
      medications_list: normalizeMedications(
        decision.result.fields.medications_list
      ),
    });
    // Visit-header context rides along only when it belongs to the same
    // consultation as the blob (null otherwise — render without the header).
    setPendingVisit(decision.pendingVisit);
    // The blob is the AI output frozen at generation — it never carries the
    // doctor's later edits. Whenever ?visit= is present the server's
    // extracted_fields is the source of truth: we just painted the blob for an
    // instant first render; arm the reconcile effect to overwrite the rendered
    // fields with the server copy. (Fixes same-tab F5 / duplicated-tab showing
    // pre-edit text — sessionStorage survives those, so recovery never fires.)
    setReconcileVisitId(decision.reconcileVisitId);
  }, [router, searchParams]);

  // ── Export identity (practice/doctor header) ───────────────────────────
  // Fetch the doctor's practice/document identity for the exported Амбулаторен
  // лист header. Best-effort and non-blocking: a failed /me just renders the
  // pre-header document (export is never gated on this).
  useEffect(() => {
    let alive = true;
    api
      .me()
      .then((m) => {
        if (!alive) return;
        setExportIdentity({
          practiceName: m.organizationName,
          address: m.practice_address,
          rziNumber: m.rzi_number,
          nzokContract: m.nzok_contract,
          phone: m.practice_phone,
          doctorName: m.name,
          specialty: m.specialty,
          uin: m.uin,
        });
      })
      .catch(() => {
        /* keep the old header — never block export on /me */
      });
    return () => {
      alive = false;
    };
  }, []);

  // ── Cold-start recovery driver ─────────────────────────────────────────
  // Fires only when the bootstrap above set recoverVisitId (tuber_last_result
  // was absent). Rebuilds `original` (and thus the editable note) plus the
  // visit header from the consultation row alone. Inert on happy path.
  const recovery = useColdStartRecovery(recoverVisitId, 'result');
  useEffect(() => {
    if (recovery.phase === 'redirect') {
      router.replace(recovery.to);
      return;
    }
    if (recovery.phase === 'recovered') {
      const note = recovery.note ?? {};
      // No transcript on recovery — the backend omits it by design; '' lets the
      // transcript viewer fall back to its existing "unavailable" state.
      // ACCEPTED (not a bug): originalFieldLengths derives the edit-diff baseline
      // from `original.fields`, which on recovery is the ALREADY-FILED note — so
      // chars_changed measures edits-since-recovery, not edits-since-AI-output.
      setOriginal({
        consultationId: recovery.pendingVisit.consultation_id,
        transcript: '',
        fields: note,
      });
      setFields({
        ...note,
        medications_list: normalizeMedications(note.medications_list),
      });
      setPendingVisit(recovery.pendingVisit);
      // Restore the SERVER's lifecycle state. Without this the page reopened
      // every filed note as unconfirmed and locked Копирай/Печат/PDF on a note
      // the doctor had already approved — /approve is idempotent, so the
      // re-confirm it forced was pure friction. It becomes load-bearing with
      // the seal: a sealed note can never be edited-and-approved back into an
      // unlocked state, so if the approval didn't survive recovery, a closed
      // лист would be permanently un-exportable.
      //
      // BOTH directions on purpose (P0 2026-07-29): restoring only the approved
      // case let a previous consultation's 'confirmed' presentation survive a
      // same-route ?visit= change onto an UNAPPROVED note.
      setReviewStatus(recovery.noteApproved ? 'confirmed' : 'pending');
      setSealedAt(recovery.sealedAt);
      setErasedAt(recovery.erasedAt);
    }
  }, [recovery, router]);

  // ── Server reconcile (happy path + same-tab refresh) ───────────────────────
  // Fires only when the bootstrap painted from the stale tuber_last_result blob
  // AND ?visit= is present (reconcileVisitId set). The blob is the AI output
  // frozen at generation and never carries the doctor's edits, so the server's
  // extracted_fields is the source of truth — overwrite the RENDERED fields.
  //
  // Overwrites `fields` ONLY, never `original`: the chars_changed baseline
  // (originalFieldLengths, seeded from `original`) must stay the blob = the AI
  // output, so the happy-path "edits since AI generation" metric is unchanged.
  // Reseeding the baseline from the server copy would zero it (the server copy
  // already contains the edits → diff against it = 0).
  //
  // Guards (never blank the screen, never clobber a live edit):
  //   • fetch throws            → keep the blob paint
  //   • note is null            → keep the blob paint (pending/error/abandoned)
  //   • doctor already editing  → keep their in-progress edits (sub-second race
  //                               right after load; on an F5 the fresh mount has
  //                               an empty edit map so the overwrite applies).
  useEffect(() => {
    if (!reconcileVisitId) return;
    let cancelled = false;
    (async () => {
      try {
        const { consultation } = await api.getConsultation(reconcileVisitId);
        if (cancelled) return;

        // Lifecycle state is adopted FIRST, before either bail-out below: these
        // are server facts about the row, not a paint that could clobber a live
        // edit. This path is how an OLD note gets opened while a previous
        // visit's blob still sits in sessionStorage (notes-library click →
        // ?visit=<other id> with tuber_last_result present) — miss it and a
        // sealed лист renders fully editable, or an erased one renders the
        // stale blob as if its content were still there.
        // Both directions, like the recovery path: the server is the authority
        // on the approval presentation in EITHER state.
        setReviewStatus(consultation.note_approved ? 'confirmed' : 'pending');
        setSealedAt(consultation.sealed_at ?? null);
        setErasedAt(consultation.erased_at ?? null);

        if (!consultation.note) {
          // An erased note legitimately has none — blank the stale blob so the
          // scrubbed content can't linger on screen, and say why (the erased
          // banner renders off `erasedAt`), not „започнете нов преглед".
          if (consultation.erased_at) {
            setFields({});
            return;
          }
          if (consultation.status === 'abandoned' || consultation.status === 'error') {
            toastIdRef.current += 1;
            setToast({ kind: 'error', message: 'Бележката не е налична — започнете нов преглед', id: toastIdRef.current });
          }
          return;
        }

        if (editedFieldsRef.current.size > 0) return;
        setFields({
          ...consultation.note,
          medications_list: normalizeMedications(consultation.note.medications_list),
        });
      } catch {
        /* transient fetch error → keep the blob paint, never blank the screen */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reconcileVisitId]);

  // Pre-load MKB-10 data so the bidirectional sync works immediately
  // (and so the picker is instant on first open). Silent failure — picker
  // will retry if needed.
  useEffect(() => {
    loadMkb().catch(() => {});
    loadIal().catch(() => {});
  }, []);

  // Per-field AI-original char-length snapshot. Frozen at bootstrap so an
  // undo-to-original yields chars_changed=0 regardless of how many edits
  // happened in between. Computed by Map<fieldKey, originalLength>.
  const originalFieldLengths = useMemo(() => {
    const m = new Map<string, number>();
    if (!original) return m;
    for (const [k, v] of Object.entries(original.fields)) {
      m.set(k, stringifyForDiff(v).length);
    }
    return m;
  }, [original]);

  // Single point of truth for chars_changed math. Called by every field
  // updater with the candidate new value BEFORE setFields is applied.
  const computeCharsChanged = useCallback(
    (fieldKey: string, newValue: unknown): number => {
      const origLen = originalFieldLengths.get(fieldKey) ?? 0;
      const newLen  = stringifyForDiff(newValue).length;
      return Math.abs(newLen - origLen);
    },
    [originalFieldLengths]
  );

  // ── Edit tracking (debounced) ─────────────────────────────────
  // Latest `fields` mirrored into a ref. flushEdit is scheduled via
  // trackEdit's setTimeout, which captures a flushEdit instance. EditableField
  // commits the WHOLE new value in a single onChange (on blur) and the parent
  // doesn't re-render while the textarea is focused — so the captured flushEdit
  // would close over the PRE-edit `fields` and POST a note WITHOUT the edit (the
  // row's edit_count still bumps, masking the loss). Reading fieldsRef.current
  // at flush time guarantees the POST carries the current note: by the time the
  // 1500ms timer fires, the edit is in state and this effect has synced the ref.
  const fieldsRef = useRef<TranscribeFields>(fields);
  useEffect(() => {
    fieldsRef.current = fields;
  }, [fields]);

  const flushEdit = useCallback(() => {
    if (!original) return;
    // Defence in depth against a MISSED read-only surface. Every editor on this
    // page takes a sealed/readOnly prop, but this is the single funnel through
    // which any of them would reach the server — so one guard here means a
    // surface someone forgets to seal can still never write. (The backend
    // refuses anyway with 409 note_sealed; this just avoids a pointless
    // round-trip and a spurious edit_count bump attempt.)
    if (bodyReadOnly) return;
    // Send the edited field name + chars_changed for analytics + the full
    // fields object for backend data sync. The chars_changed value is the
    // snapshot captured at the most recent trackEdit call within this
    // debounce window — see pendingCharsChangedRef.
    const field        = pendingEditField.current ?? undefined;
    const charsChanged = pendingCharsChangedRef.current;
    const postedMkb    = fieldsRef.current.osnovna_mkb ?? '';
    api.editConsultation(original.consultationId, field, fieldsRef.current, charsChanged)
      .then((resp) => {
        // The backend re-ran validateMkbCodes — reflect its AUTHORITATIVE МКБ
        // state. Skip if the doctor changed the code again since this save (a
        // stale response must not clobber the newer optimistic value).
        if (!resp || (fieldsRef.current.osnovna_mkb ?? '') !== postedMkb) return;
        setFields((prev) => ({
          ...prev,
          mkb_review:              resp.mkb_review ?? prev.mkb_review,
          osnovna_mkb_term:        resp.osnovna_mkb_term ?? undefined,
          osnovna_mkb_term_source: resp.osnovna_mkb_term_source ?? undefined,
        }));
      })
      .catch((err) => {
        if (err instanceof ApiError) {
          // 409 note_sealed: the лист was closed while this tab had it open —
          // the doctor started their next visit elsewhere, or the time backstop
          // fired. Adopt the server's truth so the page stops offering an edit
          // it cannot save, and say so plainly rather than dropping the edit in
          // silence. The doctor's on-screen text stays; only the note is closed.
          if (err.status === 409 && err.code === 'note_sealed') {
            const body = err.body as { sealed_at?: string | null } | null;
            setSealedAt(body?.sealed_at ?? new Date().toISOString());
            setReviewStatus('confirmed');
            toastIdRef.current += 1;
            setToast({
              kind: 'error',
              message: 'Листът е приключен — промените не са запазени. Корекциите се правят в Хипократ.',
              id: toastIdRef.current,
            });
            return;
          }
          console.warn('[edit-track] ' + err.status + ' ' + err.message);
        }
      });
    pendingEditField.current = null;
    pendingCharsChangedRef.current = 0;
  }, [original, bodyReadOnly]);

  const trackEdit = useCallback(
    (fieldKey: string, charsChanged: number) => {
      // A sealed note can't be edited; nothing to schedule, and the approval
      // must NOT be invalidated below (that would lock the exports on a note
      // that can never be re-approved by editing).
      if (bodyReadOnly) return;
      pendingEditField.current = fieldKey;
      pendingCharsChangedRef.current = charsChanged;
      // Live per-field rollup map. Overwrite (not add) so the latest
      // delta-from-original wins — that's what makes an undo bring the
      // total back toward 0 instead of stacking.
      editedFieldsRef.current.set(fieldKey, charsChanged);
      if (editTimerRef.current) clearTimeout(editTimerRef.current);
      editTimerRef.current = setTimeout(flushEdit, 1500);
      if (reviewStatus === 'confirmed') setReviewStatus('pending');
    },
    [flushEdit, reviewStatus, bodyReadOnly]
  );

  // Keep a ref to the latest flushEdit so the unmount cleanup — which MUST use
  // [] deps to run only on real unmount — can call the current version (with the
  // current `original`) instead of a closure captured at mount.
  const flushEditRef = useRef(flushEdit);
  useEffect(() => {
    flushEditRef.current = flushEdit;
  }, [flushEdit]);

  // The no-unmount twin of the unmount flush below: a same-route ?visit=
  // navigation (notes-library → another note, back/forward between visits)
  // re-keys this page to ANOTHER consultation without unmounting it. This
  // cleanup runs BEFORE the bootstrap effect resets any state, so `original`
  // and fieldsRef still hold the visit the pending edit belongs to and the
  // flush targets the right row. Same double-flush guard as the unmount path.
  const visitParam = searchParams.get('visit');
  useEffect(() => {
    void visitParam; // the dep IS the trigger: flush when the identity changes
    return () => {
      if (editTimerRef.current) {
        clearTimeout(editTimerRef.current);
        editTimerRef.current = null;
        if (pendingEditField.current !== null) {
          flushEditRef.current();
        }
      }
    };
  }, [visitParam]);

  useEffect(() => {
    return () => {
      // On unmount — including client-side nav like "+ Нова консултация" or
      // jumping to the next patient — flush any pending debounced edit instead
      // of dropping it. Same data-loss class as the stale-closure bug: a doctor
      // who edits then immediately navigates would otherwise lose that last
      // edit. flushEdit reads fieldsRef.current, so the flushed note is current.
      //
      // Double-flush guard: pendingEditField.current is non-null ONLY while an
      // edit is scheduled-but-not-yet-flushed (trackEdit sets it; flushEdit nulls
      // it). If the timer already fired, it's null → we clear the spent timer and
      // do NOT flush again. clearTimeout also cancels the pending callback so the
      // manual flush below is the only one that runs.
      if (editTimerRef.current) {
        clearTimeout(editTimerRef.current);
        editTimerRef.current = null;
        if (pendingEditField.current !== null) {
          flushEditRef.current();
        }
      }
    };
  }, []);

  // ── Field updaters ───────────────────────────────────────────
  const updateField = useCallback(
    <K extends keyof TranscribeFields>(key: K, next: TranscribeFields[K]) => {
      const charsChanged = computeCharsChanged(String(key), next);
      setFields((prev) => ({ ...prev, [key]: next }));
      trackEdit(String(key), charsChanged);
    },
    [trackEdit, computeCharsChanged]
  );

  // ── Echo field updaters (note_type='echo') ───────────────────
  // The echo document is a different nested JSONB shape; these set a template
  // dot-path immutably and route through the SAME edit-flush machinery as the
  // консултація note (trackEdit → flushEdit → POST /edit with fieldsRef.current).
  // `path` is the template field path, which is exactly what the backend's
  // ECHO_EDIT_FIELDS whitelist validates the logged field name against.
  const updateEchoText = useCallback(
    (path: string, value: string) => {
      setFields((prev) => setEchoPath(prev as unknown as EchoFields, path, value) as unknown as TranscribeFields);
      trackEdit(path, value.length);
    },
    [trackEdit]
  );
  const updateEchoMeasurement = useCallback(
    (path: string, next: EchoMeasurement) => {
      setFields((prev) => setEchoPath(prev as unknown as EchoFields, path, next) as unknown as TranscribeFields);
      trackEdit(path, (next.value || '').length);
    },
    [trackEdit]
  );

  // ── Embedded-block field updaters (izsledvania_blocks) ───────
  // Same dot-path mechanism as the echo updaters, prefixed with the block's
  // list position: `izsledvania_blocks.${i}.fields.${path}` (setEchoPath
  // clones the blocks ARRAY as an array on the way down). Routes through the
  // SAME trackEdit → flushEdit machinery — /edit persists the whole fields
  // object verbatim, so the blocks round-trip with zero backend change. The
  // logged field name is the full prefixed path; edit-metrics deliberately
  // does not measure it yet (unmeasured, not corrupted — C10 adds per-block
  // metrics).
  const updateBlockText = useCallback(
    (blockIndex: number, path: string, value: string) => {
      const fullPath = `izsledvania_blocks.${blockIndex}.fields.${path}`;
      setFields((prev) => setEchoPath(prev, fullPath, value));
      trackEdit(fullPath, value.length);
    },
    [trackEdit]
  );
  const updateBlockMeasurement = useCallback(
    (blockIndex: number, path: string, next: EchoMeasurement) => {
      const fullPath = `izsledvania_blocks.${blockIndex}.fields.${path}`;
      setFields((prev) => setEchoPath(prev, fullPath, next));
      trackEdit(fullPath, (next.value || '').length);
    },
    [trackEdit]
  );

  // Comorbidity add — a search-first pick from the typeahead creates the row
  // (code + official term together). The doctor picked it, so there is no spoken
  // original; diagnoza + mkb_term are both the official term.
  const addComorbidity = useCallback(
    (code: string, term: string) => {
      const nextList = [...(fields.pridruzhavashti || []), { mkb: code, diagnoza: term, mkb_term: term }];
      const charsChanged = computeCharsChanged('pridruzhavashti', nextList);
      setFields((prev) => ({
        ...prev,
        pridruzhavashti: [...(prev.pridruzhavashti || []), { mkb: code, diagnoza: term, mkb_term: term }],
      }));
      trackEdit('pridruzhavashti', charsChanged);
    },
    [trackEdit, computeCharsChanged, fields.pridruzhavashti]
  );

  const removeComorbidity = useCallback(
    (idx: number) => {
      const nextList = (fields.pridruzhavashti || []).filter((_, i) => i !== idx);
      const charsChanged = computeCharsChanged('pridruzhavashti', nextList);
      setFields((prev) => ({
        ...prev,
        pridruzhavashti: (prev.pridruzhavashti || []).filter((_, i) => i !== idx),
      }));
      trackEdit('pridruzhavashti', charsChanged);
    },
    [trackEdit, computeCharsChanged, fields.pridruzhavashti]
  );

  // ── Meds change — detect removals to drive therapy hint ──────
  const onMedsChange = useCallback(
    (next: Medication[]) => {
      const before = fields.medications_list || [];
      if (next.length < before.length) {
        const nextNames = new Set(next.map((m) => m.inn));
        const removed = before.find((b) => !nextNames.has(b.inn));
        if (removed) setLastRemovedMedName(removed.inn);
      }
      updateField('medications_list', next);
    },
    [fields.medications_list, updateField]
  );

  // ── Safety alerts (derived from fields) ──────────────────────
  // Merge backend Claude-generated alerts (preferred — context-aware, with
  // reason + action) with frontend regex alerts (safety net for cases the
  // backend missed, e.g. drug-name typos). See lib/drug-safety.ts.
  const safetyAlerts = useMemo(
    () => mergeBackendAlerts(fields.med_alerts, fields),
    [fields]
  );
  const criticals = useMemo(
    () => safetyAlerts.filter((a) => a.severity === 'critical'),
    [safetyAlerts]
  );
  const warnings = useMemo(
    () => safetyAlerts.filter((a) => a.severity === 'warning'),
    [safetyAlerts]
  );
  // #47 — one chip per distinct issue: identical entries collapse with a „×N"
  // badge. The raw arrays above keep feeding the meds-panel row flags.
  const criticalGroups = useMemo(() => groupAlerts(criticals), [criticals]);
  const warningGroups = useMemo(() => groupAlerts(warnings), [warnings]);

  // ── Vital-sign review counter ─────────────────────────────────
  // Scan the free-text clinical fields for highlights (vitals out of range
  // + uncertain transcription markers). Each entry: span + field key.
  // Acknowledged spans (doctor clicked "Потвърди") are filtered out so the
  // counter reflects only items still needing review.
  const [acknowledged, setAcknowledged] = useState<Set<string>>(
    () => new Set()
  );

  const acknowledgeSpan = useCallback(
    (fieldKey: string, raw: string) => {
      setAcknowledged((prev) => {
        const next = new Set(prev);
        next.add(`${fieldKey}::${raw}`);
        return next;
      });
    },
    []
  );

  // A2 — acknowledge an AI-uncertainty span. The `unc::` key namespace is
  // distinct from the vital `${fieldKey}::${raw}` keys, so the two counters
  // never collide in the shared `acknowledged` Set.
  const acknowledgeUncertain = useCallback(
    (field: string, original: string) => {
      setAcknowledged((prev) => {
        const next = new Set(prev);
        next.add(uncertainAckKey(field, original));
        return next;
      });
    },
    []
  );

  // Resolve backend uncertain_spans against the CURRENT fields (indexOf
  // re-location, stale-drop, acknowledged-drop, mkb_review de-dup), then bucket
  // by field for the inline render surfaces. Advisory only — surfaced + counted,
  // never a new approval gate (the diagnosis is hard-gated via mkb_review).
  const uncertainByField = useMemo(() => {
    const resolved = resolveUncertainSpans(fields, acknowledged);
    const map: Record<string, ResolvedUncertainSpan[]> = {};
    for (const f of UNCERTAIN_FIELDS) map[f] = [];
    for (const s of resolved) {
      if (map[s.field]) map[s.field].push(s);
    }
    return map;
  }, [fields, acknowledged]);

  // Per-field source state (trust Batch B): does the field have backend-resolved,
  // bounds-valid offsets? Drives the SourceButton label — „виж източника" vs the
  // honest „няма ясен източник" — BEFORE any click. anamneza and legacy rows are
  // always unresolved (narrative fields are never sourced; old rows lack the key).
  const sourceResolvedByField = useMemo(() => {
    const len = (original?.transcript || '').length;
    const map: Record<string, boolean> = {};
    for (const k of ['anamneza', 'obektivno', 'izsledvania', 'naznacheni', 'terapia', 'napravlenia', 'osnovna_diagnoza']) {
      map[k] = storedSpanFor(k, fields.field_sources, len) !== null;
    }
    return map;
  }, [fields.field_sources, original]);

  const reviewItems = useMemo(() => {
    // Unified review counter: vital-range / transcription highlights AND
    // AI-uncertainty spans, in one "N за преглед" surface. Each item carries a
    // reviewKind so goToNextReview targets the right DOM id prefix.
    type ReviewItem = {
      fieldKey: string;
      localIdx: number;
      reviewKind: 'vital' | 'uncertain';
    };
    const items: ReviewItem[] = [];

    // (1) Vital-range + [[...]] transcription highlights (existing) — 4 fields.
    const fieldsToScan: Array<keyof TranscribeFields> = [
      'anamneza',
      'obektivno',
      'izsledvania',
      'terapia',
    ];
    for (const fk of fieldsToScan) {
      const text = (fields[fk] as string) || '';
      const matches = findHighlights(text);
      // Match EditableField's filter: skip acknowledged. localIdx counts only
      // visible (non-acknowledged) matches so DOM ids (vital-<fk>-<i>) line up.
      let visibleIdx = 0;
      for (const m of matches) {
        if (acknowledged.has(`${String(fk)}::${m.raw}`)) continue;
        items.push({ fieldKey: String(fk), localIdx: visibleIdx, reviewKind: 'vital' });
        visibleIdx++;
      }
    }

    // (2) AI-uncertainty spans (A2) — superset of fields. Already resolved +
    // acknowledged-filtered; localIdx = index within the field's resolved list
    // so DOM ids (uncertain-<fk>-<j>) line up with EditableField.
    for (const fk of UNCERTAIN_FIELDS) {
      const spans = uncertainByField[fk] || [];
      for (let j = 0; j < spans.length; j++) {
        items.push({ fieldKey: fk, localIdx: j, reviewKind: 'uncertain' });
      }
    }

    return items;
  }, [
    fields.anamneza,
    fields.obektivno,
    fields.izsledvania,
    fields.terapia,
    acknowledged,
    uncertainByField,
  ]);

  const [reviewCursor, setReviewCursor] = useState(0);

  // Clamp cursor when the items list shrinks (e.g. doctor edited out a vital)
  useEffect(() => {
    if (reviewCursor >= reviewItems.length && reviewItems.length > 0) {
      setReviewCursor(0);
    }
  }, [reviewItems.length, reviewCursor]);

  const goToNextReview = useCallback(() => {
    if (reviewItems.length === 0) return;
    const idx = reviewCursor % reviewItems.length;
    const item = reviewItems[idx];
    const prefix = item.reviewKind === 'uncertain' ? 'uncertain' : 'vital';
    const spanId = `${prefix}-${item.fieldKey}-${item.localIdx}`;
    const el = document.getElementById(spanId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('flash-review');
      setTimeout(() => el.classList.remove('flash-review'), 1500);
    } else {
      // Fallback — scroll to the section the span lives in
      const sectEl = document.getElementById(`sec-${item.fieldKey}`);
      if (sectEl)
        sectEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    setReviewCursor(idx + 1);
  }, [reviewItems, reviewCursor]);

  // Auto-dismiss therapy hint when name no longer in terapia text
  useEffect(() => {
    if (!lastRemovedMedName) return;
    const text = (fields.terapia || '').toLowerCase();
    if (!text.includes(lastRemovedMedName.toLowerCase())) {
      setLastRemovedMedName(null);
    }
  }, [fields.terapia, lastRemovedMedName]);

  // ── Navigation: click to scroll ──────────────────────────────
  // Pin the clicked section while the programmatic smooth scroll is in
  // flight: the IntersectionObserver below keeps firing for sections passing
  // through its band, and without the pin the LAST section to enter (the one
  // just below the target) stole the highlight — every downward nav click
  // ended up marking the NEXT section (off-by-one). The pin also keeps
  // bottom-of-document targets highlighted when the scroll clamps short of
  // bringing them into the band. Manual scrolling resumes tracking on expiry.
  const navPinUntilRef = useRef(0);
  const NAV_PIN_MS = 1000; // > Chrome's smooth-scroll duration for this page

  const navTo = useCallback((item: NavItem) => {
    setActiveNav(item.id);
    navPinUntilRef.current = performance.now() + NAV_PIN_MS;
    if (item.scrollMode === 'top') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    const el = document.getElementById(item.id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  // ── Active-section observer (sync on scroll) ─────────────────
  useEffect(() => {
    if (!original) return;
    // Observer entries carry only targets whose intersection CHANGED, so the
    // active section must be derived from the full in-band set, not from the
    // latest batch — picking from the batch alone highlighted whichever
    // section crossed the band boundary last, not the topmost visible one.
    const inBand = new Set<Element>();
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) inBand.add(e.target);
          else inBand.delete(e.target);
        });
        if (performance.now() < navPinUntilRef.current) return; // nav-click pin
        let topEl: Element | null = null;
        let topY = Infinity;
        inBand.forEach((el) => {
          if (!el.isConnected) {
            inBand.delete(el);
            return;
          }
          const y = el.getBoundingClientRect().top;
          if (y < topY) {
            topY = y;
            topEl = el;
          }
        });
        if (topEl) setActiveNav((topEl as Element).id);
      },
      { rootMargin: '-120px 0px -60% 0px', threshold: 0 }
    );
    NAV_ITEMS.forEach((item) => {
      if (item.scrollMode === 'top') return;
      const el = document.getElementById(item.id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [original, fields.napravlenia, fields.naznacheni]);

  // ── Review status flow ───────────────────────────────────────
  // `confirmReview` is defined below, AFTER `showToast`, because it needs
  // `showToast` in its dep array — declaring it here would hit `const`
  // TDZ when React evaluates the deps. See definition below the toast helper.
  // Double-click guard ref lives here so the type narrows above the consumer.
  const approvingRef = useRef(false);

  // ── MKB picker handlers ──────────────────────────────────────
  const openMkbPicker = useCallback((target: MkbTarget) => {
    setMkbTarget(target);
    setMkbOpen(true);
  }, []);

  const closeMkbPicker = useCallback(() => {
    setMkbOpen(false);
    setMkbTarget(null);
  }, []);

  // Always overwrite both code AND diagnosis name when picking from MKB.
  // This makes the picker the source of truth — picking a different code
  // means you wanted to change the diagnosis, not keep stale text.
  // Apply a picked МКБ entry (inline typeahead OR full-browse modal) → set the
  // code + official term together. The doctor's spoken osnovna_diagnoza is left
  // UNTOUCHED (it stays the immutable "доктор каза" source); display + export
  // derive the official term from osnovna_mkb_term. Deterministic, no API.
  const applyMkbPick = useCallback(
    (target: MkbTarget, code: string, term: string) => {
      if (target.kind === 'osnovna') {
        const charsChanged = computeCharsChanged('osnovna_mkb', code);
        const rec = clientMkbReview(code);
        setFields((prev) => {
          // The client cannot re-evaluate grounding (no transcript). A grounding
          // flag (diagnosis_text_not_grounded) must NOT be cleared by a code pick —
          // picking a valid code does not make the diagnosis grounded. Only a
          // code-level problem (missing/invalid) is client-evaluable; otherwise keep
          // the flag and let the server's /edit response clear it authoritatively
          // (defer to the server — never invent a client-side "now grounded").
          const wasGrounding = prev.mkb_review?.reason === 'diagnosis_text_not_grounded';
          const codeProblem = rec ? rec.mkb_review.needs_review : false;
          const keepGrounding = wasGrounding && !codeProblem;
          return {
            ...prev,
            osnovna_mkb: code,
            ...(rec
              ? {
                  mkb_review:              keepGrounding ? prev.mkb_review : rec.mkb_review,
                  osnovna_mkb_term:        rec.osnovna_mkb_term,
                  osnovna_mkb_term_source: rec.osnovna_mkb_term_source,
                }
              : {
                  mkb_review:              keepGrounding ? prev.mkb_review : { needs_review: false },
                  osnovna_mkb_term:        term,
                }),
          };
        });
        trackEdit('osnovna_mkb', charsChanged);
      } else if (target.kind === 'co-add') {
        // Search-first add: the picker selection creates a new comorbidity row.
        addComorbidity(code, term);
      } else {
        const idx = target.index;
        const nextList = (fields.pridruzhavashti || []).map((d, i) =>
          i === idx ? { ...d, mkb: code, diagnoza: term, mkb_term: term } : d
        );
        const charsChanged = computeCharsChanged('pridruzhavashti', nextList);
        setFields((prev) => ({
          ...prev,
          pridruzhavashti: (prev.pridruzhavashti || []).map((d, i) =>
            i === idx ? { ...d, mkb: code, diagnoza: term, mkb_term: term } : d
          ),
        }));
        trackEdit('pridruzhavashti', charsChanged);
      }
    },
    [trackEdit, computeCharsChanged, fields.pridruzhavashti, addComorbidity]
  );

  // Modal (full-browse) pick → routes through the same apply path via mkbTarget.
  const pickMkb = useCallback(
    (code: string, term: string) => {
      if (mkbTarget) applyMkbPick(mkbTarget, code, term);
    },
    [mkbTarget, applyMkbPick]
  );

  // ── Toast helper ─────────────────────────────────────────────
  const showToast = useCallback((kind: ToastKind, message: string) => {
    toastIdRef.current += 1;
    setToast({ kind, message, id: toastIdRef.current });
  }, []);

  // ── Per-field source grounding (Traceability Phase 1a) ────────
  // Find where the clicked field came from in the RAW transcript, open the
  // transcript, and highlight + scroll to that span. Empty transcript →
  // "unavailable" (the button is already disabled in that case); no confident
  // match → open the transcript so the doctor can scan it manually. Frontend-only
  // and read-only: this NEVER flags the field as wrong.
  const showSource = useCallback(
    (fieldKey: string, value: string) => {
      if (!original) return;
      const transcript = original.transcript || '';
      if (!transcript.trim()) {
        showToast('error', 'Източникът не е наличен — транскриптът липсва.');
        return;
      }
      setTranscriptOpen(true);
      // Primary path: backend-resolved offsets (fields.field_sources), read
      // from fieldsRef so the in-session /edit round-trip is always current.
      // Bounds-validated against THIS transcript. Not resolved → the honest
      // „няма ясен източник" banner; the alias-bridge runs ONLY via its
      // explicit „Покажи предположение" opt-in (showGuess below).
      const stored = storedSpanFor(fieldKey, fieldsRef.current?.field_sources, transcript.length);
      if (stored) {
        setSourceMode('stored');
        setActiveSourceField(null);
        setSourceSpan(stored);
      } else {
        setSourceMode(null);
        setActiveSourceField({ fieldKey, value });
        setSourceSpan(null);
      }
      setSourceTick((n) => n + 1);
    },
    [original, showToast]
  );

  // The explicit opt-in: run the alias-bridge GUESS for the active unresolved
  // field. A hit renders in the tentative dashed style; a miss keeps the
  // banner and says so. Never invoked implicitly.
  const showGuess = useCallback(() => {
    if (!original || !activeSourceField) return;
    const transcript = original.transcript || '';
    const span = findSourceSpan(activeSourceField.fieldKey, activeSourceField.value, transcript);
    if (span) {
      setSourceMode('guess');
      setSourceSpan(span);
      setSourceTick((n) => n + 1);
    } else {
      showToast('info', 'Не открихме ясен източник — проверете ръчно.');
    }
  }, [original, activeSourceField, showToast]);

  // Scroll to the highlighted source span (or the transcript block when there's
  // no clear match) after each "виж източника" click. Keyed on sourceTick so a
  // repeat click on the same field re-scrolls.
  useEffect(() => {
    if (sourceTick === 0) return;
    const el = document.getElementById(sourceSpan ? 'source-mark' : 'transcript-block');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: sourceSpan ? 'center' : 'start' });
    }
  }, [sourceTick, sourceSpan]);

  // ── Review confirmation (server-persisted) ────────────────────
  // The doctor's approval MUST persist server-side before the UI unlocks —
  // POST /:id/export hard-gates on note_approved=true. Until the approve
  // call returns ok we keep reviewStatus !== 'confirmed' so isLocked stays
  // true and the popup stays open, mirroring the server's view of the row.
  // approvingRef guards against double-click firing the request twice or
  // optimistic unlocking on the second click.
  const confirmReview = useCallback(async () => {
    if (!original) return;
    if (approvingRef.current) return;
    if (reviewStatus === 'confirmed') return;
    // МКБ gate — never attempt approval while the code block stands.
    if (fieldsRef.current.mkb_review?.needs_review) {
      showToast('error', mkbBlockMessage(fieldsRef.current.mkb_review));
      setReviewPopupOpen(false);
      return;
    }
    approvingRef.current = true;
    try {
      await api.approveConsultation(original.consultationId);
      setReviewStatus('confirmed');
      setReviewPopupOpen(false);
    } catch (err) {
      // Server backstop: 409 mkb_review_required means the code is invalid/missing
      // server-side — surface it so the reconcile prompt appears + the gate holds.
      if (
        err instanceof ApiError &&
        err.status === 409 &&
        err.body && typeof err.body === 'object' &&
        (err.body as { code?: string }).code === 'mkb_review_required'
      ) {
        const b = err.body as { reason?: MkbReview['reason']; mkb?: string };
        setFields((prev) => ({
          ...prev,
          mkb_review: { needs_review: true, reason: b.reason, code: b.mkb },
        }));
        showToast('error', err.message);
        setReviewPopupOpen(false);
      } else {
        showToast(
          'error',
          'Грешка при потвърждаване: ' +
            (err instanceof Error ? err.message : 'неизвестна'),
        );
      }
      // Intentionally NOT flipping reviewStatus — the doctor stays locked until
      // the approval persists on the server.
    } finally {
      approvingRef.current = false;
    }
  }, [original, reviewStatus, showToast]);

  // ── Article-17 erasure („изтриване при поискване") ──────────────────────
  // IRREVERSIBLE scrub-in-place of the note's clinical content. Not a delete:
  // the record skeleton and the consent/approval timestamps survive as the
  // practice's proof that the visit happened and was authorised.
  //
  // A SEALED note is still erasable — sealing decides whether the лист can
  // still be CHANGED; it must never stand between a data subject and their
  // right. Nothing here consults isSealed, and the backend doesn't either.
  const eraseInFlightRef = useRef(false);
  const runErase = useCallback(async () => {
    if (!original || eraseInFlightRef.current) return;
    eraseInFlightRef.current = true;
    setErasing(true);
    try {
      const resp = await api.eraseConsultation(original.consultationId);
      // Adopt the erased state in place rather than navigating away: the doctor
      // asked for this and deserves to see it took effect on the лист they were
      // looking at. The note body empties; the row skeleton stays.
      setErasedAt(resp.erased_at ?? new Date().toISOString());
      setFields({});
      setEraseConfirmOpen(false);
      showToast('success', 'Съдържанието на листа е изтрито по заявка.');
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // 'retrying' — a re-extraction is in flight and would re-populate the
        // note AFTER the scrub. Transient (the 15-min sweeper bounds it), so
        // this is a „try again", never a failure.
        showToast('error', 'Листът се обработва в момента — опитайте пак след минута.');
      } else {
        showToast(
          'error',
          'Изтриването не бе изпълнено: ' + (err instanceof Error ? err.message : 'неизвестна грешка'),
        );
      }
    } finally {
      eraseInFlightRef.current = false;
      setErasing(false);
    }
  }, [original, showToast]);

  // Shared callback for per-section CopyButtons — reuses the same Bulgarian
  // strings as the topbar full-document copy so the affordance feels uniform.
  const notifyCopy = useCallback(
    (ok: boolean) => {
      showToast(
        ok ? 'success' : 'error',
        ok ? 'Копирано в клипборда' : 'Копирането не е възможно в този браузър'
      );
    },
    [showToast]
  );

  // Build the rollup payload from the live accumulators and POST it to
  // /api/consultations/:id/export. Idempotent on this page — exportSignalledRef
  // guards repeated invocations so PDF then Word in the same session doesn't
  // double-count. The actual document generation stays purely client-side;
  // this call only records the lifecycle signal + persists the rollup.
  const signalExport = useCallback(
    (format: ExportSignalPayload['format']) => {
      if (!original || exportSignalledRef.current) return;
      exportSignalledRef.current = true;
      // Sum the per-field char deltas captured in editedFieldsRef.
      let totalChars = 0;
      for (const n of editedFieldsRef.current.values()) totalChars += n;
      const payload: ExportSignalPayload = {
        format,
        total_chars_edited:  totalChars,
        fields_edited_count: editedFieldsRef.current.size,
      };
      api.exportConsultation(original.consultationId, payload).catch((err) => {
        if (err instanceof ApiError) {
          console.warn('[export-signal] ' + err.status + ' ' + err.message);
        }
      });
    },
    [original]
  );

  // ── Export handlers ──────────────────────────────────────────
  const handleCopy = useCallback(async () => {
    if (isLocked) return;
    const text = formatPlainText(fields);
    const ok = await copyToClipboard(text);
    if (ok) {
      showToast('success', 'Копирано в клипборда');
      signalExport('copy');
    } else {
      showToast('error', 'Копирането не е възможно в този браузър');
    }
  }, [fields, isLocked, showToast, signalExport]);

  // ── Echo exporters (note_type='echo') ────────────────────────
  // The Изследвания→Резултати paste block + a clean report for print/PDF. Same
  // approval gate (isLocked) + export signal as the консултація path.
  const handleEchoCopy = useCallback(async () => {
    if (isLocked) return;
    const text = formatEchoPlainText(fields as unknown as EchoFields);
    const ok = await copyToClipboard(text);
    if (ok) {
      showToast('success', 'Копирано в клипборда');
      signalExport('copy');
    } else {
      showToast('error', 'Копирането не е възможно в този браузър');
    }
  }, [fields, isLocked, showToast, signalExport]);

  const handleEchoPdf = useCallback(() => {
    if (isLocked) return;
    const dateStr = new Date().toLocaleDateString('bg-BG', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const html = generateEchoHtml(fields as unknown as EchoFields, dateStr);
    if (openPdfPreview(html)) {
      showToast('success', 'Преглед отворен — Запази като PDF от бутона');
      signalExport('pdf');
    } else {
      showToast('error', 'Изскачащият прозорец е блокиран — разрешете го за този сайт');
    }
  }, [fields, isLocked, showToast, signalExport]);

  const handleEchoPrint = useCallback(() => {
    if (isLocked) return;
    const dateStr = new Date().toLocaleDateString('bg-BG', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const html = generateEchoHtml(fields as unknown as EchoFields, dateStr);
    if (openPdfPreview(html, { autoPrint: true })) {
      signalExport('print');
    } else {
      showToast('error', 'Изскачащият прозорец е блокиран — разрешете го за този сайт');
    }
  }, [fields, isLocked, showToast, signalExport]);

  const handlePdf = useCallback(() => {
    if (isLocked) return;
    const dateStr = new Date().toLocaleDateString('bg-BG', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
    const html = generatePdfHtml(fields, dateStr, exportIdentity);
    const opened = openPdfPreview(html);
    if (opened) {
      showToast('success', 'Преглед отворен — Запази като PDF от бутона');
      signalExport('pdf');
    } else {
      showToast(
        'error',
        'Изскачащият прозорец е блокиран — разрешете го за този сайт'
      );
    }
  }, [fields, isLocked, showToast, signalExport, exportIdentity]);

  const handleWord = useCallback(() => {
    if (isLocked) return;
    const dateStr = new Date().toLocaleDateString('bg-BG', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
    const html = generateWordHtml(fields, dateStr, exportIdentity);
    const filename =
      'ambulatoren-list-' +
      new Date().toISOString().slice(0, 10) +
      '.doc';
    try {
      downloadWord(html, filename);
      showToast('success', 'Word файлът е свален');
      signalExport('docx');
    } catch {
      showToast('error', 'Грешка при генериране на Word файла');
    }
  }, [fields, isLocked, showToast, signalExport, exportIdentity]);

  const handlePrint = useCallback(() => {
    if (isLocked) return;
    const dateStr = new Date().toLocaleDateString('bg-BG', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
    const html = generatePdfHtml(fields, dateStr, exportIdentity);
    const opened = openPdfPreview(html, { autoPrint: true });
    if (opened) {
      signalExport('print');
    } else {
      showToast(
        'error',
        'Изскачащият прозорец е блокиран — разрешете го за този сайт'
      );
    }
  }, [fields, isLocked, showToast, signalExport, exportIdentity]);

  // ── Visible-section bookkeeping ──────────────────────────────
  const visibleSections = useMemo(() => {
    const v: Record<string, boolean> = {};
    v['sec-diag'] = true;
    v['sec-anamneza'] = true;
    v['sec-obektivno'] = true;
    v['sec-izsledvania'] = true;
    v['sec-terapia'] = true;
    v['sec-meds-panel'] = true;
    // Изследвания now parents two conditional subsections: results
    // (izsledvania) + ordered tests (naznacheni, moved out of Издадени
    // документи). The parent stays always-visible — it carries an empty state.
    const hasIzs = !!(fields.izsledvania && fields.izsledvania.trim());
    const hasNap = !!(fields.napravlenia && fields.napravlenia.trim());
    const hasNaz = !!(fields.naznacheni && fields.naznacheni.trim());
    v['sec-rezultati'] = hasIzs;
    v['sec-naznacheni'] = hasNaz;
    // Издадени документи is documents-only now — keyed on направления alone.
    v['sec-izdadeni'] = hasNap;
    v['sec-napravlenia'] = hasNap;
    return v;
  }, [fields.izsledvania, fields.napravlenia, fields.naznacheni]);

  if (!doctor || !original) {
    // Same note-shaped skeleton as the Suspense fallback — this is the wait the
    // doctor actually sees after recording (bootstrap / recovery / reconcile).
    return <BootSplash />;
  }

  // Source-grounding affordance is disabled when there's no transcript to point
  // at (cold-start recovery omits the transcript by design).
  const hasTranscript = !!(original.transcript && original.transcript.trim());

  const todayBg = new Date().toLocaleDateString('bg-BG', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  // Document-type branch. note_type rides on the PendingVisit (set at staging,
  // rebuilt from the backend on cold-start recovery). Echo has a different JSONB
  // shape, NO diagnosis/МКБ UI, and no meds/drug-safety rail.
  const isEcho = pendingVisit?.visit_metadata.note_type === 'echo';
  const echoFields = fields as unknown as EchoFields;

  return (
    <AppShell doctor={doctor}>
      <Stepper steps={SCRIBE_FLOW_STEPS} current={3} />

      {pendingVisit && <VisitHeaderStrip pending={pendingVisit} />}

      {/* Critical safety banner — full width */}
      {criticals.length > 0 && (
        <div
          className="px-6 py-4 border-b no-print"
          style={{ background: 'var(--color-danger-soft)', borderColor: 'var(--color-danger)' }}
        >
          <div className="max-w-6xl mx-auto">
            <div
              className="text-sm font-bold uppercase tracking-wider mb-2 flex items-center gap-2"
              style={{ color: 'var(--color-red)' }}
            >
              <Icon name="alert-octagon" /> Внимание — Проверка за безопасност
            </div>
            <div className="space-y-2">
              {criticalGroups.map((g, i) => (
                <CriticalChip key={i} alert={g.alert} count={g.count} />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Article-17 erased state. Sits ABOVE the action bar because it explains
          the whole page: without it, a scrubbed лист is just a blank form and
          the doctor is left wondering whether something failed. Names the
          erasure, dates it, and says what survived. */}
      {isErased && (
        <div
          className="px-6 py-3 border-b"
          style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}
        >
          <div className="max-w-6xl mx-auto">
            <div
              className="text-sm font-semibold flex items-center gap-2 mb-1"
              style={{ color: 'var(--color-text-muted)' }}
            >
              <Icon name="alert-triangle" /> Съдържанието е изтрито по заявка
              {erasedAt && <span className="font-normal">· {formatSealedAt(erasedAt)}</span>}
            </div>
            <div className="text-xs leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
              Клиничният текст и транскрипцията са премахнати необратимо. Записът
              за прегледа — дата, вид на посещението и отметките за съгласие и
              потвърждение — остава.
            </div>
          </div>
        </div>
      )}

      {/* Top action bar */}
      <div
        className="px-6 py-3 border-b flex items-center justify-between gap-4 flex-wrap no-print"
        style={{
          background: 'var(--color-bg-card)',
          borderColor: 'var(--color-border)',
        }}
      >
        <StatusBadge
          status={reviewStatus}
          popupOpen={reviewPopupOpen}
          onClick={() => setReviewPopupOpen((o) => !o)}
          onConfirm={confirmReview}
          onDismiss={() => setReviewPopupOpen(false)}
          blocked={!!fields.mkb_review?.needs_review}
          blockHint={
            fields.mkb_review?.needs_review
              ? mkbBlockMessage(fields.mkb_review)
              : undefined
          }
          sealedAt={sealedAt}
        />
        {reviewItems.length > 0 && !isErased && (
          <ReviewCounter
            total={reviewItems.length}
            cursor={reviewCursor}
            onNext={goToNextReview}
          />
        )}
        {/* Export bar branches on document type: консултація exporters
            (PDF/Word/Копирай/Печат/Резюме) vs the echo paste-block exporters
            below. Approval (StatusBadge) is shared. */}
        {!isEcho && (
        <div className="flex items-center gap-2">
          <Button
            variant="toolbar"
            onClick={handlePdf}
            disabled={isLocked}
            title={isLocked ? 'Първо потвърдете прегледа' : undefined}
          >
            {isLocked && <Icon name="lock" />}
            <Icon name="download" />
            PDF
          </Button>
          <Button
            variant="toolbar"
            onClick={handleWord}
            disabled={isLocked}
            title={isLocked ? 'Първо потвърдете прегледа' : undefined}
          >
            {isLocked && <Icon name="lock" />}
            <Icon name="download" />
            Word
          </Button>
          <Button
            variant="toolbar"
            onClick={handleCopy}
            disabled={isLocked}
            title={isLocked ? 'Първо потвърдете прегледа' : undefined}
          >
            {isLocked && <Icon name="lock" />}
            <Icon name="copy" />
            Копирай
          </Button>
          <Button
            variant="toolbar"
            onClick={handlePrint}
            disabled={isLocked}
            title={isLocked ? 'Първо потвърдете прегледа' : undefined}
          >
            {isLocked && <Icon name="lock" />}
            <Icon name="printer" />
            Печат
          </Button>
          <Button
            variant="toolbar"
            onClick={() => setSummaryOpen(true)}
            disabled={isLocked}
            title={isLocked ? 'Първо потвърдете прегледа' : undefined}
          >
            {isLocked && <Icon name="lock" />}
            <Icon name="file-text" />
            Резюме за пациента
          </Button>
        </div>
        )}
        {isEcho && (
        <div className="flex items-center gap-2">
          <Button
            variant="toolbar"
            onClick={handleEchoPdf}
            disabled={isLocked}
            title={isLocked ? 'Първо потвърдете прегледа' : undefined}
          >
            {isLocked && <Icon name="lock" />}
            <Icon name="download" />
            PDF
          </Button>
          <Button
            variant="toolbar"
            onClick={handleEchoCopy}
            disabled={isLocked}
            title={isLocked ? 'Първо потвърдете прегледа' : undefined}
          >
            {isLocked && <Icon name="lock" />}
            <Icon name="copy" />
            Копирай
          </Button>
          <Button
            variant="toolbar"
            onClick={handleEchoPrint}
            disabled={isLocked}
            title={isLocked ? 'Първо потвърдете прегледа' : undefined}
          >
            {isLocked && <Icon name="lock" />}
            <Icon name="printer" />
            Печат
          </Button>
        </div>
        )}
      </div>

      {/* 3-column grid */}
      <div className="result-grid flex-1">
        {/* ─── Left: section nav ─── */}
        <aside className="no-print">
          {/* Консултація section nav — echo has its own section flow inside
              EchoNoteView, so the left rail is empty on that path. */}
          {!isEcho && (
          <div className="sticky top-[88px]">
            <div
              className="text-xs uppercase tracking-wider mb-3 font-medium"
              style={{ color: 'var(--color-text-muted)' }}
            >
              Раздели
            </div>
            <nav className="flex flex-col gap-0.5">
              {NAV_ITEMS.map((item) => {
                if (!visibleSections[item.id]) return null;
                const isActive = activeNav === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => navTo(item)}
                    className="text-left py-1.5 transition-colors"
                    style={{
                      paddingLeft: item.indent ? '24px' : '12px',
                      fontSize: item.indent ? '13px' : '14px',
                      color: isActive
                        ? 'var(--color-brand)'
                        : 'var(--color-text-muted)',
                      fontWeight: isActive ? 600 : 500,
                      // Calm-clinical: an accent LEFT-BAR marks the active section
                      // (no box / no pill). Inactive keeps a transparent bar so the
                      // label never shifts horizontally between states.
                      borderLeft: `2px solid ${
                        isActive ? 'var(--color-accent)' : 'transparent'
                      }`,
                    }}
                  >
                    {item.label}
                  </button>
                );
              })}
            </nav>

            <div
              className="mt-6 pt-4 border-t"
              style={{ borderColor: 'var(--color-border)' }}
            >
              <div
                className="text-xs uppercase tracking-wider mb-2 font-medium"
                style={{ color: 'var(--color-text-muted)' }}
              >
                Шаблон
              </div>
              <select
                className="w-full px-2 py-1.5 rounded text-sm border"
                style={{
                  borderColor: 'var(--color-border-mid)',
                  background: 'white',
                }}
                disabled
                defaultValue="общ"
              >
                <option value="общ">Общ преглед — SOAP</option>
                <option value="кардио">Кардиологичен SOAP</option>
                <option value="пед">Педиатричен преглед</option>
              </select>
            </div>
          </div>
          )}
        </aside>

        {/* ─── Center: document ─── */}
        <main className="min-w-0">
          {/* Transcript collapsible */}
          <details
            id="transcript-block"
            className="mb-4 no-print"
            open={transcriptOpen}
            onToggle={(e) => {
              const open = (e.currentTarget as HTMLDetailsElement).open;
              setTranscriptOpen(open);
              // Closing the panel ends the source session — no stale banner or
              // guess highlight on the next open.
              if (!open) {
                setSourceMode(null);
                setActiveSourceField(null);
                setSourceSpan(null);
              }
            }}
          >
            <summary
              className="cursor-pointer text-sm font-medium px-3 py-2 rounded-md inline-block"
              style={{
                background: 'var(--color-bg-card)',
                color: 'var(--color-text-muted)',
                borderColor: 'var(--color-border)',
                borderWidth: 1,
              }}
            >
              Транскрипт на консултацията
            </summary>
            <div
              className="mt-2 p-4 rounded-md text-sm leading-relaxed whitespace-pre-wrap"
              style={{
                background: 'var(--color-bg-card)',
                color: 'var(--color-text-muted)',
                borderColor: 'var(--color-border)',
                borderWidth: 1,
              }}
            >
              {/* Honest no-source state (trust Batch B): persistent banner, not
                  a transient toast. The alias-bridge guess runs ONLY via the
                  explicit button — never silently. */}
              {activeSourceField && (
                <div
                  className="mb-3 p-3 rounded-md flex items-center flex-wrap gap-3 text-sm"
                  style={{
                    background: 'var(--color-bg)',
                    border: '1px solid var(--color-border)',
                    color: 'var(--color-text)',
                  }}
                >
                  <span>Няма ясен източник за това поле в транскрипта.</span>
                  {sourceMode === 'guess' ? (
                    <span
                      className="text-xs px-1.5 py-0.5 rounded"
                      style={{
                        border: '1px dashed var(--color-brand)',
                        color: 'var(--color-brand)',
                      }}
                    >
                      предположение
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={showGuess}
                      className="text-xs underline decoration-dotted underline-offset-2 transition hover:opacity-80"
                      style={{ color: 'var(--color-brand)', background: 'transparent' }}
                    >
                      Покажи предположение
                    </button>
                  )}
                </div>
              )}
              <TranscriptBody
                transcript={original.transcript}
                span={sourceSpan}
                variant={sourceMode === 'guess' ? 'guess' : 'stored'}
              />
            </div>
          </details>

          {/* Document — ONE calm sheet: sections inside read via label + hairline,
              NOT per-section boxes. Elevation stays RESERVED for the safety rail. */}
          <div
            className="bg-white rounded-2xl border p-6 sm:p-8"
            style={{ borderColor: 'var(--color-border)' }}
          >
          <div className="flex items-baseline justify-between flex-wrap gap-4 mb-6">
            <h1
              className="text-3xl font-semibold"
              style={{ color: 'var(--color-ink)', letterSpacing: '-0.01em' }}
            >
              {isEcho ? 'Ехокардиографско изследване' : 'Амбулаторен лист'}
            </h1>
            <div
              className="text-sm tabular-nums"
              style={{ color: 'var(--color-text-muted)' }}
            >
              {todayBg}
            </div>
          </div>

          <div className="space-y-8">
            {isEcho ? (
              <EchoNoteView
                fields={echoFields}
                onEditText={updateEchoText}
                onEditMeasurement={updateEchoMeasurement}
                sealed={bodyReadOnly}
              />
            ) : (
            <>
            <DiagnosesSection
              osnovnaDiagnoza={fields.osnovna_diagnoza || ''}
              osnovnaMkb={fields.osnovna_mkb || ''}
              osnovnaMkbTerm={fields.osnovna_mkb_term}
              termSource={fields.osnovna_mkb_term_source}
              mkbReview={fields.mkb_review}
              originalSpoken={original?.fields.osnovna_diagnoza}
              pridruzhavashti={fields.pridruzhavashti || []}
              onOsnovnaPick={(code, term) => applyMkbPick({ kind: 'osnovna' }, code, term)}
              onOsnovnaBrowse={() => openMkbPicker({ kind: 'osnovna' })}
              onComorbidityPick={(i, code, term) => applyMkbPick({ kind: 'co', index: i }, code, term)}
              onComorbidityBrowse={(i) => openMkbPicker({ kind: 'co', index: i })}
              onComorbidityAddBrowse={() => openMkbPicker({ kind: 'co-add' })}
              onComorbidityRemove={removeComorbidity}
              sealed={bodyReadOnly}
              onShowSource={() =>
                showSource(
                  'osnovna_diagnoza',
                  original.fields.osnovna_diagnoza?.trim() ||
                    fields.osnovna_diagnoza?.trim() ||
                    fields.osnovna_mkb_term?.trim() ||
                    '',
                )
              }
              sourceDisabled={!hasTranscript}
              sourceResolved={sourceResolvedByField.osnovna_diagnoza}
              isLocked={isLocked}
              notifyCopy={notifyCopy}
            />

            <TextSection
              id="sec-anamneza"
              title="Анамнеза"
              icon="file-text"
              fieldKey="anamneza"
              value={fields.anamneza || ''}
              onChange={(v) => updateField('anamneza', v)}
              readOnly={bodyReadOnly}
              acknowledged={acknowledged}
              onAcknowledge={(raw) => acknowledgeSpan('anamneza', raw)}
              uncertainSpans={uncertainByField.anamneza}
              onAcknowledgeUncertain={(orig) => acknowledgeUncertain('anamneza', orig)}
              headerRight={
                <>
                  {uncertainByField.anamneza.length > 0 && <SourceStateBadge />}
                  <SourceButton
                    onClick={() => showSource('anamneza', fields.anamneza || '')}
                    disabled={!hasTranscript}
                    resolved={sourceResolvedByField.anamneza}
                  />
                  <CopyButton
                    text={fields.anamneza || ''}
                    disabled={isLocked}
                    onResult={notifyCopy}
                  />
                </>
              }
            />
            <TextSection
              id="sec-obektivno"
              title="Обективно състояние"
              icon="stethoscope"
              fieldKey="obektivno"
              value={fields.obektivno || ''}
              onChange={(v) => updateField('obektivno', v)}
              readOnly={bodyReadOnly}
              acknowledged={acknowledged}
              onAcknowledge={(raw) => acknowledgeSpan('obektivno', raw)}
              uncertainSpans={uncertainByField.obektivno}
              onAcknowledgeUncertain={(orig) => acknowledgeUncertain('obektivno', orig)}
              headerRight={
                <>
                  {uncertainByField.obektivno.length > 0 && <SourceStateBadge />}
                  <SourceButton
                    onClick={() => showSource('obektivno', fields.obektivno || '')}
                    disabled={!hasTranscript}
                    resolved={sourceResolvedByField.obektivno}
                  />
                  <CopyButton
                    text={fields.obektivno || ''}
                    disabled={isLocked}
                    onResult={notifyCopy}
                  />
                </>
              }
            />
            {visibleSections['sec-izsledvania'] && (
              <div id="sec-izsledvania" className="scroll-mt-24">
                <SectionHead
                  title="Изследвания"
                  icon="flask"
                  actions={
                    <CopyButton
                      text={izsledvaniaSectionText(fields)}
                      disabled={isLocked}
                      onResult={notifyCopy}
                    />
                  }
                />

                {/* Embedded investigation blocks (izsledvania_blocks) — one
                    titled card per block, ahead of the free-text remainder.
                    Absent on every row the backend emits today → this maps
                    over nothing and old rows render exactly as before.
                    Edits address `izsledvania_blocks.${i}.fields.${path}` and
                    flow through the same debounced /edit flush as every other
                    field (editing is never gated on isLocked — see the card). */}
                {Array.isArray(fields.izsledvania_blocks) &&
                  fields.izsledvania_blocks.length > 0 && (
                    <div className="mb-4 space-y-4">
                      {fields.izsledvania_blocks.map((b, i) => (
                        <InvestigationBlockCard
                          key={i}
                          block={b}
                          onEditText={(p, v) => updateBlockText(i, p, v)}
                          onEditMeasurement={(p, m) => updateBlockMeasurement(i, p, m)}
                          sealed={bodyReadOnly}
                        />
                      ))}
                    </div>
                  )}

                {visibleSections['sec-rezultati'] && (
                  <div id="sec-rezultati" className="mb-4 scroll-mt-24">
                    <div className="flex items-center justify-between gap-2">
                      <SubsectionHead title="Резултати от изследвания" />
                      <div className="flex items-center gap-2">
                        {uncertainByField.izsledvania.length > 0 && <SourceStateBadge />}
                        <SourceButton
                          onClick={() => showSource('izsledvania', fields.izsledvania || '')}
                          disabled={!hasTranscript}
                          resolved={sourceResolvedByField.izsledvania}
                        />
                      </div>
                    </div>
                    <EditableField
                      value={fields.izsledvania || ''}
                      onChange={(v) => updateField('izsledvania', v)}
                      fieldKey="izsledvania"
                      acknowledged={acknowledged}
                      onAcknowledge={(raw) => acknowledgeSpan('izsledvania', raw)}
                      uncertainSpans={uncertainByField.izsledvania}
                      onAcknowledgeUncertain={(orig) => acknowledgeUncertain('izsledvania', orig)}
                      readOnly={bodyReadOnly}
                    />
                  </div>
                )}

                {visibleSections['sec-naznacheni'] && (
                  <div id="sec-naznacheni" className="scroll-mt-24">
                    <div className="flex items-center justify-between gap-2">
                      <SubsectionHead icon="flask" title="Назначени изследвания" />
                      <div className="flex items-center gap-2">
                        {uncertainByField.naznacheni.length > 0 && <SourceStateBadge />}
                        <SourceButton
                          onClick={() => showSource('naznacheni', fields.naznacheni || '')}
                          disabled={!hasTranscript}
                          resolved={sourceResolvedByField.naznacheni}
                        />
                      </div>
                    </div>
                    <EditableField
                      value={fields.naznacheni || ''}
                      onChange={(v) => updateField('naznacheni', v)}
                      fieldKey="naznacheni"
                      highlightVitals={false}
                      uncertainSpans={uncertainByField.naznacheni}
                      onAcknowledgeUncertain={(orig) => acknowledgeUncertain('naznacheni', orig)}
                      readOnly={bodyReadOnly}
                    />
                  </div>
                )}

                {/* Empty-both fallback — preserves today's "Не е споменато"
                    behavior so the section is never a bare heading. */}
                {!visibleSections['sec-rezultati'] &&
                  !visibleSections['sec-naznacheni'] && (
                    <EditableField
                      value={fields.izsledvania || ''}
                      onChange={(v) => updateField('izsledvania', v)}
                      fieldKey="izsledvania"
                      acknowledged={acknowledged}
                      onAcknowledge={(raw) => acknowledgeSpan('izsledvania', raw)}
                      uncertainSpans={uncertainByField.izsledvania}
                      onAcknowledgeUncertain={(orig) => acknowledgeUncertain('izsledvania', orig)}
                      readOnly={bodyReadOnly}
                    />
                  )}
              </div>
            )}
            <TextSection
              id="sec-terapia"
              title="Терапия"
              icon="pill"
              fieldKey="terapia"
              value={fields.terapia || ''}
              onChange={(v) => updateField('terapia', v)}
              readOnly={bodyReadOnly}
              acknowledged={acknowledged}
              onAcknowledge={(raw) => acknowledgeSpan('terapia', raw)}
              uncertainSpans={uncertainByField.terapia}
              onAcknowledgeUncertain={(orig) => acknowledgeUncertain('terapia', orig)}
              headerRight={
                <>
                  {uncertainByField.terapia.length > 0 && <SourceStateBadge />}
                  <SourceButton
                    onClick={() => showSource('terapia', fields.terapia || '')}
                    disabled={!hasTranscript}
                    resolved={sourceResolvedByField.terapia}
                  />
                  <CopyButton
                    text={fields.terapia || ''}
                    disabled={isLocked}
                    onResult={notifyCopy}
                  />
                </>
              }
            />

            {visibleSections['sec-izdadeni'] && (
              <div id="sec-izdadeni" className="scroll-mt-24">
                <SectionHead
                  title="Издадени документи"
                  icon="file-text"
                  actions={
                    <CopyButton
                      text={izdadeniSectionText(fields)}
                      disabled={isLocked}
                      onResult={notifyCopy}
                    />
                  }
                />

                {visibleSections['sec-napravlenia'] && (
                  <div id="sec-napravlenia" className="scroll-mt-24">
                    <div className="flex items-center justify-between gap-2">
                      <SubsectionHead icon="clipboard" title="Направления за консултация" />
                      <div className="flex items-center gap-2">
                        {uncertainByField.napravlenia.length > 0 && <SourceStateBadge />}
                        <SourceButton
                          onClick={() => showSource('napravlenia', fields.napravlenia || '')}
                          disabled={!hasTranscript}
                          resolved={sourceResolvedByField.napravlenia}
                        />
                      </div>
                    </div>
                    <EditableField
                      value={fields.napravlenia || ''}
                      onChange={(v) => updateField('napravlenia', v)}
                      fieldKey="napravlenia"
                      highlightVitals={false}
                      uncertainSpans={uncertainByField.napravlenia}
                      onAcknowledgeUncertain={(orig) => acknowledgeUncertain('napravlenia', orig)}
                      readOnly={bodyReadOnly}
                    />
                  </div>
                )}
              </div>
            )}
            </>
            )}

            {fields._disclaimer && (
              <div
                className="text-xs px-3 py-2 rounded no-print"
                style={{
                  color: 'var(--color-text-muted)',
                  background: 'var(--color-bg-card)',
                  borderColor: 'var(--color-border)',
                  borderWidth: 1,
                }}
              >
                {fields._disclaimer}
              </div>
            )}
          </div>
          </div>
        </main>

        {/* ─── Right: meds + safety + actions ─── */}
        <aside className="no-print">
          <div className="sticky top-[88px] space-y-4">
            {/* Meds + drug-safety rail — консултація only. An echo readout
                prescribes nothing, so it has no medications_list / med_alerts. */}
            {!isEcho && (
            <>
            <MedsPanel
              meds={fields.medications_list || []}
              onChange={onMedsChange}
              terapiaText={fields.terapia || ''}
              inlineCriticals={criticals}
              lastRemovedName={lastRemovedMedName}
              onClearRemovedHint={() => setLastRemovedMedName(null)}
              isLocked={isLocked}
              sealed={bodyReadOnly}
              notifyCopy={notifyCopy}
              onMedsCopied={(scope, medCount) => {
                // Fire-and-forget — a failed network call must never affect
                // the clipboard write that already succeeded.
                if (!original) return;
                api.logMedsCopied(original.consultationId, scope, medCount)
                  .catch((err) => {
                    if (err instanceof ApiError) {
                      console.warn('[meds-copied] ' + err.status + ' ' + err.message);
                    }
                  });
              }}
            />

            {warnings.length > 0 && (
              <div
                className="bg-white rounded-2xl border p-4"
                style={{ borderColor: 'var(--color-border)' }}
              >
                <div
                  className="text-xs uppercase tracking-wider mb-2 font-medium flex items-center gap-1.5"
                  style={{ color: 'var(--color-gold)' }}
                >
                  <Icon name="alert-triangle" /> Предупреждения
                </div>
                <div className="space-y-2">
                  {warningGroups.map((g, i) => (
                    <WarningChip key={i} alert={g.alert} count={g.count} />
                  ))}
                </div>
              </div>
            )}
            </>
            )}

            <div
              className="bg-white rounded-2xl border p-4"
              style={{ borderColor: 'var(--color-border)' }}
            >
              <div
                className="text-xs uppercase tracking-wider mb-3 font-medium"
                style={{ color: 'var(--color-text-muted)' }}
              >
                Действия
              </div>
              <Link
                href="/app/scribe"
                className="block text-center py-2.5 rounded-md text-white font-medium text-sm transition hover:opacity-90 mb-2"
                style={{ background: 'var(--gradient-brand)' }}
                onClick={() => {
                  sessionStorage.removeItem(RESULT_STORAGE_KEY);
                  // The doctor is deliberately leaving this visit — close the
                  // лист now rather than waiting for a backstop. Best-effort
                  // ONLY: the enforceable triggers are the next
                  // POST /api/visits/start and the hourly time backstop, so a
                  // failed call costs nothing and must never block the nav.
                  //
                  // Wired HERE and nowhere else — deliberately not on unmount or
                  // beforeunload. The seal has no unlock, so a hard refresh must
                  // never close a note the doctor is still working on.
                  //
                  // An unapproved draft answers { sealed: false } and stays
                  // editable, so an interrupted note is safe to walk away from.
                  if (original) {
                    api.sealConsultation(original.consultationId).catch(() => {
                      /* a backstop will seal it — nothing to tell the doctor */
                    });
                  }
                }}
              >
                + Нова консултация
              </Link>
              <button
                onClick={handlePrint}
                disabled={isLocked}
                title={
                  isLocked ? 'Първо потвърдете прегледа' : undefined
                }
                className="block w-full text-center py-2 rounded-md text-sm font-medium transition border hover:bg-[var(--color-bg)] disabled:opacity-40 disabled:cursor-not-allowed"
                style={{
                  borderColor: 'var(--color-border-mid)',
                  color: 'var(--color-text-muted)',
                }}
              >
                <span className="inline-flex items-center justify-center gap-1.5">
                  <Icon name={isLocked ? 'lock' : 'printer'} /> Печат
                </span>
              </button>

              {/* Article 17. Set apart below a rule and in danger colours — it
                  is irreversible and must never sit shoulder-to-shoulder with
                  the everyday actions. Available on a SEALED note too: sealing
                  blocks changes, never the data subject's right. Hidden once
                  erased — there is nothing left to remove. */}
              {original && !isErased && (
                <div
                  className="mt-3 pt-3 border-t"
                  style={{ borderColor: 'var(--color-border)' }}
                >
                  <button
                    onClick={() => setEraseConfirmOpen(true)}
                    className="block w-full text-center py-2 rounded-md text-xs font-medium transition border hover:bg-[var(--color-danger-soft)]"
                    style={{
                      borderColor: 'var(--color-border-mid)',
                      color: 'var(--color-danger)',
                    }}
                  >
                    <span className="inline-flex items-center justify-center gap-1.5">
                      <Icon name="alert-triangle" /> Изтрий по заявка
                    </span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </aside>
      </div>

      <EraseConfirmModal
        isOpen={eraseConfirmOpen}
        busy={erasing}
        onCancel={() => setEraseConfirmOpen(false)}
        onConfirm={runErase}
      />

      <MkbPicker
        isOpen={mkbOpen}
        onClose={closeMkbPicker}
        onPick={pickMkb}
        title={
          mkbTarget?.kind === 'osnovna'
            ? 'Основна диагноза — МКБ-10'
            : 'Придружаващо заболяване — МКБ-10'
        }
      />

      <PatientSummaryModal
        isOpen={summaryOpen}
        consultationId={original.consultationId}
        onClose={() => setSummaryOpen(false)}
        onToast={showToast}
      />

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </AppShell>
  );
}

/* ──────────────────────────────────────────────────────────────── */

// „×N" badge (#47) — identical alert entries collapse to one chip via
// groupAlerts; the badge says how many entries the chip stands for. Purely
// presentational — content, severity, and card-flag behavior are untouched.
function AlertCountBadge({ count, color }: { count: number; color: string }) {
  if (count <= 1) return null;
  return (
    <span
      className="flex-shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full border leading-none"
      style={{ color, borderColor: color }}
      title={`${count} еднакви записа, показани веднъж`}
    >
      ×{count}
    </span>
  );
}

function CriticalChip({ alert, count = 1 }: { alert: SafetyAlert; count?: number }) {
  return (
    <div
      className="flex items-start gap-3 px-3 py-2 rounded-md"
      style={{
        background: 'white',
        borderColor: 'var(--color-red)',
        borderWidth: 1,
      }}
    >
      <Icon
        name="alert-octagon"
        size={18}
        className="flex-shrink-0"
        style={{ color: 'var(--color-red)' }}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <div
            className="text-xs font-bold uppercase tracking-wider"
            style={{ color: 'var(--color-red)' }}
          >
            Внимание!
          </div>
          <AlertCountBadge count={count} color="var(--color-red)" />
        </div>
        <div
          className="text-sm mt-0.5"
          style={{ color: 'var(--color-text)' }}
        >
          {alert.message}
        </div>
      </div>
    </div>
  );
}

function WarningChip({ alert, count = 1 }: { alert: SafetyAlert; count?: number }) {
  return (
    <div
      className="flex items-start gap-2 px-2.5 py-2 rounded-md"
      style={{
        background: 'var(--color-gold-soft)',
        borderColor: 'var(--color-gold)',
        borderWidth: 1,
      }}
    >
      <Icon
        name="alert-triangle"
        className="flex-shrink-0"
        style={{ color: 'var(--color-gold)' }}
      />
      <div
        className="text-xs leading-snug"
        style={{ color: 'var(--color-text)' }}
      >
        <div className="flex items-center gap-2 mb-0.5">
          <div
            className="font-semibold uppercase tracking-wide text-[10px]"
            style={{ color: 'var(--color-gold)' }}
          >
            Предупреждение
          </div>
          <AlertCountBadge count={count} color="var(--color-gold)" />
        </div>
        {alert.message}
        {alert.action && (
          <div
            className="mt-1 pt-1 text-[11px] leading-snug border-t"
            style={{
              borderColor: 'var(--color-gold)',
              opacity: 0.85,
            }}
          >
            <span className="font-medium">Действие:</span> {alert.action}
          </div>
        )}
      </div>
    </div>
  );
}

function ReviewCounter({
  total,
  cursor,
  onNext,
}: {
  total: number;
  cursor: number;
  onNext: () => void;
}) {
  // cursor === 0 means "haven't started"; otherwise show "current / total".
  const showProgress = cursor > 0;
  const display = showProgress
    ? `${((cursor - 1) % total) + 1} / ${total}`
    : `${total} за преглед`;
  return (
    <button
      onClick={onNext}
      title="Прескочи към следващото отбелязано показание"
      className="flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition hover:opacity-90"
      style={{
        background: 'var(--color-gold-soft)',
        color: 'var(--color-gold)',
        borderColor: 'var(--color-gold)',
        borderWidth: 1,
      }}
    >
      <Icon name="alert-triangle" />
      <span>{display}</span>
      <Icon name="chevron-right" size={14} />
    </button>
  );
}

// Article-17 confirmation. Deliberately verbose about the ASYMMETRY: what goes
// (irreversibly) and what stays. A doctor acting on a patient's request needs to
// know the practice keeps its proof that the visit happened and was consented
// to — otherwise „изтрий" reads as destroying the practice's own legal record
// and nobody will dare press it.
//
// No „don't ask again", no auto-focus on the destructive button: this is a
// once-in-a-while irreversible action, and a moment's friction is the point.
function EraseConfirmModal({
  isOpen,
  busy,
  onCancel,
  onConfirm,
}: {
  isOpen: boolean;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    if (!isOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) onCancel();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, busy, onCancel]);

  if (!isOpen) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 no-print"
      style={{ background: 'rgba(15, 23, 42, 0.45)' }}
      onClick={() => { if (!busy) onCancel(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="erase-title"
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-xl shadow-xl w-full max-w-md p-5"
        style={{ border: '1px solid var(--color-border)' }}
      >
        <div
          id="erase-title"
          className="text-base font-semibold flex items-center gap-2 mb-3"
          style={{ color: 'var(--color-danger)' }}
        >
          <Icon name="alert-triangle" /> Изтриване по заявка
        </div>

        <p className="text-sm leading-relaxed mb-3" style={{ color: 'var(--color-text)' }}>
          Съдържанието на този лист ще бъде премахнато{' '}
          <strong>необратимо</strong> — анамнеза, обективно състояние,
          изследвания, диагнози, терапия, както и транскрипцията на разговора.
          Действието не може да бъде отменено.
        </p>

        <div
          className="text-xs leading-relaxed rounded-md px-3 py-2 mb-4"
          style={{ background: 'var(--color-bg)', color: 'var(--color-text-muted)' }}
        >
          Записът за самия преглед остава: дата и час, вид на посещението, както
          и отметките за съгласие и потвърждение от лекаря. Те са доказателството
          на практиката, че прегледът се е състоял и е бил разрешен.
        </div>

        <div className="flex gap-2">
          <button
            onClick={onCancel}
            disabled={busy}
            className="flex-1 py-2 rounded-md text-sm font-medium border transition hover:bg-[var(--color-bg)] disabled:opacity-40"
            style={{ borderColor: 'var(--color-border-mid)', color: 'var(--color-text-muted)' }}
          >
            Отказ
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className="flex-1 py-2 rounded-md text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed"
            style={{ background: 'var(--color-danger)' }}
          >
            {busy ? 'Изтриване…' : 'Изтрий необратимо'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Sofia-local, day-precision. The seal instant only ever appears as reassurance
// („this лист was closed then"), never as something to act on, so the date is
// enough and a bare ISO string would read as debug output.
function formatSealedAt(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '—';
  return new Intl.DateTimeFormat('bg-BG', {
    timeZone: 'Europe/Sofia', day: 'numeric', month: 'long', year: 'numeric',
  }).format(new Date(t));
}

function StatusBadge({
  status,
  popupOpen,
  onClick,
  onConfirm,
  onDismiss,
  blocked = false,
  blockHint,
  sealedAt = null,
}: {
  status: ReviewStatus;
  popupOpen: boolean;
  onClick: () => void;
  onConfirm: () => void;
  onDismiss: () => void;
  /** МКБ gate — when true, the confirm action is disabled (invalid/missing code). */
  blocked?: boolean;
  blockHint?: string;
  /** Non-null = the лист is sealed (visit over, closed for editing). Replaces
   *  the badge with a terminal state, so the reason the body is inert is
   *  obvious at a glance rather than something the doctor has to deduce from a
   *  field that won't take a click. Not a button: there is no unlock. */
  sealedAt?: string | null;
}) {
  const isConfirmed = status === 'confirmed';

  if (sealedAt) {
    return (
      <div
        className="flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium"
        style={{ background: 'var(--color-ok-soft)', color: 'var(--color-ok)' }}
        title={`Приключен на ${formatSealedAt(sealedAt)} — редакциите се правят в Хипократ.`}
      >
        <span className="w-2 h-2 rounded-full" style={{ background: 'var(--color-ok)' }} />
        <span className="inline-flex items-center gap-1.5">
          <Icon name="check" /> Потвърден и затворен — само за преглед
        </span>
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={onClick}
        className="flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition"
        style={{
          background: isConfirmed
            ? 'var(--color-ok-soft)'
            : 'var(--color-gold-soft)',
          color: isConfirmed ? 'var(--color-ok)' : 'var(--color-gold)',
        }}
      >
        <span
          className="w-2 h-2 rounded-full"
          style={{
            background: isConfirmed
              ? 'var(--color-ok)'
              : 'var(--color-gold)',
          }}
        />
        {isConfirmed ? (
          <span className="inline-flex items-center gap-1.5">
            <Icon name="check" /> Потвърдено от лекар
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5">
            <Icon name="lock" /> Чака преглед — действията са заключени
          </span>
        )}
      </button>
      {popupOpen && !isConfirmed && (
        <div
          className="absolute top-full left-0 mt-2 bg-white rounded-lg border p-2 shadow-md z-20 flex flex-col gap-1 min-w-[220px]"
          style={{ borderColor: 'var(--color-border)' }}
        >
          {blocked && blockHint && (
            <div
              className="px-3 py-1.5 text-xs rounded-md"
              style={{ color: 'var(--color-red)', background: 'var(--color-red-soft)' }}
            >
              {blockHint}
            </div>
          )}
          <button
            onClick={onConfirm}
            disabled={blocked}
            className="text-left px-3 py-2 rounded-md text-sm font-medium transition hover:bg-[var(--color-ok-soft)] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
            style={{ color: 'var(--color-ok)' }}
          >
            <span className="inline-flex items-center gap-1.5">
              <Icon name="check" /> Вярно! Потвърждавам прегледа
            </span>
          </button>
          <button
            onClick={onDismiss}
            className="text-left px-3 py-2 rounded-md text-sm transition hover:bg-[var(--color-bg)]"
            style={{ color: 'var(--color-text-muted)' }}
          >
            <span className="inline-flex items-center gap-1.5">
              <Icon name="pencil" /> Ще редактирам още
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

// Small, unobtrusive "виж източника" affordance (Traceability Phase 1a). Sits
// near a field's label; disabled (greyed, with a hint) when no transcript exists.
// no-print so it never bleeds into the printed/exported document.
function SourceButton({
  onClick,
  disabled,
  resolved,
}: {
  onClick: () => void;
  disabled?: boolean;
  // Honest source state (trust Batch B): true = backend-resolved offsets exist
  // → „виж източника"; false = no clear source → the button ITSELF says „няма
  // ясен източник" before any click (persistent, not a transient toast), and
  // clicking opens the banner with the explicit „Покажи предположение" opt-in.
  resolved?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={
        disabled
          ? 'Източникът не е наличен'
          : resolved
            ? 'Покажи мястото в транскрипта, от което идва това поле'
            : 'Няма потвърден източник в транскрипта — отвори за предположение'
      }
      className="no-print flex-shrink-0 text-xs underline decoration-dotted underline-offset-2 transition hover:opacity-80 disabled:opacity-40 disabled:no-underline disabled:cursor-not-allowed"
      style={{ color: 'var(--color-text-muted)', background: 'transparent' }}
    >
      {resolved ? 'виж източника' : 'няма ясен източник'}
    </button>
  );
}

// Amber „AI несигурен" chip — rendered BESIDE the source button when the field
// has live (resolved, unacknowledged) uncertain_spans. Composition, not
// precedence: model self-uncertainty (gold vocabulary) and source traceability
// (blue vocabulary) are orthogonal review systems — never conflate, never hide
// one behind the other. no-print like every review affordance.
function SourceStateBadge() {
  return (
    <span
      className="no-print flex-shrink-0 text-xs px-1.5 py-0.5 rounded"
      title="Моделът е отбелязал част от това поле за преглед"
      style={{
        background: 'rgba(183, 121, 31, 0.10)',
        color: 'var(--color-gold)',
        border: '1px solid rgba(183, 121, 31, 0.25)',
      }}
    >
      AI несигурен
    </span>
  );
}

// Render the transcript, lighting up ONLY the matched-needle tokens (A4) and
// greying the rest. The bridging filler between matched words (dose/frequency
// runs, unrelated words) is NOT highlighted, so a partial match reads as partial
// — a green block on a trivial fragment can no longer falsely reassure the doctor
// that the whole field is grounded. Adjacent tokens separated only by whitespace
// merge into one phrase-box. Reuses the brand-family highlight vocabulary (mark +
// soft background + bottom border), distinct from the gold/red vital warnings.
function TranscriptBody({
  transcript,
  span,
  variant = 'stored',
}: {
  transcript: string;
  span: SourceSpan | null;
  // 'stored' = backend-resolved offsets (confident: solid brand highlight);
  // 'guess' = alias-bridge opt-in (tentative: dashed underline, no fill —
  // same traceability-blue family, visibly weaker claim; gold stays reserved
  // for AI-uncertainty and red for vital ranges).
  variant?: 'stored' | 'guess';
}) {
  if (!transcript) {
    return (
      <em style={{ color: 'var(--color-text-muted)' }}>Транскриптът е празен.</em>
    );
  }
  if (!span || span.tokens.length === 0) return <>{transcript}</>;

  // Merge matched tokens separated only by whitespace into clean phrase-boxes.
  const ranges: { start: number; end: number }[] = [];
  for (const tk of span.tokens) {
    const last = ranges[ranges.length - 1];
    if (last && /^\s*$/.test(transcript.slice(last.end, tk.start))) last.end = tk.end;
    else ranges.push({ start: tk.start, end: tk.end });
  }

  const out: React.ReactNode[] = [];
  let cursor = 0;
  ranges.forEach((r, i) => {
    if (r.start > cursor) {
      out.push(
        <span key={`g${cursor}`} style={{ color: 'var(--color-text-muted)' }}>
          {transcript.slice(cursor, r.start)}
        </span>
      );
    }
    out.push(
      <mark
        key={`m${r.start}`}
        id={i === 0 ? 'source-mark' : undefined}
        className="source-mark"
        style={
          variant === 'guess'
            ? {
                background: 'transparent',
                color: 'var(--color-text)',
                borderBottom: '2px dashed var(--color-brand)',
                padding: '0 2px',
                borderRadius: '3px',
                fontWeight: 500,
              }
            : {
                background: 'var(--color-brand-soft)',
                color: 'var(--color-text)',
                borderBottom: '2px solid var(--color-brand)',
                padding: '0 2px',
                borderRadius: '3px',
                fontWeight: 500,
              }
        }
      >
        {transcript.slice(r.start, r.end)}
      </mark>
    );
    cursor = r.end;
  });
  if (cursor < transcript.length) {
    out.push(
      <span key={`g${cursor}`} style={{ color: 'var(--color-text-muted)' }}>
        {transcript.slice(cursor)}
      </span>
    );
  }
  return <>{out}</>;
}

// Calm-clinical section header — delegates to the shared NoteSectionHead (accent
// tick + UPPERCASE navy label + hairline), replacing the old bold near-black h2.
// All section consumers (TextSection, Изследвания, Издадени, Диагнози) flip at once.
function SectionHead({
  title,
  icon,
  actions,
}: {
  title: string;
  icon?: IconName;
  actions?: React.ReactNode;
}) {
  return (
    <NoteSectionHead
      title={title}
      icon={icon ? <Icon name={icon} /> : undefined}
      action={actions}
    />
  );
}

function SubsectionHead({ title, icon }: { title: string; icon?: IconName }) {
  return (
    <div
      className="text-xs font-semibold uppercase tracking-wider mb-2 flex items-center gap-1.5"
      style={{ color: 'var(--color-brand)' }}
    >
      {icon && <Icon name={icon} />}
      {title}
    </div>
  );
}

function TextSection({
  id,
  title,
  icon,
  value,
  onChange,
  fieldKey,
  acknowledged,
  onAcknowledge,
  uncertainSpans,
  onAcknowledgeUncertain,
  headerRight,
  readOnly = false,
}: {
  id: string;
  title: string;
  icon?: IconName;
  value: string;
  onChange: (v: string) => void;
  fieldKey?: string;
  acknowledged?: Set<string>;
  onAcknowledge?: (raw: string) => void;
  uncertainSpans?: ResolvedUncertainSpan[];
  onAcknowledgeUncertain?: (original: string) => void;
  headerRight?: React.ReactNode;
  /** Sealed лист — the section renders as a document (see EditableField). */
  readOnly?: boolean;
}) {
  return (
    <div id={id} className="scroll-mt-24">
      <SectionHead title={title} icon={icon} actions={headerRight} />
      <EditableField
        value={value}
        onChange={onChange}
        fieldKey={fieldKey}
        acknowledged={acknowledged}
        onAcknowledge={onAcknowledge}
        uncertainSpans={uncertainSpans}
        onAcknowledgeUncertain={onAcknowledgeUncertain}
        readOnly={readOnly}
      />
    </div>
  );
}

// A filed diagnosis on a sealed лист: the МКБ code + its official term, as a
// line of the document. Deliberately not a disabled MkbTypeahead — a search box
// that won't search reads as broken. Same height and horizontal rhythm as the
// typeahead it replaces so the section doesn't reflow between the two states.
function DiagnosisLine({
  code,
  term,
  invalid = false,
}: {
  code: string;
  term: string;
  /** Keeps a filed-but-invalid code visually flagged — the note is closed, but
   *  the reader still deserves to see that its code never validated. */
  invalid?: boolean;
}) {
  const hasCode = code.trim().length > 0;
  return (
    <div className="flex-1 min-w-0 px-3 py-2 text-sm flex items-baseline gap-2">
      {hasCode && (
        <span
          className="font-semibold flex-shrink-0"
          style={{ color: invalid ? 'var(--color-red)' : 'var(--color-brand)' }}
        >
          {code.trim()}
        </span>
      )}
      <span
        className="min-w-0 break-words [overflow-wrap:anywhere]"
        style={{ color: term.trim() ? 'var(--color-text)' : 'var(--color-text-muted)' }}
      >
        {term.trim() || 'Не е посочена'}
      </span>
    </div>
  );
}

function DiagnosesSection({
  osnovnaDiagnoza,
  osnovnaMkb,
  osnovnaMkbTerm,
  termSource,
  mkbReview,
  originalSpoken,
  pridruzhavashti,
  onOsnovnaPick,
  onOsnovnaBrowse,
  onComorbidityPick,
  onComorbidityBrowse,
  onComorbidityAddBrowse,
  onComorbidityRemove,
  onShowSource,
  sourceDisabled,
  sourceResolved,
  isLocked,
  notifyCopy,
  sealed = false,
}: {
  osnovnaDiagnoza: string;
  osnovnaMkb: string;
  osnovnaMkbTerm?: string;
  termSource?: 'exact' | 'parent';
  mkbReview?: MkbReview;
  originalSpoken?: string;
  pridruzhavashti: ComorbidDiagnosis[];
  onOsnovnaPick: (code: string, term: string) => void;
  onOsnovnaBrowse: () => void;
  onComorbidityPick: (index: number, code: string, term: string) => void;
  onComorbidityBrowse: (index: number) => void;
  onComorbidityAddBrowse: () => void;
  onComorbidityRemove: (index: number) => void;
  onShowSource: () => void;
  sourceDisabled: boolean;
  sourceResolved: boolean;
  isLocked: boolean;
  notifyCopy: (ok: boolean) => void;
  /** Sealed лист: typeaheads become filed diagnosis lines, and „+ Добави" /
   *  per-row remove disappear. The „виж източника" button stays — reading where
   *  a diagnosis came from is exactly what a closed note is for. */
  sealed?: boolean;
}) {
  const needsReview = !!mkbReview?.needs_review;
  const atMaxComorbidities = pridruzhavashti.length >= 4; // backend STEP 2 contract caps at 4

  // Displayed term = official МКБ term for a valid code, spoken fallback otherwise.
  const mainTerm = filedMainTerm({
    osnovna_mkb: osnovnaMkb,
    osnovna_mkb_term: osnovnaMkbTerm,
    osnovna_diagnoza: osnovnaDiagnoza,
  });
  // "доктор каза" cue — only when the spoken phrasing meaningfully diverges from
  // the official term (and the code is valid, so there IS an official term).
  const showCue = !needsReview && spokenDivergesFromOfficial(originalSpoken, osnovnaMkbTerm);

  return (
    <div id="sec-diag" className="scroll-mt-24">
      <SectionHead title="Диагнози МКБ-10" icon="clipboard" />

      <div className="mb-4 pb-4 border-b" style={{ borderColor: 'var(--color-border)' }}>
        <div className="flex items-center justify-between gap-2 mb-2">
          <div
            className="text-xs uppercase tracking-wider font-medium"
            style={{ color: 'var(--color-text-muted)' }}
          >
            Основна диагноза
          </div>
          <SourceButton onClick={onShowSource} disabled={sourceDisabled} resolved={sourceResolved} />
        </div>
        <div className="flex items-center gap-2">
          {sealed ? (
            // A search box on a closed лист invites a change that cannot land.
            // Render what was filed — code + official term — and keep the copy
            // button, which is the one thing a doctor still needs here.
            <DiagnosisLine code={osnovnaMkb} term={mainTerm} invalid={needsReview} />
          ) : (
            <MkbTypeahead
              code={osnovnaMkb}
              term={mainTerm}
              invalid={needsReview}
              placeholder="Търсене на диагноза или МКБ код…"
              onPick={onOsnovnaPick}
              onBrowse={onOsnovnaBrowse}
            />
          )}
          {osnovnaMkb.trim() && (
            <CopyButton
              text={osnovnaMkb.trim()}
              disabled={isLocked}
              onResult={notifyCopy}
              label="МКБ"
            />
          )}
        </div>
        {showCue && (
          <div className="mt-1.5 text-xs px-1" style={{ color: 'var(--color-text-muted)' }}>
            доктор каза: {originalSpoken}
          </div>
        )}
        {!needsReview && termSource === 'parent' && osnovnaMkbTerm && (
          <div className="mt-1 text-[11px] px-1" style={{ color: 'var(--color-text-muted)' }}>
            категория по МКБ-10 (3-знача рубрика)
          </div>
        )}
        {needsReview && (
          <div
            role="alert"
            className="mt-2 rounded-md border px-3 py-2"
            style={{ borderColor: 'var(--color-red)', background: 'var(--color-red-soft)', color: 'var(--color-red)' }}
          >
            <div className="text-sm font-semibold flex items-center gap-1.5">
              <Icon name="alert-triangle" /> {mkbReviewCopy(mkbReview, osnovnaMkb).bannerTitle}
            </div>
            <div className="text-xs mt-0.5">
              {mkbReviewCopy(mkbReview, osnovnaMkb).bannerDetail}
            </div>
          </div>
        )}
      </div>

      <div
        className="text-xs uppercase tracking-wider mb-3 font-medium flex items-center justify-between"
        style={{ color: 'var(--color-text-muted)' }}
      >
        <span>Придружаващи заболявания{sealed || !atMaxComorbidities ? '' : ' · макс 4'}</span>
        {!sealed && (
          <button
            onClick={onComorbidityAddBrowse}
            disabled={atMaxComorbidities}
            title={atMaxComorbidities ? 'Макс 4 придружаващи заболявания' : undefined}
            className="text-xs font-semibold px-2 py-1 rounded transition hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:opacity-40"
            style={{ color: 'var(--color-brand)', background: 'var(--color-brand-soft)' }}
          >
            + Добави
          </button>
        )}
      </div>
      <div className="space-y-2">
        {pridruzhavashti.map((d, i) =>
          sealed ? (
            <DiagnosisLine key={i} code={d.mkb} term={filedComorbidityTerm(d)} />
          ) : (
            <MkbTypeahead
              key={i}
              code={d.mkb}
              term={filedComorbidityTerm(d)}
              placeholder="Търсене на придружаващо заболяване…"
              onPick={(code, term) => onComorbidityPick(i, code, term)}
              onBrowse={() => onComorbidityBrowse(i)}
              onRemove={() => onComorbidityRemove(i)}
            />
          ),
        )}
        {pridruzhavashti.length === 0 && (
          <div className="text-sm px-3 py-1" style={{ color: 'var(--color-text-muted)' }}>
            Няма придружаващи заболявания.
          </div>
        )}
      </div>
    </div>
  );
}

// The header strip + visitTypeLabel previously lived here as local functions;
// extracted to components/VisitHeaderStrip.tsx so /app/scribe and
// /app/scribe/result render the exact same strip from one source.
