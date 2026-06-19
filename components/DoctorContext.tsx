'use client';

// Live channel for the workspace sidebar's doctor identity.
//
// app/(workspace)/layout.tsx holds the `doctor` state that feeds AppShell →
// ClinicSidebar (clinic name + specialty + doctor name). It provides this
// context so a descendant page (Настройки) can push an identity change into that
// SAME state on save — the sidebar re-renders instantly, no reload, no re-login.
// The reload-persistent half is updateSessionDoctor (lib/api.ts); the two are
// wired together in settings/page.tsx saveProfile().
//
// useDoctorContext() returns null when there is no provider (e.g. the scribe /
// result pages render AppShell directly, outside this group) — consumers must
// tolerate that and simply skip the live update.

import { createContext, useContext } from 'react';
import type { DoctorInfo } from '@/lib/api';

export interface DoctorContextValue {
  doctor: DoctorInfo | null;
  setDoctor: React.Dispatch<React.SetStateAction<DoctorInfo | null>>;
}

const DoctorContext = createContext<DoctorContextValue | null>(null);

export function DoctorProvider({
  value,
  children,
}: {
  value: DoctorContextValue;
  children: React.ReactNode;
}) {
  return <DoctorContext.Provider value={value}>{children}</DoctorContext.Provider>;
}

export function useDoctorContext(): DoctorContextValue | null {
  return useContext(DoctorContext);
}
