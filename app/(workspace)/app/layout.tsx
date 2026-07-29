// Server pass-through layout whose ONLY job is the segment config below —
// the workspace-group twin of app/app/layout.tsx (full rationale there).
// Covers /app/new-visit and /app/settings. The client shell (auth gate +
// AppShell) stays in app/(workspace)/layout.tsx, which wraps this one.
export const dynamic = 'force-dynamic';

import type { ReactNode } from 'react';

export default function WorkspaceAppSegmentLayout({ children }: { children: ReactNode }) {
  return children;
}
