// Thin fetch wrapper for the Railway backend.

import type {
  TranscribeResult,
  SessionInit,
  SessionStatus,
  TranscribeFields,
  VisitStartPayload,
  VisitStartResponse,
  ConsentResponse,
  ApproveResponse,
  EditConsultationResponse,
  ExportSignalPayload,
  ConsultationDetailResponse,
  ConsultationListResponse,
  PatientSummaryResponse,
  RetryExtractionResponse,
} from './types';

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL!;
const STORAGE_KEY = 'tuber_auth';

// Client-side ceiling for the one-shot PC scribe upload (upload + Soniox + Haiku).
// Bounds a hung/half-open connection so the retry panel surfaces in ~1 min instead
// of the browser's own multi-minute default. Retries are duplicate-safe — the
// backend 409-gates /api/transcribe on consultation status — so a timeout only ever
// costs a re-send, never a double note, never data loss (the audio blob is retained).
const UPLOAD_TIMEOUT_MS = 60_000;

export interface DoctorInfo {
  id: string;
  name: string;
  specialty?: string;
  // Present on the login/signup response's doctor object at runtime (the backend
  // nests the org name here). Optional + nullable: it can be absent on older
  // sessions and null when the doctor's organization is unnamed.
  organizationName?: string | null;
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
  // PHI hygiene on shared clinic machines — drop the transcript/note and patient
  // identifiers so the next user can't read them. Keys mirror RESULT_STORAGE_KEY /
  // PENDING_VISIT_KEY in app/app/scribe/page.tsx (both sessionStorage-only).
  sessionStorage.removeItem('tuber_last_result');
  sessionStorage.removeItem('tuber_pending_visit');
}

// Pure merge — shallow-overlay `partial` onto `session.doctor`, preserving the
// token and any doctor field not in the partial. Never mutates its input.
export function mergeSessionDoctor(session: Session, partial: Partial<DoctorInfo>): Session {
  return { ...session, doctor: { ...session.doctor, ...partial } };
}

// Persist an identity change (Профил save) back into the stored session so a
// page reload keeps the sidebar correct. Reads the current session; merges the
// partial onto its doctor; re-persists to the SAME storage it currently lives in
// — preserving "Запомни ме" (localStorage vs sessionStorage), the token and its
// expiry. No-ops when there is no session. (The LIVE sidebar update is a separate
// facet via DoctorContext; this one is the reload-persistent half.)
export function updateSessionDoctor(partial: Partial<DoctorInfo>): void {
  const session = getSession();
  if (!session) return;
  // getSession returns non-null only in the browser, so storage access is safe
  // here. setSession clears the other location, so exactly one holds the token —
  // a localStorage hit means remember=true; otherwise it lives in sessionStorage.
  const remember = localStorage.getItem(STORAGE_KEY) !== null;
  setSession(mergeSessionDoctor(session, partial), remember);
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

// The wizard's three-band workload answer (backend migration 016 — closed
// list, mirrored by a DB CHECK constraint).
export type ConsultationsBand = 'under_100' | '100_200' | 'over_200';

// GET/PATCH /api/auth/me (A4 onboarding). The onboarding keys are ABSENT
// (undefined) when the backing migration isn't applied (015 for the
// onboarding stamp, 016 for the band — each degrades independently) — the
// wizard must treat undefined as "unknown → show nothing"; only an explicit
// null means "new doctor → show the wizard".
export interface MeResponse {
  id: string;
  name: string;
  specialty: string | null;
  organizationName: string | null;
  onboarding_completed_at?: string | null;
  consultations_band?: ConsultationsBand | null;
  // Practice / document-identity (backend migration 017). ABSENT (undefined)
  // when 017 isn't applied; null when applied but unfilled; string when set —
  // same absent-key="unknown" contract as the onboarding keys above. uin is the
  // doctor's own; the four practice fields are the doctor's OWN organization's.
  uin?: string | null;
  practice_address?: string | null;
  rzi_number?: string | null;
  nzok_contract?: string | null;
  practice_phone?: string | null;
  // Doctor's self-reported manual-documentation minutes/visit (migration 019).
  // ABSENT when 019 isn't applied; null when applied but unset; number when set.
  baseline_doc_minutes?: number | null;
}

// GET /api/auth/me/value-stats (JWT) — B2 value card, now minutes-saved.
// Aggregate NUMBERS ONLY, no PII. savedMinutes = Σ max(0, baselineMinutes −
// review) over the window (whole minutes). baselineSource: 'estimate' = the
// labeled assumed baseline; 'doctor' = the doctor's own captured minutes.
// avgAuthoredPct stays as the demoted secondary stat (null before any measured note).
export interface ValueStatsWindow {
  notes: number;
  savedMinutes: number;
  avgAuthoredPct: number | null;
}
export interface ValueStats {
  baselineMinutes: number;
  baselineSource: 'estimate' | 'doctor';
  thisWeek: ValueStatsWindow;
  today: ValueStatsWindow;
  lastNote: { savedMinutes: number } | null;
}

export interface UpdateMePayload {
  name?: string;
  specialty?: string;
  uin?: string;
  org_name?: string;
  practice_address?: string;
  rzi_number?: string;
  nzok_contract?: string;
  practice_phone?: string;
  consultations_band?: ConsultationsBand;
  onboarding_completed?: boolean;
  baseline_doc_minutes?: number;
}

// POST /api/auth/change-password (JWT). Email-auth doctors only — a PIN-only
// doctor (no password credential) gets 400 'password_change_unavailable'; a
// wrong current password gets a generic 401.
export interface ChangePasswordPayload {
  current_password: string;
  new_password: string;
}

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
  valueStats: () => request<ValueStats>('/api/auth/me/value-stats'),
  changePassword: (payload: ChangePasswordPayload) =>
    request<{ ok: boolean }>('/api/auth/change-password', {
      method: 'POST',
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
    // Bound the single upload+transcribe+extract request. On timeout the fetch
    // aborts (AbortError → the scribe flow's retainable-failure path); `signal`
    // rides through request()'s option spread into fetch — no wrapper change.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
    return request<TranscribeResult>('/api/transcribe', {
      method: 'POST',
      body: fd,
      headers,
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));
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

  // ── Consultation read (single note) ────────────────────────────────────
  // GET /api/consultations/:id returns ONE consultation's filed note.
  // `note` is the doctor's final extracted_fields OR null
  // (pending/error/abandoned). Org-scoped server-side.
  getConsultation: (consultationId: string) =>
    request<ConsultationDetailResponse>(`/api/consultations/${consultationId}`),

  // ── Visit staging ──────────────────────────────────────────────────────
  startVisit: (payload: VisitStartPayload) =>
    request<VisitStartResponse>('/api/visits/start', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  abandonVisit: (consultationId: string) =>
    request<{ ok: true }>(`/api/visits/${consultationId}/abandon`, { method: 'POST' }),

  // ── Notes library ──────────────────────────────────────────────────────
  // Identity-free clinic-wide list, newest first. Same pagination contract
  // as the patients-history list (total + has_more drive "Покажи още").
  listConsultations: (opts: { offset?: number; limit?: number; status?: string } = {}) => {
    const u = new URLSearchParams();
    if (opts.offset !== undefined) u.set('offset', String(opts.offset));
    if (opts.limit  !== undefined) u.set('limit',  String(opts.limit));
    if (opts.status)               u.set('status', opts.status);
    const qs = u.toString();
    return request<ConsultationListResponse>(`/api/consultations${qs ? `?${qs}` : ''}`);
  },

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

/**
 * no_speech — Soniox produced no transcribable speech (silence / too short /
 * muted mic / wrong device). This is NOT a system fault and NOT resurrectable,
 * so the scribe shows a calm "re-record" message rather than the generic
 * failure / retry-extraction panel. It surfaces three ways and these helpers
 * unify detection across them:
 *   • PC direct upload    → ApiError 422 with body.code === 'no_speech'
 *     (isNoSpeechApiError).
 *   • phone, live WS      → WsMessage error payload's code === 'no_speech'
 *     (read directly off the message — no helper needed).
 *   • phone, /status poll → the recovery fallback only has error_msg, so match
 *     the backend's stable Bulgarian stem (isNoSpeechMessage). The message
 *     wording stays single-sourced on the backend.
 */
export function isNoSpeechApiError(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  if (err.status === 422) return true;
  const body = err.body;
  return !!body && typeof body === 'object' && (body as { code?: unknown }).code === 'no_speech';
}

export function isNoSpeechMessage(msg: string | null | undefined): boolean {
  return typeof msg === 'string' && msg.toLowerCase().includes('разпознахме реч');
}

/**
 * B5 — POST /api/consultations/:id/patient-summary grew two server-side
 * cost-control limits, each an HTTP 429 carrying a machine `code` plus a
 * Bulgarian `error` message (the per-org daily cap, and a per-consultation
 * regen cooldown that ALSO carries `retry_after_seconds`). These are EXPECTED,
 * non-alarming outcomes — PatientSummaryModal surfaces them as a calm notice
 * rather than the generic red error channel. This lifts the code/message/retry
 * off the ApiError so that branching is typed and single-sourced here (the
 * `request` wrapper already parses the body's `error` into `err.message`).
 * Returns null for anything else (incl. a 429 with an unknown code), so the
 * caller's existing generic-error fallback handles it unchanged.
 */
export type PatientSummaryLimitCode =
  | 'patient_summary_daily_limit'
  | 'patient_summary_regen_cooldown';

export interface PatientSummaryLimit {
  code: PatientSummaryLimitCode;
  /** The backend's Bulgarian message — wording stays single-sourced server-side. */
  message: string;
  /** Seconds until a retry would be accepted; present only on the regen cooldown. */
  retryAfterSeconds?: number;
}

export function patientSummaryLimitFromError(err: unknown): PatientSummaryLimit | null {
  if (!(err instanceof ApiError) || err.status !== 429) return null;
  const body = err.body;
  if (!body || typeof body !== 'object') return null;
  const code = (body as { code?: unknown }).code;
  if (code !== 'patient_summary_daily_limit' && code !== 'patient_summary_regen_cooldown') {
    return null;
  }
  const retry = (body as { retry_after_seconds?: unknown }).retry_after_seconds;
  return {
    code,
    message: err.message,
    retryAfterSeconds: typeof retry === 'number' ? retry : undefined,
  };
}

export function wsUrl(sessionId: string): string {
  const token = getToken();
  return (
    BACKEND.replace('https://', 'wss://').replace('http://', 'ws://') +
    `/ws?session=${sessionId}&token=${token}`
  );
}

export { BACKEND };
