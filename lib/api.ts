// Thin fetch wrapper for the Railway backend.

import type { TranscribeResult, SessionInit, SessionStatus } from './types';

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
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (options.body && !headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(`${BACKEND}${path}`, { ...options, headers });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    throw new ApiError(res.status, data?.error || `HTTP ${res.status}`);
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

export const api = {
  health: () => request<{ status: string }>('/health'),
  login: (payload: LoginPayload) =>
    request<LoginResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  me: () => request<unknown>('/api/auth/me'),
  createSession: () =>
    request<SessionInit>('/api/sessions', { method: 'POST' }),
  getSessionStatus: (id: string) =>
    request<SessionStatus>(`/api/sessions/${id}/status`),
  transcribe: (audio: Blob, filename = 'audio.webm') => {
    const fd = new FormData();
    fd.append('audio', audio, filename);
    return request<TranscribeResult>('/api/transcribe', {
      method: 'POST',
      body: fd,
    });
  },
};

export function wsUrl(sessionId: string): string {
  const token = getToken();
  return (
    BACKEND.replace('https://', 'wss://').replace('http://', 'ws://') +
    `/ws?session=${sessionId}&token=${token}`
  );
}

export { BACKEND };
