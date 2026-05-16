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
}

export interface MedAlert {
  drug: string;
  severity: 'CRITICAL' | 'WARNING' | 'INFO';
  reason: string;
  action: string;
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
  pridruzhavashti?: ComorbidDiagnosis[];
  napravlenia?: string;
  naznacheni?: string;
  uncertain_spans?: UncertainSpan[];
  med_alerts?: MedAlert[];
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
export type Template       = 'general';
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
  template?: Template;
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

// Stored in sessionStorage to carry patient context from /app/new-visit
// through /app/scribe to /app/scribe/result. The page that finds this absent
// on /app/scribe redirects back to /app/new-visit (no recovery path yet).
export interface PendingVisit {
  consultation_id: string;
  patient: PatientSummary;
  visit_metadata: {
    chief_complaint: string | null;
    visit_type: VisitType | null;
    template: Template;
  };
}
