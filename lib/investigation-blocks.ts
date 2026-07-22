// ─────────────────────────────────────────────────────────────────────────────
// lib/investigation-blocks.ts — display registry for embedded investigation
// blocks (fields.izsledvania_blocks on the консултация note)
// ─────────────────────────────────────────────────────────────────────────────
// Maps a block's `type` key to the section descriptors that render it as a
// titled card inside Изследвания. The same mirror discipline as
// lib/echo-template.ts applies: descriptors are committed in-repo mirrors of
// the backend templates (lib/templates/* in tubermed-backend) — never
// runtime-read the backend repo (Vercel ships only this one).
//
// Tolerant reader by design: a block whose `type` is not registered here
// (e.g. a newer backend emitting a type this build predates) must be skipped
// gracefully by callers — never crash the лист, never invent a rendering.
//
// 'echo', 'pacemaker' and 'ekg' exist today (pacemaker-v1 and ekg-v1 are
// WORKING DRAFTS pending Соколов validation — trivially editable data); each
// future block = backend template data file + registry entry here + mirrored
// section descriptor.

import { ECHO_SECTIONS, type EchoSectionDescriptor } from './echo-template';
import { PACEMAKER_SECTIONS } from './pacemaker-template';
import { EKG_RENDER_STYLE, EKG_SECTIONS } from './ekg-template';

export interface InvestigationBlockDescriptor {
  // Card title shown on the block's card in Изследвания.
  title: string;
  sections: EchoSectionDescriptor[];
  // 'paragraph' — exporters join populated values into ONE short paragraph in
  // template order (a light prose block like ЕКГ) instead of label/value
  // rows. Absent → rows (echo/pacemaker today).
  renderStyle?: 'paragraph';
}

export const INVESTIGATION_BLOCK_REGISTRY: Record<string, InvestigationBlockDescriptor> = {
  echo:      { title: 'Ехокардиография', sections: ECHO_SECTIONS },
  pacemaker: { title: 'Интерогация на кардиостимулатор', sections: PACEMAKER_SECTIONS },
  ekg:       { title: 'ЕКГ', sections: EKG_SECTIONS, renderStyle: EKG_RENDER_STYLE },
};

// Lookup that keeps the tolerant-reader contract explicit at call sites:
// `undefined` means "unknown type — skip the block, render everything else".
export function getInvestigationBlockDescriptor(type: string): InvestigationBlockDescriptor | undefined {
  return Object.prototype.hasOwnProperty.call(INVESTIGATION_BLOCK_REGISTRY, type)
    ? INVESTIGATION_BLOCK_REGISTRY[type]
    : undefined;
}
