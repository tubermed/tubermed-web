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

export interface ComorbidDiagnosis {
  diagnoza: string;
  mkb: string;
  mkb_term?: string;          // official label for a valid comorbidity code (derived)
}

export interface MedAlert {
  drug: string;
  severity: 'CRITICAL' | 'WARNING' | 'INFO';
  reason: string;
  action: string;
}

// МКБ code-validity gate state (Bug 1). NOTE: divergence_advisory is deliberately
// NOT part of the client surface — it must never be shown to the doctor.
export interface MkbReview {
  needs_review: boolean;
  reason?: 'invalid_code' | 'missing_code';
  code?: string;
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
  pridruzhavashti?: ComorbidDiagnosis[];
  napravlenia?: string;
  naznacheni?: string;
  uncertain_spans?: UncertainSpan[];
  med_alerts?: MedAlert[];
  mkb_review?: MkbReview;                          // derived: code-validity gate state
  _disclaimer?: string;
}

export interface TranscribeResult {
  consultationId: string;
  transcript: string;
  fields: TranscribeFields;
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
  | { type: 'result'; consultationId: string; transcript: string; fields: TranscribeFields }
  | { type: 'error'; message: string };

// ── Patient / Visit (Phase 2) ────────────────────────────────────────────────

export type NationalIdType = 'egn' | 'lnch' | 'foreign' | 'none';
export type Gender         = 'male' | 'female' | 'other' | 'unknown';
export type VisitType      = 'first' | 'followup' | 'urgent' | 'preventive' | 'remote';
export type Locale         = 'bg';
export type InsuranceStatus = 'nzok' | 'private' | 'uninsured' | (string & {});

export interface PatientSearchHit {
  id: string;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  birth_date: string | null;
  national_id_last4: string | null;
  national_id_type?: NationalIdType;
}

export interface PatientSummary {
  id: string;
  organization_id: string;
  created_by_doctor_id: string | null;
  national_id_type: NationalIdType;
  national_id_last4: string | null;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  birth_date: string | null;
  gender: Gender | null;
  allergies: string[];
  chronic_conditions: string[];
  insurance_status: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface LastVisitSummary {
  id: string;
  status: string;
  created_at: string;
  started_at: string | null;
  note_generated_at: string | null;
  exported_at: string | null;
  osnovna_diagnoza: string | null;
  osnovna_mkb: string | null;
  visit_type: VisitType | null;
  chief_complaint: string | null;
  source_device: string | null;
}

export interface PatientDetailResponse {
  patient: PatientSummary;
  last_visits: LastVisitSummary[];
}

export interface PatientSearchResponse {
  patients: PatientSearchHit[];
  match: 'recent' | 'national_id_exact' | 'national_id_last4' | 'name_fuzzy' | 'none';
  hint?: string;
}

export interface CreatePatientPayload {
  national_id?: string;
  national_id_type: NationalIdType;
  first_name: string;
  middle_name?: string | null;
  last_name: string;
  birth_date?: string | null;
  gender?: Gender | null;
  allergies?: string[];
  chronic_conditions?: string[];
  insurance_status?: string | null;
  notes?: string | null;
  force?: boolean;
}

export interface CreatePatientSuccess {
  patient: PatientSummary;
  validation_warning: string | null;
}

export interface DedupConflict {
  error: string;
  possible_duplicates: PatientSearchHit[];
  matched_on: 'name+dob' | 'name_only';
}

export interface UpdatePatientPayload {
  first_name?: string;
  middle_name?: string | null;
  last_name?: string;
  birth_date?: string | null;
  gender?: Gender | null;
  allergies?: string[];
  chronic_conditions?: string[];
  insurance_status?: string | null;
  notes?: string | null;
  national_id?: string;
  national_id_type?: NationalIdType;
}

export interface RevealNationalIdResponse {
  national_id: string | null;
  national_id_type: NationalIdType;
}

export interface VisitStartPayload {
  patient_id: string;
  chief_complaint?: string | null;
  visit_type?: VisitType | null;
}

export interface VisitStartResponse {
  consultation_id: string;
  patient_summary: PatientSummary;
}

export interface TodayPatientStub {
  id: string;
  first_name: string;
  middle_name: string | null;
  last_name: string;
}

export interface TodayConsultation {
  id: string;
  status: string;
  created_at: string;
  started_at: string | null;
  exported_at: string | null;
  osnovna_diagnoza: string | null;
  visit_type: VisitType | null;
  chief_complaint: string | null;
  patient: TodayPatientStub | null;
}

export interface TodayResponse {
  date: string;
  total: number;
  done: number;
  consultations: TodayConsultation[];
}

// ── Patient history (Phase 3) ────────────────────────────────────────────────
// Lightweight summary returned by GET /api/patients/:id/consultations.
// Deliberately a subset of LastVisitSummary so the paginated list payload
// stays small — full note fetched on click via GET /api/consultations/:id.
export interface PatientConsultationSummary {
  id: string;
  status: string;
  created_at: string;
  visit_type: VisitType | null;
  osnovna_diagnoza: string | null;
  chief_complaint: string | null;
}

export interface PatientConsultationsResponse {
  consultations: PatientConsultationSummary[];
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
  // patient_id + consent_to_record_at are additive fields the GET /:id handler
  // now returns (cross-repo: tubermed-backend). They drive cold-start recovery:
  // patient_id lets the frontend re-fetch the full PatientSummary for the header;
  // consent_to_record_at suppresses a redundant consent re-prompt on recovery.
  // patient_id is nullable — legacy / never-staged rows have none (treated as
  // unrecoverable by useColdStartRecovery).
  patient_id: string | null;
  status: string;
  created_at: string;
  started_at: string | null;
  exported_at: string | null;
  consent_to_record_at: string | null;
  visit_type: VisitType | null;
  chief_complaint: string | null;
  // Phase 2 Step D — osnovna_diagnoza / osnovna_mkb are no longer separate
  // columns on consultations; read them from `note.osnovna_diagnoza` /
  // `note.osnovna_mkb` (the JSONB extracted_fields).
  note: TranscribeFields | null;
}

export interface ConsultationDetailResponse {
  consultation: ConsultationDetail;
}

// Stored in sessionStorage to carry patient context from /app/new-visit
// through /app/scribe to /app/scribe/result. The page that finds this absent
// on /app/scribe redirects back to /app/new-visit (no recovery path yet).
export interface PendingVisit {
  consultation_id: string;
  patient: PatientSummary;
  visit_metadata: {
    chief_complaint: string | null;
    visit_type: VisitType | null;
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
