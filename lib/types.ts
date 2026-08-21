// Backend response types — keep in sync with /api/transcribe shape.

export interface UncertainSpan {
  field: string;
  start: number;
  end: number;
  original: string;
  suggestion?: string;
  reason?: string;
}

export interface Medication {
  inn: string;
  dose?: string;
  regimen?: string;
  route?: string;
  duration?: string;
}

// What happened to a code, whenever what we FILED differs from what the model
// EMITTED. Written by the backend (validateMkbCodes / repairCmExtendedCodes /
// correctUsOnlyCodes / G6); never by the browser.
//
// `rule` is a CLOSED enum, never a model-authored string — the Bulgarian a
// doctor reads is rendered from the enum on this side, so no clinical judgement
// can travel through this channel. Same posture as field_notices' NOTICE_CODES.
export type MkbCorrectionRule =
  | 'icd10cm_truncated'      // a US ICD-10-CM extended form reduced to МКБ-10 granularity
  | 'us_only_mapped'         // Z87.891 / F17.210 / M54.50 → the international twin
  | 'invalid_code_stripped'  // neither the code nor its rubric is in the register
  | 'obstetric_no_context';  // O-chapter code with no pregnancy context in the transcript

export interface MkbCorrection {
  /** The code exactly as the model emitted it. The audit trail. */
  from: string;
  /** The code actually filed. ABSENT when nothing was filed (a strip). */
  to?: string;
  rule: MkbCorrectionRule;
}

export interface ComorbidDiagnosis {
  diagnoza: string;
  // OPTIONAL — the backend STRIPS an invalid comorbidity code by DELETING this
  // key (validateMkbCodes / G6, `delete entry.mkb`), never by blanking it to ''.
  // Absent means "this comorbidity has no code"; an empty string would mean "a
  // code field that is blank", and only the first is true. Readers must treat
  // absence as no-code and must not dereference this unguarded — a filed лист
  // carries legal weight, so `undefined` reaching a render is a defect, not a
  // cosmetic slip.
  mkb?: string;
  mkb_term?: string;          // official label for a valid comorbidity code (derived)
  /** Present only when this code was repaired or stripped. See MkbCorrection. */
  mkb_correction?: MkbCorrection;
}

export interface MedAlert {
  drug: string;
  severity: 'CRITICAL' | 'WARNING' | 'INFO';
  reason: string;
  action: string;
}

// ── Administrative completeness (2026-08-03) ─────────────────────────────────
//
// NOT a clinical alert, and the separation is STRUCTURAL so it cannot drift into
// one. THE RULE: it may state WHAT IS MISSING, never WHAT IT SHOULD BE.
//
//   allowed (describes the DOCUMENT)   forbidden (describes the PATIENT)
//   „Метформин — няма посочена доза"    „Обичайната доза е 500 mg"
//   „Няма посочена честота"            „Дозата изглежда висока"
//   a count of incomplete rows          any ordering by clinical importance
//
// An entry carries ONLY an index and an enum — deliberately no `severity`, no
// `suggested_value`, no free-text `message` — so there is no channel through
// which a dose or a risk judgement could ever reach the screen. The Bulgarian
// text comes from FIELD_COMPLETENESS_LABELS below, never from the model, and
// the backend guard (scripts/alert-guard.js `guardCompleteness`) fails the
// harness if any other key ever appears. Mirrors backend
// lib/field-completeness.js — change them together.
//
// RENDERING: the `AI несигурен` visual family — neutral, quiet, the same
// treatment as the existing uncertainty marks. Never red, never a warning icon,
// never `КРИТИЧНО`. A depiction is a claim.
export type FieldCompletenessField = 'dose' | 'regimen' | 'duration';

export interface FieldCompletenessEntry {
  medication_index: number;          // index into medications_list
  missing_field: FieldCompletenessField;
}

export const FIELD_COMPLETENESS_LABELS: Record<FieldCompletenessField, string> = {
  dose:     'няма посочена доза',
  regimen:  'няма посочена честота',
  duration: 'няма посочена продължителност',
};

// МКБ code-validity gate state (Bug 1). NOTE: divergence_advisory is deliberately
// NOT part of the client surface — it must never be shown to the doctor.
export interface MkbReview {
  needs_review: boolean;
  // 'diagnosis_text_not_grounded' (P0-01): the code is valid but the MAIN diagnosis
  // text isn't supported by the transcript — flagged by the backend grounding pass.
  reason?: 'invalid_code' | 'missing_code' | 'diagnosis_text_not_grounded';
  code?: string;
}

// ── Echo readout shape (note_type='echo') ────────────────────────────────────
// A DIFFERENT JSONB shape from TranscribeFields — measurements ({value,unit})
// nested under izmervania.* / klapi.<valve>.*, plus free-text sections, and NO
// diagnosis/МКБ key anywhere by construction. Produced by the backend echo
// template (lib/templates/echo-v1.js); the display descriptor is mirrored in
// lib/echo-template.ts. Fields are optional — an unmeasured field is absent/empty.
export interface EchoMeasurement {
  value: string;
  unit: string;
}

export interface EchoValve {
  opisanie?: string;
  regurgitatsia?: string;
  vmax?: EchoMeasurement;
  sreden_gradient?: EchoMeasurement;
  ava?: EchoMeasurement;
  mva?: EchoMeasurement;
  tr_vmax?: EchoMeasurement;
}

export interface EchoFields {
  izmervania?: Record<string, EchoMeasurement>;
  fi_metod?: string;
  segmentna_kinetika?: string;
  mpp?: string;
  klapi?: {
    aortna?: EchoValve;
    mitralna?: EchoValve;
    trikuspidalna?: EchoValve;
    pulmonalna?: EchoValve;
  };
  zakljuchenie?: string;
  uncertain_spans?: UncertainSpan[];
  _template?: string;
  _disclaimer?: string;
}

// ── Embedded investigation blocks (fields.izsledvania_blocks) ────────────────
// NEW OPTIONAL sibling key on TranscribeFields — `izsledvania`/`naznacheni`
// stay flat strings exactly as today. The backend does not emit this yet; the
// frontend ships the tolerant reader first so old rows (key absent) keep
// rendering and exporting byte-identically. Display descriptors live in
// lib/investigation-blocks.ts (registry keyed by `type`).
export interface InvestigationBlockSource {
  method: string;   // segmentation pass identifier, e.g. 'segmentation-v1'
  start: number;    // char offsets into consultations.transcript —
  end: number;      // offsets only, never quoted text (no second PII store)
}

export interface InvestigationBlock {
  type: string;       // block-registry key (note_type vocabulary), e.g. 'echo'
  template: string;   // template version stamp (from fields._template), e.g. 'echo-v1'
  // For type='echo' this is byte-compatible with the standalone-echo
  // extracted_fields (nested izmervania.* / klapi.<valve>.*), incl. block-local
  // uncertain_spans whose `field` keys are dot-paths RELATIVE to this object.
  fields: EchoFields;
  source?: InvestigationBlockSource;
}

// ── Per-field source provenance (fields.field_sources) ──────────────────────
// OPTIONAL sibling key on TranscribeFields (trust layer Batch B). Char offsets
// into consultations.transcript (the RAW transcript) — offsets only, never
// quoted text (quotes are resolved server-side and dropped; no second PII
// store — same discipline as InvestigationBlockSource above). Keys: 'vitals',
// 'osnovna_diagnoza', 'napravlenia', 'medications_list.<i>' (index-aligned to
// medications_list), 'izsledvania.<i>', 'naznacheni.<i>' (span enumeration —
// the note fields stay prose strings). Narrative fields (anamneza, obektivno
// prose) are deliberately never sourced. Absent on every legacy row; readers
// must treat absence as "no resolved sources".
export interface FieldSource {
  method: string;   // resolver identifier, e.g. 'quote-v1'
  start: number;
  end: number;
}

// ── Document-state notices (fields.field_notices) ───────────────────────────
// A notice states a fact about the DOCUMENT, never about the PATIENT. The shape
// is the guarantee: a closed-enum `code` plus a `{ field, index }` ref, and
// nothing else — no severity, no message, no suggested value, no model-authored
// string. The Bulgarian a doctor reads is rendered from the frozen label table
// in lib/field-notices.ts, keyed by the enum.
// ⚠ CROSS-REPO MIRROR of backend lib/field-notices.js — the enum and the label
// table must change in BOTH repos together (same discipline as the investigation
// templates and ial-inns.json/mkb10.json).
export type FieldNoticeCode = 'allergen_no_anchor';

export interface FieldNoticeRef {
  field: 'alergii';
  index: number;
}

export interface FieldNotice {
  code: FieldNoticeCode;
  ref: FieldNoticeRef;
}

export interface TranscribeFields {
  anamneza?: string;
  alergii?: string[];
  obektivno?: string;
  izsledvania?: string;
  terapia?: string;
  medications_list?: Medication[];
  osnovna_diagnoza?: string;
  osnovna_mkb?: string;
  osnovna_mkb_term?: string;                      // derived: canonical official label
  osnovna_mkb_term_source?: 'exact' | 'parent';   // derived: which form matched the register
  /** Present only when the main code was repaired or rewritten. See MkbCorrection. */
  osnovna_mkb_correction?: MkbCorrection;
  pridruzhavashti?: ComorbidDiagnosis[];
  napravlenia?: string;
  naznacheni?: string;
  // OPTIONAL — present only once the backend emits embedded investigation
  // blocks; absent on every legacy row. Readers must treat absence as "no
  // blocks" and change nothing else about how the row renders/exports.
  izsledvania_blocks?: InvestigationBlock[];
  uncertain_spans?: UncertainSpan[];
  field_sources?: Record<string, FieldSource>;    // see FieldSource above; absent on legacy rows
  field_completeness?: FieldCompletenessEntry[];  // see the interface above; ABSENT when nothing is missing
  // Document-state notices (2c). Unlike every other optional key here this one
  // is ALWAYS PRESENT on a freshly-extracted or freshly-edited note — `[]` means
  // „the check ran and found nothing", where absent would mean „unknown". It is
  // still optional in the type because every legacy row predates it.
  // ⚠ CROSS-REPO MIRROR: backend lib/field-notices.js. Read-only to the client:
  // derived server-side, re-anchored server-side on /edit. Never author or
  // mutate entries here, and never store acknowledgement state inside `fields`.
  field_notices?: FieldNotice[];
  med_alerts?: MedAlert[];
  mkb_review?: MkbReview;                          // derived: code-validity gate state
  // Content that arrived in a shape it could not be placed into. ABSENT
  // whenever nothing was lost — a lossless repair is not a problem the doctor
  // needs to see. ⚠ CROSS-REPO MIRROR: backend lib/note-shape.js
  // (`coerceNoteShape`). Read-only to the client: written at the extraction
  // write boundary, never authored here.
  shape_repairs?: NoteShapeRepair[];
  _disclaimer?: string;
}

/** One field whose emitted type diverged from the declared one, and what was
 *  done about it. `text` carries clinical content the doctor dictated and that
 *  had no faithful place in the declared type — show it, never log it. */
export interface NoteShapeRepair {
  field: string;
  got: string;
  /** 'joined' | 'wrapped' | 'emptied' | 'quarantined' | 'dropped' */
  recovery: string;
  text?: string;
}

export interface TranscribeResult {
  consultationId: string;
  transcript: string;
  fields: TranscribeFields;
}

/** POST /api/consultations/:id/stream-key — the browser's ticket to Soniox.
 *
 *  `ws_url` and `config` are SERVER-AUTHORED on purpose: the EU endpoint and
 *  the specialty vocabulary payload must be identical to the async leg's and
 *  must not be reconstructible (or driftable) in frontend code. The client
 *  merges `api_key` into `config` as the websocket's first frame and otherwise
 *  treats both as opaque. */
export interface StreamKeyResponse {
  api_key: string;
  expires_at: string | null;
  ws_url: string;
  config: Record<string, unknown>;
}

export interface SessionInit {
  sessionId: string;
  mobileUrl: string;
  expiresAt: string;
}

export type SessionStatus =
  | { status: 'waiting' }
  | { status: 'processing' }
  | { status: 'done'; result: TranscribeResult }
  | { status: 'error'; error_msg?: string };

export type WsMessage =
  | { type: 'processing' }
  // B3 — the phone scanned the QR; the backend extended the session TTL to a
  // record window (up to ~30 min) and the PC stops re-minting, honouring expiresAt.
  | { type: 'scanned'; expiresAt: string }
  | { type: 'result'; consultationId: string; transcript: string; fields: TranscribeFields }
  // `code` is an optional machine discriminator on the error payload — today
  // 'no_speech' (Soniox produced no transcribable speech), so the PC can show a
  // calm re-record message instead of the generic failure/recovery panel. The
  // backend also sends statusCode:502 on Anthropic exhaustion (not read here).
  | { type: 'error'; message: string; code?: string };

// ── Visit staging + notes library ────────────────────────────────────────────
// TuberMed keeps no patient records: there is no patients table access, no
// identity field, and no patient type anywhere in the app (identity removal,
// 2026-07). A visit is described only by its own metadata.

export type VisitType      = 'first' | 'followup' | 'urgent' | 'preventive' | 'remote';
// Document template discriminator (backend migration 020 / lib/note-type.js).
// 'consultation' = the Амбулаторен лист; 'echo' = the echocardiography readout
// (no diagnosis/МКБ shape). Default 'consultation' everywhere.
export type NoteType       = 'consultation' | 'echo';
// Note length (backend migration 028 / lib/note-verbosity.js). Prompt-level
// only: the free-prose fields change wording, never coverage; structured
// fields never change. 'tochno' is the default and today's behaviour.
export type NoteVerbosity  = 'kratko' | 'tochno' | 'podrobno';
export type Locale         = 'bg';

export interface VisitStartPayload {
  chief_complaint?: string | null;
  visit_type?: VisitType | null;
  // Document template. Omitted/'consultation' → the default Амбулаторен лист;
  // the backend only writes the column for non-default rows (visits/start).
  note_type?: NoteType | null;
  // Per-visit note-length override. Omitted/null → the doctor's default
  // (doctors.note_verbosity); the backend writes the column only when set.
  note_verbosity?: NoteVerbosity | null;
}

export interface VisitStartResponse {
  consultation_id: string;
}

// ── Notes library (identity-free) ───────────────────────────────────────────
// Summary row returned by GET /api/consultations — the visit's auto-generated
// label data (time, type, complaint, diagnosis, status). Full note fetched on
// click via GET /api/consultations/:id.
export interface ConsultationListItem {
  id: string;
  status: string;
  created_at: string;
  started_at: string | null;
  exported_at: string | null;
  visit_type: VisitType | null;
  chief_complaint: string | null;
  osnovna_diagnoza: string | null;
  /** Article-17 erasure marker. Non-null = the clinical content was scrubbed on
   *  request. The row must SAY so: an erased note and a note that never
   *  generated one both arrive with osnovna_diagnoza null, and rendering a
   *  requested erasure as an empty visit reads as „нищо не се получи".
   *  Optional — a backend without migration 022 omits the key entirely. */
  erased_at?: string | null;
}

export interface ConsultationListResponse {
  consultations: ConsultationListItem[];
  total: number;
  has_more: boolean;
  offset: number;
  limit: number;
}

// Returned by GET /api/consultations/:id. `note` reuses TranscribeFields —
// the same shape /api/transcribe produces and /edit overwrites — so the
// read-only history viewer can share field-rendering with the result page.
// `note: null` is the normal empty case for pending/error/abandoned visits.
export interface ConsultationDetail {
  id: string;
  // consent_to_record_at drives cold-start recovery: it suppresses a redundant
  // consent re-prompt after a hard refresh. (The row's patient_id, still
  // returned by the backend until the column is dropped, is ignored here.)
  status: string;
  created_at: string;
  started_at: string | null;
  exported_at: string | null;
  consent_to_record_at: string | null;
  // Approval state, restored on cold-start recovery. Without it, reopening an
  // already-approved note from the notes library rendered it as unconfirmed
  // and LOCKED Копирай/Печат/PDF on a note the doctor had already filed —
  // /approve is idempotent, so the re-confirm it forced was pure friction.
  // A sealed note must stay usable, which makes this load-bearing.
  note_approved: boolean;
  note_approved_at: string | null;
  // The visit-over seal (backend migration 024). Non-null = the лист is closed
  // for editing, permanently: POST /:id/edit answers 409 note_sealed. It stays
  // fully usable — copy / print / PDF / export are deliberately NOT gated —
  // and fully erasable. `null` on any server without 024 applied (the backend
  // reads it fail-soft), so the UI must treat null as „still open".
  sealed_at: string | null;
  // Article-17 erasure marker (backend migration 022). Non-null = the clinical
  // content was scrubbed on request; the row skeleton and the consent/approval
  // timestamps survive. Distinguishes „изтрито по заявка" from a note that
  // never generated one — both arrive here as note: null.
  erased_at: string | null;
  visit_type: VisitType | null;
  // Document template (backend migration 020, via the fail-soft reader). Always
  // present — 'consultation' on legacy/un-migrated rows. Drives the result
  // page's echo-vs-Амбулаторен-лист branch on cold-start recovery.
  note_type: NoteType;
  chief_complaint: string | null;
  // Phase 2 Step D — osnovna_diagnoza / osnovna_mkb are no longer separate
  // columns on consultations; read them from `note.osnovna_diagnoza` /
  // `note.osnovna_mkb` (the JSONB extracted_fields).
  note: TranscribeFields | null;
}

// Which sections the DOCTOR has edited, derived server-side from the withheld
// ai_original_fields snapshot vs the working copy (backend lib/fields-touched.js,
// 2026-08-21). true = edited (no tint); false = still the model's wording
// (tinted). `null` = the row has no snapshot (pre-migration-004 / erased) → no
// tint at all. Booleans only — the server pins the shape. READ-ONLY to the
// client: derived server-side, never authored or posted back; it is a SIBLING
// of `consultation`, never part of `note`, precisely so /edit can't carry it.
export type FieldsTouched = Record<string, boolean>;

export interface ConsultationDetailResponse {
  consultation: ConsultationDetail;
  // ABSENT on an older backend; null when the row has no snapshot.
  fields_touched?: FieldsTouched | null;
}

// Stored in sessionStorage to carry visit context from /app/new-visit
// through /app/scribe to /app/scribe/result. On a hard refresh the pages
// rebuild it from the URL via useColdStartRecovery.
export interface PendingVisit {
  consultation_id: string;
  // Staging timestamp (ISO) — rendered in the visit header strip.
  created_at?: string | null;
  visit_metadata: {
    chief_complaint: string | null;
    visit_type: VisitType | null;
    note_type: NoteType;
  };
  // Filled in once the doctor records patient consent on /app/scribe.
  // Survives a tab refresh so the ConsentModal does not nag a doctor who
  // already consented in this session. The backend keeps the authoritative
  // timestamp on consultations.consent_to_record_at — this is a UI hint.
  consent_to_record_at?: string | null;
}

// Payload for POST /api/consultations/:id/export.
// Per-consultation edit rollup computed in the result page as the doctor
// edits, sent on export. The backend persists both counters to
// consultations.total_chars_edited / .fields_edited_count (migration 003).
//
// Counter semantics (see app/app/scribe/result/page.tsx for the
// accumulators):
//   - total_chars_edited      sum across edited fields of
//                              |final_value.length - ai_original.length|.
//                              Undo-resistant: an edit that returns the
//                              field to its AI-extracted value contributes 0.
//   - fields_edited_count     count of DISTINCT field keys that received
//                              at least one commit (does not decrease on undo).
//
// Medication-copy events are NOT carried here — they have their own route
// (POST /api/consultations/:id/meds-copied) so copies on consultations
// that never get exported are still captured.
export interface ExportSignalPayload {
  format: 'pdf' | 'docx' | 'copy' | 'print';
  total_chars_edited: number;
  fields_edited_count: number;
}

// Response from POST /api/consultations/:id/consent.
// First call: idempotent=false with a freshly-stamped timestamp.
// Subsequent calls: idempotent=true with the SAME timestamp — the first
// consent instant is the legal record and is never overwritten.
export interface ConsentResponse {
  ok: true;
  consent_to_record: true;
  consent_to_record_at: string;   // ISO-8601 / TIMESTAMPTZ — render in Europe/Sofia on display
  idempotent: boolean;
}

// Mirrors POST /api/consultations/:id/approve. Backend is idempotent — first
// timestamp wins, subsequent calls return `idempotent: true` with the original
// `note_approved_at`. Required gate for /export (server returns 403 otherwise).
export interface ApproveResponse {
  ok: true;
  note_approved: true;
  note_approved_at: string;       // ISO-8601 / TIMESTAMPTZ
  idempotent: boolean;
}

// Mirrors POST /api/consultations/:id/edit. The backend re-runs validateMkbCodes
// on the edited fields and echoes the re-validated МКБ state so the frontend can
// reflect the (cleared/set) block without a re-fetch.
export interface EditConsultationResponse {
  ok: boolean;
  edit_count?: number;
  mkb_review?: MkbReview | null;
  osnovna_mkb_term?: string | null;
  osnovna_mkb_term_source?: 'exact' | 'parent' | null;
  // Derived after the edit landed (see FieldsTouched). Absent on failure or
  // on the echo document — the client keeps its optimistic state then.
  fields_touched?: FieldsTouched | null;
}

// Response from POST /api/consultations/:id/patient-summary (A2).
// `summary` is the plain-language Bulgarian after-visit text (includes the
// mandatory disclaimer line). `cached` is true when the backend returned a
// previously-generated summary without spending tokens; false on a fresh
// generation. The endpoint is gated on note_approved=true (403 +
// patient_summary_blocked_no_approval otherwise).
export interface PatientSummaryResponse {
  ok: true;
  cached: boolean;
  summary: string;
  generated_at: string | null;    // ISO-8601 / TIMESTAMPTZ
}

// Response from POST /api/consultations/:id/retry-extraction (A3 recovery).
// Re-runs ONLY the Claude extraction stage against the transcript that was
// persisted when the original generation failed AFTER Soniox succeeded — so
// the doctor never has to re-record. Backend preconditions: status='error' AND
// transcript IS NOT NULL, else 409 (nothing to resurrect → caller must offer a
// fresh recording). 502 means the upstream (Anthropic) is still down and the
// transcript is kept on the row for a later retry. On 200 the row flips to
// 'generated'; `fields` is the resurrected note (the result page also re-reads
// it from the server via ?visit=, so callers can simply navigate there).
export interface RetryExtractionResponse {
  ok: true;
  fields: TranscribeFields;
}

// Response from GET /api/consultations/:id/transcript — the failed-extraction
// escape hatch. Returned ONLY while the row is stuck in status='error'; a
// healthy note answers 409, as does a visit whose transcript is absent or was
// erased (Article 17 outranks recovery). The body carries the raw transcript
// and nothing else — no extracted_fields, no ai_original_fields. This is the
// SAME text the browser already receives on the happy path via
// TranscribeResponse.transcript, so it is not a new exposure class.
export interface FailedTranscriptResponse {
  status: 'error';
  transcript: string;
}
