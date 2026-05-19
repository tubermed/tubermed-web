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
  ExportSignalPayload,
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

export function getSession(): Session | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

export function setSession(s: Session): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

export function clearSession(): void {
  localStorage.removeItem(STORAGE_KEY);
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

export interface LoginResponse {
  token: string;
  doctor: DoctorInfo;
}

// Discriminated union for createPatient — the 409 dedup response is data,
// not an exception. Callers render the DedupModal directly from the conflict.
export type CreatePatientResult =
  | { ok: true; data: CreatePatientSuccess }
  | { ok: false; status: 409; dedup: DedupConflict };

export const api = {
  health: () => request<{ status: string }>('/health'),
  login: (payload: LoginPayload) =>
    request<LoginResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  me: () => request<unknown>('/api/auth/me'),

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
    request<{ ok: boolean }>(`/api/consultations/${consultationId}/edit`, {
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
  getPatient: (id: string) => request<PatientDetailResponse>(`/api/patients/${id}`),

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
  revealNationalId: (patientId: string) =>
    request<RevealNationalIdResponse>(`/api/patients/${patientId}/national-id`),

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
