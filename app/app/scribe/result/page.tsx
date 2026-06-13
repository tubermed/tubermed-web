'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import AppShell from '@/components/AppShell';
import Stepper from '@/components/Stepper';
import { SCRIBE_FLOW_STEPS } from '@/lib/flow';
import EditableField from '@/components/EditableField';
import MkbPicker from '@/components/MkbPicker';
import MkbTypeahead from '@/components/MkbTypeahead';
import MedsPanel from '@/components/MedsPanel';
import PatientHeaderStrip from '@/components/PatientHeaderStrip';
import Toast, { type ToastData, type ToastKind } from '@/components/Toast';
import { api, ApiError, getSession } from '@/lib/api';
import type { DoctorInfo } from '@/lib/api';
import { useColdStartRecovery } from '@/lib/use-cold-start-recovery';
import type {
  TranscribeResult,
  TranscribeFields,
  ComorbidDiagnosis,
  Medication,
  PendingVisit,
  ExportSignalPayload,
  MkbReview,
} from '@/lib/types';
import { mergeBackendAlerts, type SafetyAlert } from '@/lib/drug-safety';
import { loadMkb, getMkbDataSync, resolveMkb } from '@/lib/mkb10';
import { filedMainTerm, filedComorbidityTerm, spokenDivergesFromOfficial } from '@/lib/diagnosis';
import { loadIal } from '@/lib/ial-meds';
import { findHighlights, type HighlightMatch } from '@/lib/vital-rules';
import {
  formatPlainText,
  copyToClipboard,
  generatePdfHtml,
  openPdfPreview,
  generateWordHtml,
  downloadWord,
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
  { id: 'sec-terapia', label: 'Терапия' },
  { id: 'sec-meds-panel', label: 'Медикаменти', scrollMode: 'top' },
  { id: 'sec-izdadeni', label: 'Издадени документи' },
  { id: 'sec-napravlenia', label: 'Направления', indent: true },
  { id: 'sec-naznacheni', label: 'Назначени изследвания', indent: true },
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

// Localized block message — mirrors the backend mkbReviewBlock() copy so the
// toast and the 409 backstop read identically.
function mkbBlockMessage(review?: MkbReview | null): string {
  if (review?.reason === 'missing_code')
    return 'Липсва код по МКБ-10 за основната диагноза. Добавете валиден код преди потвърждаване.';
  const code = review?.code ? `„${review.code}“` : 'кодът';
  return `Кодът по МКБ-10 ${code} не е валиден. Коригирайте основната диагноза преди потвърждаване.`;
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
    <main
      className="min-h-screen flex items-center justify-center"
      style={{ color: 'var(--color-text-muted)' }}
    >
      Зареждане…
    </main>
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
  const isLocked = reviewStatus !== 'confirmed';

  // ── Bootstrap ────────────────────────────────────────────────
  useEffect(() => {
    const session = getSession();
    if (!session) {
      router.replace('/app/login');
      return;
    }
    setDoctor(session.doctor);

    const raw = sessionStorage.getItem(RESULT_STORAGE_KEY);
    if (!raw) {
      // Cold start (hard refresh / new tab / laptop sleep): tuber_last_result is
      // gone. If the URL carries ?visit=<id>, recover the filed note + patient
      // header from the backend instead of bouncing. Otherwise there's nothing
      // to recover — back to scribe.
      const visitId = searchParams.get('visit');
      if (visitId) {
        setRecoverVisitId(visitId);
        return;
      }
      router.replace('/app/scribe');
      return;
    }
    try {
      const parsed = JSON.parse(raw) as TranscribeResult;
      setOriginal(parsed);
      setFields({
        ...parsed.fields,
        medications_list: normalizeMedications(
          parsed.fields.medications_list
        ),
      });
      // The blob is the AI output frozen at generation — it never carries the
      // doctor's later edits. Whenever ?visit= is present the server's
      // extracted_fields is the source of truth: we just painted the blob for an
      // instant first render; arm the reconcile effect to overwrite the rendered
      // fields with the server copy. (Fixes same-tab F5 / duplicated-tab showing
      // pre-edit text — sessionStorage survives those, so recovery never fires.)
      const visitId = searchParams.get('visit');
      if (visitId) setReconcileVisitId(visitId);
    } catch {
      router.replace('/app/scribe');
    }

    // Optional patient context (present when the recording came from /app/new-visit).
    // Legacy recordings won't have it — render falls back gracefully.
    try {
      const pv = sessionStorage.getItem(PENDING_VISIT_KEY);
      if (pv) setPendingVisit(JSON.parse(pv) as PendingVisit);
    } catch {
      /* malformed — render without patient header */
    }
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
  // was absent). Rebuilds `original` (and thus the editable note) from the
  // filed `note`, plus the patient header from getPatient. Inert on happy path.
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
        if (!consultation.note) {
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
          console.warn('[edit-track] ' + err.status + ' ' + err.message);
        }
      });
    pendingEditField.current = null;
    pendingCharsChangedRef.current = 0;
  }, [original]);

  const trackEdit = useCallback(
    (fieldKey: string, charsChanged: number) => {
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
    [flushEdit, reviewStatus]
  );

  // Keep a ref to the latest flushEdit so the unmount cleanup — which MUST use
  // [] deps to run only on real unmount — can call the current version (with the
  // current `original`) instead of a closure captured at mount.
  const flushEditRef = useRef(flushEdit);
  useEffect(() => {
    flushEditRef.current = flushEdit;
  }, [flushEdit]);

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

  const reviewItems = useMemo(() => {
    const fieldsToScan: Array<keyof TranscribeFields> = [
      'anamneza',
      'obektivno',
      'izsledvania',
      'terapia',
    ];
    const items: Array<
      HighlightMatch & { fieldKey: string; localIdx: number }
    > = [];
    for (const fk of fieldsToScan) {
      const text = (fields[fk] as string) || '';
      const matches = findHighlights(text);
      // Match EditableField's filter: skip acknowledged. localIdx counts
      // only visible (non-acknowledged) matches so DOM ids line up.
      let visibleIdx = 0;
      for (const m of matches) {
        if (acknowledged.has(`${String(fk)}::${m.raw}`)) continue;
        items.push({ ...m, fieldKey: String(fk), localIdx: visibleIdx });
        visibleIdx++;
      }
    }
    return items;
  }, [
    fields.anamneza,
    fields.obektivno,
    fields.izsledvania,
    fields.terapia,
    acknowledged,
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
    const spanId = `vital-${item.fieldKey}-${item.localIdx}`;
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
  const navTo = useCallback((item: NavItem) => {
    setActiveNav(item.id);
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
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort(
            (a, b) => a.boundingClientRect.top - b.boundingClientRect.top
          );
        if (visible.length > 0) setActiveNav(visible[0].target.id);
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
        setFields((prev) => ({
          ...prev,
          osnovna_mkb: code,
          ...(rec
            ? {
                mkb_review:              rec.mkb_review,
                osnovna_mkb_term:        rec.osnovna_mkb_term,
                osnovna_mkb_term_source: rec.osnovna_mkb_term_source,
              }
            : { mkb_review: { needs_review: false }, osnovna_mkb_term: term }),
        }));
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

  // Shared callback for per-section CopyButtons — reuses the same Bulgarian
  // strings as the topbar full-document copy so the affordance feels uniform.
  const notifyCopy = useCallback(
    (ok: boolean) => {
      showToast(
        ok ? 'success' : 'error',
        ok ? '✓ Копирано в клипборда' : 'Копирането не е възможно в този браузър'
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
      showToast('success', '✓ Копирано в клипборда');
      signalExport('copy');
    } else {
      showToast('error', 'Копирането не е възможно в този браузър');
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
      showToast('success', '✓ Преглед отворен — Запази като PDF от бутона');
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
      showToast('success', '✓ Word файлът е свален');
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
    const hasNap = !!(fields.napravlenia && fields.napravlenia.trim());
    const hasNaz = !!(fields.naznacheni && fields.naznacheni.trim());
    v['sec-izdadeni'] = hasNap || hasNaz;
    v['sec-napravlenia'] = hasNap;
    v['sec-naznacheni'] = hasNaz;
    return v;
  }, [fields.napravlenia, fields.naznacheni]);

  if (!doctor || !original) {
    return (
      <main
        className="min-h-screen flex items-center justify-center"
        style={{ color: 'var(--color-text-muted)' }}
      >
        Зареждане…
      </main>
    );
  }

  const todayBg = new Date().toLocaleDateString('bg-BG', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  return (
    <AppShell doctor={doctor}>
      <Stepper steps={SCRIBE_FLOW_STEPS} current={3} />

      {pendingVisit && <PatientHeaderStrip pending={pendingVisit} />}

      {/* Critical safety banner — full width */}
      {criticals.length > 0 && (
        <div
          className="px-6 py-4 border-b no-print"
          style={{ background: 'var(--color-danger-soft)', borderColor: 'var(--color-danger)' }}
        >
          <div className="max-w-6xl mx-auto">
            <div
              className="text-sm font-bold uppercase tracking-wider mb-2"
              style={{ color: 'var(--color-red)' }}
            >
              🚨 Внимание — Проверка за безопасност
            </div>
            <div className="space-y-2">
              {criticals.map((a, i) => (
                <CriticalChip key={i} alert={a} />
              ))}
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
        />
        {reviewItems.length > 0 && (
          <ReviewCounter
            total={reviewItems.length}
            cursor={reviewCursor}
            onNext={goToNextReview}
          />
        )}
        <div className="flex items-center gap-2">
          <TopbarBtn
            locked={isLocked}
            disabled={isLocked}
            onClick={handlePdf}
            label="⬇ PDF"
            lockedHint="Първо потвърдете прегледа"
          />
          <TopbarBtn
            locked={isLocked}
            disabled={isLocked}
            onClick={handleWord}
            label="⬇ Word"
            lockedHint="Първо потвърдете прегледа"
          />
          <TopbarBtn
            locked={isLocked}
            disabled={isLocked}
            onClick={handleCopy}
            label="⎘ Копирай"
            lockedHint="Първо потвърдете прегледа"
          />
          <TopbarBtn
            locked={isLocked}
            disabled={isLocked}
            onClick={handlePrint}
            label="⎙ Печат"
            lockedHint="Първо потвърдете прегледа"
          />
          <TopbarBtn
            locked={isLocked}
            disabled={isLocked}
            onClick={() => setSummaryOpen(true)}
            label="📄 Резюме за пациента"
            lockedHint="Първо потвърдете прегледа"
          />
        </div>
      </div>

      {/* 3-column grid */}
      <div className="result-grid flex-1">
        {/* ─── Left: section nav ─── */}
        <aside className="no-print">
          <div className="sticky top-[88px]">
            <div
              className="text-xs uppercase tracking-wider mb-3 font-medium"
              style={{ color: 'var(--color-text-hint)' }}
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
                    className="flex items-center gap-2 px-3 py-2 rounded-md text-left transition-colors"
                    style={{
                      paddingLeft: item.indent ? '28px' : '12px',
                      fontSize: item.indent ? '13px' : '14px',
                      color: isActive
                        ? 'var(--color-brand)'
                        : 'var(--color-text-muted)',
                      background: isActive
                        ? 'var(--color-brand-soft)'
                        : 'transparent',
                      fontWeight: isActive ? 600 : 500,
                    }}
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full flex-shrink-0 transition-colors"
                      style={{
                        background: isActive
                          ? 'var(--color-brand)'
                          : 'var(--color-border-mid)',
                      }}
                    />
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
                style={{ color: 'var(--color-text-hint)' }}
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
        </aside>

        {/* ─── Center: document ─── */}
        <main className="min-w-0">
          {/* Transcript collapsible */}
          <details
            className="mb-4 no-print"
            open={transcriptOpen}
            onToggle={(e) =>
              setTranscriptOpen(
                (e.currentTarget as HTMLDetailsElement).open
              )
            }
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
              {original.transcript || (
                <em style={{ color: 'var(--color-text-hint)' }}>
                  Транскриптът е празен.
                </em>
              )}
            </div>
          </details>

          {/* Document header */}
          <div
            className="bg-white rounded-2xl border p-8 mb-4 flex items-baseline justify-between flex-wrap gap-4"
            style={{ borderColor: 'var(--color-border)' }}
          >
            <h1
              className="text-3xl font-semibold"
              style={{ color: 'var(--color-ink)', letterSpacing: '-0.01em' }}
            >
              Амбулаторен лист
            </h1>
            <div
              className="text-sm font-[family-name:var(--font-jetbrains)]"
              style={{ color: 'var(--color-text-muted)' }}
            >
              {todayBg}
            </div>
          </div>

          <div className="space-y-4">
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
              isLocked={isLocked}
              notifyCopy={notifyCopy}
            />

            <TextSection
              id="sec-anamneza"
              title="Анамнеза"
              fieldKey="anamneza"
              value={fields.anamneza || ''}
              onChange={(v) => updateField('anamneza', v)}
              acknowledged={acknowledged}
              onAcknowledge={(raw) => acknowledgeSpan('anamneza', raw)}
              headerRight={
                <CopyButton
                  text={fields.anamneza || ''}
                  disabled={isLocked}
                  onResult={notifyCopy}
                />
              }
            />
            <TextSection
              id="sec-obektivno"
              title="Обективно състояние"
              fieldKey="obektivno"
              value={fields.obektivno || ''}
              onChange={(v) => updateField('obektivno', v)}
              acknowledged={acknowledged}
              onAcknowledge={(raw) => acknowledgeSpan('obektivno', raw)}
              headerRight={
                <CopyButton
                  text={fields.obektivno || ''}
                  disabled={isLocked}
                  onResult={notifyCopy}
                />
              }
            />
            <TextSection
              id="sec-izsledvania"
              title="Изследвания"
              fieldKey="izsledvania"
              value={fields.izsledvania || ''}
              onChange={(v) => updateField('izsledvania', v)}
              acknowledged={acknowledged}
              onAcknowledge={(raw) => acknowledgeSpan('izsledvania', raw)}
              headerRight={
                <CopyButton
                  text={fields.izsledvania || ''}
                  disabled={isLocked}
                  onResult={notifyCopy}
                />
              }
            />
            <TextSection
              id="sec-terapia"
              title="Терапия"
              fieldKey="terapia"
              value={fields.terapia || ''}
              onChange={(v) => updateField('terapia', v)}
              acknowledged={acknowledged}
              onAcknowledge={(raw) => acknowledgeSpan('terapia', raw)}
              headerRight={
                <CopyButton
                  text={fields.terapia || ''}
                  disabled={isLocked}
                  onResult={notifyCopy}
                />
              }
            />

            {visibleSections['sec-izdadeni'] && (
              <div
                id="sec-izdadeni"
                className="bg-white rounded-2xl border p-6 scroll-mt-24"
                style={{ borderColor: 'var(--color-border)' }}
              >
                <SectionHead title="Издадени документи" />

                {visibleSections['sec-napravlenia'] && (
                  <div id="sec-napravlenia" className="mb-4 scroll-mt-24">
                    <SubsectionHead title="📋 Направления за консултация" />
                    <EditableField
                      value={fields.napravlenia || ''}
                      onChange={(v) => updateField('napravlenia', v)}
                    />
                  </div>
                )}

                {visibleSections['sec-naznacheni'] && (
                  <div id="sec-naznacheni" className="scroll-mt-24">
                    <SubsectionHead title="🔬 Назначени изследвания" />
                    <EditableField
                      value={fields.naznacheni || ''}
                      onChange={(v) => updateField('naznacheni', v)}
                    />
                  </div>
                )}
              </div>
            )}

            {fields._disclaimer && (
              <div
                className="text-xs px-3 py-2 rounded no-print"
                style={{
                  color: 'var(--color-text-hint)',
                  background: 'var(--color-bg-card)',
                  borderColor: 'var(--color-border)',
                  borderWidth: 1,
                }}
              >
                {fields._disclaimer}
              </div>
            )}
          </div>
        </main>

        {/* ─── Right: meds + safety + actions ─── */}
        <aside className="no-print">
          <div className="sticky top-[88px] space-y-4">
            <MedsPanel
              meds={fields.medications_list || []}
              onChange={onMedsChange}
              terapiaText={fields.terapia || ''}
              inlineCriticals={criticals}
              lastRemovedName={lastRemovedMedName}
              onClearRemovedHint={() => setLastRemovedMedName(null)}
              isLocked={isLocked}
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
                  className="text-xs uppercase tracking-wider mb-2 font-medium"
                  style={{ color: 'var(--color-gold)' }}
                >
                  ⚠ Предупреждения
                </div>
                <div className="space-y-2">
                  {warnings.map((a, i) => (
                    <WarningChip key={i} alert={a} />
                  ))}
                </div>
              </div>
            )}

            <div
              className="bg-white rounded-2xl border p-4"
              style={{ borderColor: 'var(--color-border)' }}
            >
              <div
                className="text-xs uppercase tracking-wider mb-3 font-medium"
                style={{ color: 'var(--color-text-hint)' }}
              >
                Действия
              </div>
              <Link
                href="/app/scribe"
                className="block text-center py-2.5 rounded-md text-white font-medium text-sm transition hover:opacity-90 mb-2"
                style={{ background: 'var(--gradient-brand)' }}
                onClick={() => {
                  sessionStorage.removeItem(RESULT_STORAGE_KEY);
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
                {isLocked ? '🔒' : '⎙'} Печат
              </button>
            </div>
          </div>
        </aside>
      </div>

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
        patientName={
          pendingVisit
            ? [pendingVisit.patient.first_name, pendingVisit.patient.last_name]
                .filter(Boolean)
                .join(' ')
            : undefined
        }
      />

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </AppShell>
  );
}

/* ──────────────────────────────────────────────────────────────── */

function CriticalChip({ alert }: { alert: SafetyAlert }) {
  return (
    <div
      className="flex items-start gap-3 px-3 py-2 rounded-md"
      style={{
        background: 'white',
        borderColor: 'var(--color-red)',
        borderWidth: 1,
      }}
    >
      <span className="text-lg flex-shrink-0">🚨</span>
      <div className="flex-1 min-w-0">
        <div
          className="text-xs font-bold uppercase tracking-wider"
          style={{ color: 'var(--color-red)' }}
        >
          Внимание!
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

function WarningChip({ alert }: { alert: SafetyAlert }) {
  return (
    <div
      className="flex items-start gap-2 px-2.5 py-2 rounded-md"
      style={{
        background: 'var(--color-gold-soft)',
        borderColor: 'var(--color-gold)',
        borderWidth: 1,
      }}
    >
      <span className="text-sm flex-shrink-0">⚠️</span>
      <div
        className="text-xs leading-snug"
        style={{ color: 'var(--color-text)' }}
      >
        <div
          className="font-semibold uppercase tracking-wide text-[10px] mb-0.5"
          style={{ color: 'var(--color-gold)' }}
        >
          Предупреждение
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
      <span>⚠</span>
      <span>{display}</span>
      <span style={{ fontSize: '14px' }}>▶</span>
    </button>
  );
}

function StatusBadge({
  status,
  popupOpen,
  onClick,
  onConfirm,
  onDismiss,
  blocked = false,
  blockHint,
}: {
  status: ReviewStatus;
  popupOpen: boolean;
  onClick: () => void;
  onConfirm: () => void;
  onDismiss: () => void;
  /** МКБ gate — when true, the confirm action is disabled (invalid/missing code). */
  blocked?: boolean;
  blockHint?: string;
}) {
  const isConfirmed = status === 'confirmed';
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
        {isConfirmed
          ? '✓ Потвърдено от лекар'
          : '🔒 Чака преглед — действията са заключени'}
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
            ✓ Вярно! Потвърждавам прегледа
          </button>
          <button
            onClick={onDismiss}
            className="text-left px-3 py-2 rounded-md text-sm transition hover:bg-[var(--color-bg)]"
            style={{ color: 'var(--color-text-muted)' }}
          >
            ✎ Ще редактирам още
          </button>
        </div>
      )}
    </div>
  );
}

function TopbarBtn({
  label,
  onClick,
  disabled,
  locked,
  lockedHint,
}: {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  locked?: boolean;
  lockedHint?: string;
}) {
  const finalDisabled = disabled || locked;
  return (
    <button
      onClick={onClick}
      disabled={finalDisabled}
      title={locked ? lockedHint : undefined}
      className="px-3 py-1.5 rounded-md text-sm font-medium border transition hover:bg-[var(--color-bg)] disabled:opacity-40 disabled:cursor-not-allowed"
      style={{
        borderColor: 'var(--color-border-mid)',
        color: 'var(--color-text-muted)',
      }}
    >
      {locked ? '🔒 ' : ''}
      {label}
    </button>
  );
}

function SectionHead({
  title,
  actions,
}: {
  title: string;
  actions?: React.ReactNode;
}) {
  if (actions) {
    return (
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2
          className="text-xl font-semibold"
          style={{ color: 'var(--color-ink)' }}
        >
          {title}
        </h2>
        <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>
      </div>
    );
  }
  return (
    <h2
      className="text-xl font-semibold mb-4"
      style={{ color: 'var(--color-ink)' }}
    >
      {title}
    </h2>
  );
}

function SubsectionHead({ title }: { title: string }) {
  return (
    <div
      className="text-sm font-semibold uppercase tracking-wider mb-2"
      style={{ color: 'var(--color-brand)' }}
    >
      {title}
    </div>
  );
}

function TextSection({
  id,
  title,
  value,
  onChange,
  fieldKey,
  acknowledged,
  onAcknowledge,
  headerRight,
}: {
  id: string;
  title: string;
  value: string;
  onChange: (v: string) => void;
  fieldKey?: string;
  acknowledged?: Set<string>;
  onAcknowledge?: (raw: string) => void;
  headerRight?: React.ReactNode;
}) {
  return (
    <div
      id={id}
      className="bg-white rounded-2xl border p-6 scroll-mt-24"
      style={{ borderColor: 'var(--color-border)' }}
    >
      <SectionHead title={title} actions={headerRight} />
      <EditableField
        value={value}
        onChange={onChange}
        fieldKey={fieldKey}
        acknowledged={acknowledged}
        onAcknowledge={onAcknowledge}
      />
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
  isLocked,
  notifyCopy,
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
  isLocked: boolean;
  notifyCopy: (ok: boolean) => void;
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
    <div
      id="sec-diag"
      className="bg-white rounded-2xl border p-6 scroll-mt-24"
      style={{ borderColor: 'var(--color-border)' }}
    >
      <SectionHead title="Диагнози МКБ-10" />

      <div className="mb-4 pb-4 border-b" style={{ borderColor: 'var(--color-border)' }}>
        <div
          className="text-xs uppercase tracking-wider mb-2 font-medium"
          style={{ color: 'var(--color-text-hint)' }}
        >
          Основна диагноза
        </div>
        <div className="flex items-center gap-2">
          <MkbTypeahead
            code={osnovnaMkb}
            term={mainTerm}
            invalid={needsReview}
            placeholder="Търсене на диагноза или МКБ код…"
            onPick={onOsnovnaPick}
            onBrowse={onOsnovnaBrowse}
          />
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
          <div className="mt-1.5 text-xs px-1" style={{ color: 'var(--color-text-hint)' }}>
            доктор каза: {originalSpoken}
          </div>
        )}
        {!needsReview && termSource === 'parent' && osnovnaMkbTerm && (
          <div className="mt-1 text-[11px] px-1" style={{ color: 'var(--color-text-hint)' }}>
            категория по МКБ-10 (3-знача рубрика)
          </div>
        )}
        {needsReview && (
          <div
            role="alert"
            className="mt-2 rounded-md border px-3 py-2"
            style={{ borderColor: 'var(--color-red)', background: 'var(--color-red-soft)', color: 'var(--color-red)' }}
          >
            <div className="text-sm font-semibold">
              ⚠{' '}
              {mkbReview?.reason === 'missing_code' ? 'Липсва код по МКБ-10' : 'Невалиден код по МКБ-10'}
            </div>
            <div className="text-xs mt-0.5">
              {mkbReview?.reason === 'missing_code'
                ? 'Изберете диагноза от МКБ-10 (търсете или 🔍). Потвърждаването и експортът са блокирани, докато липсва код.'
                : `Кодът „${mkbReview?.code || osnovnaMkb}“ не е в МКБ-10 регистъра. Изберете валиден (търсете или 🔍). Потвърждаването и експортът са блокирани.`}
            </div>
          </div>
        )}
      </div>

      <div
        className="text-xs uppercase tracking-wider mb-3 font-medium flex items-center justify-between"
        style={{ color: 'var(--color-text-hint)' }}
      >
        <span>Придружаващи заболявания{atMaxComorbidities ? ' · макс 4' : ''}</span>
        <button
          onClick={onComorbidityAddBrowse}
          disabled={atMaxComorbidities}
          title={atMaxComorbidities ? 'Макс 4 придружаващи заболявания' : undefined}
          className="text-xs font-semibold px-2 py-1 rounded transition hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:opacity-40"
          style={{ color: 'var(--color-brand)', background: 'var(--color-brand-soft)' }}
        >
          + Добави
        </button>
      </div>
      <div className="space-y-2">
        {pridruzhavashti.map((d, i) => (
          <MkbTypeahead
            key={i}
            code={d.mkb}
            term={filedComorbidityTerm(d)}
            placeholder="Търсене на придружаващо заболяване…"
            onPick={(code, term) => onComorbidityPick(i, code, term)}
            onBrowse={() => onComorbidityBrowse(i)}
            onRemove={() => onComorbidityRemove(i)}
          />
        ))}
        {pridruzhavashti.length === 0 && (
          <div className="text-sm px-3 py-1" style={{ color: 'var(--color-text-hint)' }}>
            Няма придружаващи заболявания.
          </div>
        )}
      </div>
    </div>
  );
}

// PatientHeaderStrip + visitTypeLabel previously lived here as local functions;
// extracted to components/PatientHeaderStrip.tsx so /app/scribe and
// /app/scribe/result render the exact same strip from one source.
