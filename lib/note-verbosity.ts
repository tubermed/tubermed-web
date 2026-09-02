// Note length — Кратко · Точно · Подробно (backend migration 028,
// lib/note-verbosity.js). A PROMPT parameter on the free-prose fields
// (anamneza, obektivno findings, terapia): the same clinical content at a
// different length. Structured fields never change with it.
//
// Stored as the doctor's default (doctors.note_verbosity, PATCH /api/auth/me)
// and overridable per visit at staging (consultations.note_verbosity, POST
// /api/visits/start). Backend resolves override → default → 'tochno'.

import type { NoteVerbosity } from './types';

// ── FLAG: NEXT_PUBLIC_NOTE_VERBOSITY — OFF by default (2026-08-21) ──────────
// The backend's coverage gate was not passed on held-out fixtures (see
// tubermed-backend lib/note-verbosity.js, NOTE_VERBOSITY). Until it is, no
// control renders: a doctor must not be offered a choice that the server
// ignores. Same shape and fail-safe direction as lib/clinical-alerts.ts —
// Next inlines the env at build, so an unset or misspelled value is OFF.
// Flip BOTH flags together.
const ON_VALUES = new Set(['1', 'true', 'on', 'yes']);
export function noteVerbosityEnabled(): boolean {
  const raw = (process.env.NEXT_PUBLIC_NOTE_VERBOSITY ?? '').trim().toLowerCase();
  return ON_VALUES.has(raw);
}
export const NOTE_VERBOSITY_ENABLED = noteVerbosityEnabled();

export const NOTE_VERBOSITY_DEFAULT: NoteVerbosity = 'tochno';

export const NOTE_VERBOSITY_OPTIONS: Array<{ value: NoteVerbosity; label: string; hint: string }> = [
  { value: 'kratko',   label: 'Кратко',   hint: 'Телеграфно, фрази и съкращения, нищо излишно.' },
  { value: 'tochno',   label: 'Точно',    hint: 'Стандартният запис.' },
  { value: 'podrobno', label: 'Подробно', hint: 'Пълни изречения, с контекста на разговора.' },
];

export const NOTE_VERBOSITY_VALUES: NoteVerbosity[] = NOTE_VERBOSITY_OPTIONS.map((o) => o.value);

export function isNoteVerbosity(v: unknown): v is NoteVerbosity {
  return typeof v === 'string' && (NOTE_VERBOSITY_VALUES as string[]).includes(v);
}

export function noteVerbosityLabel(v: NoteVerbosity): string {
  return NOTE_VERBOSITY_OPTIONS.find((o) => o.value === v)?.label ?? v;
}
