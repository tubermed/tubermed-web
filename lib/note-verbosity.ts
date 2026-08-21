// Note length — Кратко · Точно · Подробно (backend migration 028,
// lib/note-verbosity.js). A PROMPT parameter on the free-prose fields
// (anamneza, obektivno findings, terapia): the same clinical content at a
// different length. Structured fields never change with it.
//
// Stored as the doctor's default (doctors.note_verbosity, PATCH /api/auth/me)
// and overridable per visit at staging (consultations.note_verbosity, POST
// /api/visits/start). Backend resolves override → default → 'tochno'.

import type { NoteVerbosity } from './types';

export const NOTE_VERBOSITY_DEFAULT: NoteVerbosity = 'tochno';

export const NOTE_VERBOSITY_OPTIONS: Array<{ value: NoteVerbosity; label: string; hint: string }> = [
  { value: 'kratko',   label: 'Кратко',   hint: 'Телеграфно — фрази и съкращения, нищо излишно.' },
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
