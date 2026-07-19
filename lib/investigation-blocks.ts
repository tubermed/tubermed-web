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
// Only 'echo' exists today. Pacemaker/ECG are pending field-set validation;
// each future block = backend template data file + registry entry here +
// mirrored section descriptor.

import { ECHO_SECTIONS, type EchoSectionDescriptor } from './echo-template';

export interface InvestigationBlockDescriptor {
  // Card title shown on the block's card in Изследвания.
  title: string;
  sections: EchoSectionDescriptor[];
}

export const INVESTIGATION_BLOCK_REGISTRY: Record<string, InvestigationBlockDescriptor> = {
  echo: { title: 'Ехокардиография', sections: ECHO_SECTIONS },
};

// Lookup that keeps the tolerant-reader contract explicit at call sites:
// `undefined` means "unknown type — skip the block, render everything else".
export function getInvestigationBlockDescriptor(type: string): InvestigationBlockDescriptor | undefined {
  return Object.prototype.hasOwnProperty.call(INVESTIGATION_BLOCK_REGISTRY, type)
    ? INVESTIGATION_BLOCK_REGISTRY[type]
    : undefined;
}
