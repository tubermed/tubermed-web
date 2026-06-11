// Thin fetch wrapper for the Railway backend.

import type {
  TranscribeResult,
  SessionInit,
  SessionStatus,
  TranscribeFields,
  PatientSearchResponse,
  PatientDetailResponse,
  PatientSummary,
  CreatePatientPayload,
  CreatePatientSuccess,
  DedupConflict,
  UpdatePatientPayload,
  RevealNationalIdResponse,
  VisitStartPayload,
  VisitStartResponse,
  TodayResponse,
  ConsentResponse,
  ApproveResponse,
  EditConsultationResponse,
  ExportSignalPayload,
  ConsultationDetailResponse,
  PatientConsultationsResponse,
  PatientSummaryResponse,
  RetryExtractionResponse,
} from './types';

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL!;
const STORAGE_KEY = 'tuber_auth';

export interface DoctorInfo {
  id: string;
  name: string;
  specialty?: string;
  clinic?: string;
  org_slug?: string;
}

export interface Session {
  token: string;
  doctor: DoctorInfo;
}

// "Запомни ме" (A4 UX): remember=true (the default — and the pre-checkbox
// behavior) keeps the session in localStorage, surviving a browser restart
// for the JWT's 30 days; remember=false keeps it in sessionStorage, gone when
// the browser session ends. Purely WHERE the client stores the token — the
// JWT itself and its expiry are untouched. getSession reads both locations;
// setSession always clears the other one so a stale copy can't resurrect an
// older identity; clearSession (logout) wipes both.

export function getSession(): Session | null {
  if (typeof window === 'undefined') return null;
  const raw =
    localStorage.getItem(STORAGE_KEY) ?? sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

export function setSession(s: Session, remember: boolean = true): void {
  const target = remember ? localStorage : sessionStorage;
  const other = remember ? sessionStorage : localStorage;
  target.setItem(STORAGE_KEY, JSON.stringify(s));
  other.removeItem(STORAGE_KEY);
}

export function clearSession(): void {
  localStorage.removeItem(STORAGE_KEY);
  sessionStorage.removeItem(STORAGE_KEY);
}

export function getToken(): string | null {
  return getSession()?.token ?? null;
}

export class ApiError extends Error {
  /** Parsed JSON body, if any. Useful for endpoints whose 4xx is data, not text. */
  public readonly body: unknown;
  constructor(public status: number, message: string, body?: unknown) {
    super(message);
    this.body = body;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (options.body && !headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json; charset=utf-8');
  }

  const res = await fetch(`${BACKEND}${path}`, { ...options, headers });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const msg = (data && typeof data === 'object' && 'error' in data && typeof (data as { error: unknown }).error === 'string')
      ? (data as { error: string }).error
      : `HTTP ${res.status}`;
    throw new ApiError(res.status, msg, data);
  }
  return data as T;
}

// ── Endpoints ───────────────────────────────────────────────────

export interface LoginPayload {
  organizationSlug: string;
  doctorId: string;
  pin: string;
}

// A4 — the same /api/auth/login endpoint also accepts email + password
// (self-serve accounts). The backend picks the path off the body shape.
export interface EmailLoginPayload {
  email: string;
  password: string;
}

// A4 — invite-gated self-serve signup. Responds with the exact LoginResponse
// shape, so session handling is shared with login.
export interface SignupPayload {
  invite_code: string;
  name: string;
  email: string;
  password: string;
  org_name?: string;
}

export interface LoginResponse {
  token: string;
  doctor: DoctorInfo;
}

// GET/PATCH /api/auth/me (A4 onboarding). The onboarding keys are ABSENT
// (undefined) when backend migration 015 isn't applied — the wizard must
// treat undefined as "unknown → show nothing"; only an explicit null means
// "new doctor → show the wizard".
export interface MeResponse {
  id: string;
  name: string;
  specialty: string | null;
  organizationName: string | null;
  onboarding_completed_at?: string | null;
  avg_monthly_consultations?: number | null;
}

export interface UpdateMePayload {
  specialty?: string;
  org_name?: string;
  avg_monthly_consultations?: number;
  onboarding_completed?: boolean;
}

// Discriminated union for createPatient — the 409 dedup response is data,
// not an exception. Callers render the DedupModal directly from the conflict.
export type CreatePatientResult =
  | { ok: true; data: CreatePatientSuccess }
  | { ok: false; status: 409; dedup: DedupConflict };

export const api = {
  health: () => request<{ status: string }>('/health'),
  login: (payload: LoginPayload | EmailLoginPayload) =>
    request<LoginResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  signup: (payload: SignupPayload) =>
    request<LoginResponse>('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  me: () => request<MeResponse>('/api/auth/me'),
  updateMe: (payload: UpdateMePayload) =>
    request<MeResponse>('/api/auth/me', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  // ── Sessions / transcription (extended to forward consultation_id) ─────
  createSession: (opts?: { consultationId?: string }) =>
    request<SessionInit>('/api/sessions', {
      method: 'POST',
      body: JSON.stringify(opts?.consultationId ? { consultation_id: opts.consultationId } : {}),
    }),
  getSessionStatus: (id: string) =>
    request<SessionStatus>(`/api/sessions/${id}/status`),
  transcribe: (audio: Blob, filename = 'audio.webm', opts?: { consultationId?: string }) => {
    const fd = new FormData();
    fd.append('audio', audio, filename);
    const headers: Record<string, string> = {};
    if (opts?.consultationId) headers['X-Consultation-Id'] = opts.consultationId;
    return request<TranscribeResult>('/api/transcribe', {
      method: 'POST',
      body: fd,
      headers,
    });
  },
  editConsultation: (
    consultationId: string,
    field?: string,
    fields?: TranscribeFields,
    /** Per-edit character delta, included in the note_edited event metadata.
     *  Always >= 0. The result page computes it as
     *  |current_value.length − ai_original_value.length| so an undo brings
     *  the count back toward 0 instead of inflating it. */
    charsChanged?: number,
  ) =>
    request<EditConsultationResponse>(`/api/consultations/${consultationId}/edit`, {
      method: 'POST',
      body: JSON.stringify({ field, fields, chars_changed: charsChanged }),
    }),

  /** Signals the backend that the doctor exported the note. Backend persists
   *  the rollup counters to consultations and emits the note_exported event
   *  (with med-copy counts in metadata). Frontend doesn't block on the call
   *  — the export itself happens client-side, this just records the event. */
  exportConsultation: (
    consultationId: string,
    payload: ExportSignalPayload,
  ) =>
    request<{ ok: boolean }>(`/api/consultations/${consultationId}/export`, {
      method: 'POST',
      body: JSON.stringify({
        format:              payload.format,
        total_chars_edited:  payload.total_chars_edited,
        fields_edited_count: payload.fields_edited_count,
      }),
    }),

  /** Fire-and-forget event for a successful meds-copy click. Callers should
   *  `.catch()` the returned promise — a failed network call must never
   *  block the local clipboard write that already succeeded. `scope` is
   *  'single' for a per-row copy and 'all' for the "Копирай медикаментите"
   *  button. `medCount` is 1 for 'single', the number of meds copied for 'all'. */
  logMedsCopied: (
    consultationId: string,
    scope: 'single' | 'all',
    medCount: number,
  ) =>
    request<{ ok: boolean }>(`/api/consultations/${consultationId}/meds-copied`, {
      method: 'POST',
      body: JSON.stringify({ scope, med_count: medCount }),
    }),

  // ── Patients ───────────────────────────────────────────────────────────
  searchPatients: (q: string, limit = 10) => {
    const u = new URLSearchParams();
    if (q) u.set('q', q);
    u.set('limit', String(limit));
    return request<PatientSearchResponse>(`/api/patients?${u.toString()}`);
  },
  // `method` is an audit discriminator (load context) forwarded to the backend's
  // patient_viewed event. Optional — omitting it lets the backend default to
  // 'unspecified'. Never carries any patient PII, just the load context.
  getPatient: (id: string, method?: 'egn_typed' | 'name_pick' | 'history_view' | 'dedup_pick') => {
    const qs = method ? `?method=${encodeURIComponent(method)}` : '';
    return request<PatientDetailResponse>(`/api/patients/${id}${qs}`);
  },

  // Returns a discriminated union: success or 409-dedup. Other errors still throw ApiError.
  async createPatient(payload: CreatePatientPayload): Promise<CreatePatientResult> {
    try {
      const data = await request<CreatePatientSuccess>('/api/patients', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      return { ok: true, data };
    } catch (err) {
      if (
        err instanceof ApiError &&
        err.status === 409 &&
        err.body &&
        typeof err.body === 'object' &&
        'possible_duplicates' in (err.body as Record<string, unknown>)
      ) {
        return { ok: false, status: 409, dedup: err.body as DedupConflict };
      }
      throw err;
    }
  },
  updatePatient: (id: string, payload: UpdatePatientPayload) =>
    request<{ patient: PatientSummary }>(`/api/patients/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  // `reason` is an audit discriminator forwarded to the backend's
  // patient_national_id_revealed event. Optional — omitting it lets the backend
  // default to 'manual_reveal'. Never carries any ЕГН value, just the reason tag.
  revealNationalId: (patientId: string, reason?: 'manual_reveal' | 'name_load_autoreveal') => {
    const qs = reason ? `?reason=${encodeURIComponent(reason)}` : '';
    return request<RevealNationalIdResponse>(`/api/patients/${patientId}/national-id${qs}`);
  },

  // ── Patient history (read-only viewer) ─────────────────────────────────
  // GET /api/consultations/:id returns ONE consultation's filed note for
  // the read-only history viewer. `note` is the doctor's final extracted_
  // fields OR null (pending/error/abandoned). Org-scoped server-side.
  getConsultation: (consultationId: string) =>
    request<ConsultationDetailResponse>(`/api/consultations/${consultationId}`),

  // GET /api/patients/:id/consultations — paginated visit summaries
  // (newest first). Page size defaults to 10, server clamps to <=50.
  // Returns total + has_more so the "Покажи още" button can be driven
  // from a single endpoint for first-page and subsequent loads alike.
  getPatientConsultations: (
    patientId: string,
    offset = 0,
    limit = 10,
  ) => {
    const u = new URLSearchParams();
    u.set('offset', String(offset));
    u.set('limit', String(limit));
    return request<PatientConsultationsResponse>(
      `/api/patients/${patientId}/consultations?${u.toString()}`,
    );
  },

  // ── Visit staging ──────────────────────────────────────────────────────
  startVisit: (payload: VisitStartPayload) =>
    request<VisitStartResponse>('/api/visits/start', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  abandonVisit: (consultationId: string) =>
    request<{ ok: true }>(`/api/visits/${consultationId}/abandon`, { method: 'POST' }),

  // ── Today's consultations (right rail) ─────────────────────────────────
  consultationsToday: () => request<TodayResponse>('/api/consultations/today'),

  // ── Consent ────────────────────────────────────────────────────────────
  // Records the patient's verbal consent against the consultation. The
  // backend is idempotent — calling twice returns the original timestamp.
  // No body needed; JWT identifies the doctor and the URL identifies the row.
  recordConsent: (consultationId: string) =>
    request<ConsentResponse>(`/api/consultations/${consultationId}/consent`, {
      method: 'POST',
    }),

  // ── Approve generated note ─────────────────────────────────────────────
  // Records the doctor's review approval against the consultation. Mirrors
  // recordConsent: idempotent on the backend (first timestamp wins). Required
  // before /export will succeed — POST /:id/export refuses with 403 +
  // export_blocked_no_approval otherwise. The caller (confirmReview on the
  // result page) blocks the UI unlock until this resolves, so this is NOT
  // fire-and-forget; rejections must surface to the doctor.
  approveConsultation: (consultationId: string) =>
    request<ApproveResponse>(`/api/consultations/${consultationId}/approve`, {
      method: 'POST',
    }),

  // ── Patient after-visit summary (A2) ───────────────────────────────────
  // Generates (or returns the cached) plain-language Bulgarian summary the
  // patient takes home. Built server-side from the doctor-APPROVED note, so
  // the backend refuses with 403 (patient_summary_blocked_no_approval) until
  // the note is confirmed. Pass { regenerate: true } to force a fresh
  // generation + overwrite (e.g. after the doctor edited the note). NOT
  // fire-and-forget — the modal surfaces errors to the doctor.
  generatePatientSummary: (
    consultationId: string,
    opts?: { regenerate?: boolean },
  ) =>
    request<PatientSummaryResponse>(
      `/api/consultations/${consultationId}/patient-summary`,
      {
        method: 'POST',
        body: JSON.stringify(opts?.regenerate ? { regenerate: true } : {}),
      },
    ),

  // ── Retry extraction (A3 recovery) ─────────────────────────────────────
  // Resurrect a consultation whose generation failed AFTER Soniox produced a
  // transcript (typically a sustained Anthropic outage that exhausted the
  // retry wrapper). Re-runs ONLY the Claude stage against the saved transcript
  // — the doctor does NOT re-record. Backend gates: 409 if status≠'error' or
  // no transcript is on the row (nothing to resurrect), 502 if the upstream is
  // still down (transcript kept for a later attempt). On 200 the row flips to
  // 'generated'; callers can navigate to /app/scribe/result?visit=<id> and let
  // the result page re-read the note from the server. NOT fire-and-forget —
  // the recovery panel surfaces the outcome to the doctor.
  retryExtraction: (consultationId: string) =>
    request<RetryExtractionResponse>(
      `/api/consultations/${consultationId}/retry-extraction`,
      { method: 'POST' },
    ),
};

/**
 * Distinguish "transcription blocked because consent isn't recorded" from
 * other 4xx outcomes (e.g. 409 wrong-status, generic 403 mismatch). The
 * backend's consent-block path always returns HTTP 403 and a Bulgarian
 * message containing "съгласие" (the Cyrillic stem for "consent"); other
 * 403 / 4xx outcomes use different messages (e.g. "Сесията не съответства
 * на консултацията", "Невалиден статус: …"). Matching on status + the
 * "съгласие" substring cleanly separates the missing-consent case so the
 * UI can surface ConsentModal instead of a raw error toast.
 */
export function isMissingConsentError(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  if (err.status !== 403) return false;
  return err.message.includes('съгласие');
}

export function wsUrl(sessionId: string): string {
  const token = getToken();
  return (
    BACKEND.replace('https://', 'wss://').replace('http://', 'ws://') +
    `/ws?session=${sessionId}&token=${token}`
  );
}

export { BACKEND };
