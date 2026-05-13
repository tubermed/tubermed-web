"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, clearSession, getSession, ApiError, type DoctorInfo } from "@/lib/api";

export default function ScribePage() {
  const router = useRouter();
  const [doctor, setDoctor] = useState<DoctorInfo | null>(null);

  useEffect(() => {
    const session = getSession();
    if (!session) {
      router.replace("/app/login");
      return;
    }
    setDoctor(session.doctor);

    // Background token-validity check. If expired/invalid → kick to login.
    api.me().catch((err) => {
      if (err instanceof ApiError && err.status === 401) {
        clearSession();
        router.replace("/app/login");
      }
    });
  }, [router]);

  function handleLogout() {
    clearSession();
    router.replace("/app/login");
  }

  if (!doctor) {
    return (
      <main className="min-h-screen flex items-center justify-center" style={{ color: "var(--color-text-muted)" }}>
        Зареждане…
      </main>
    );
  }

  const displayName = doctor.name.replace(/^д-р\s*/i, "");
  const specialty = doctor.specialty || "АМП";

  return (
    <main className="min-h-screen px-8 py-10 max-w-4xl mx-auto">
      <header className="flex items-center justify-between mb-12">
        <h1
          className="text-3xl font-semibold font-[family-name:var(--font-cormorant)]"
          style={{ color: "var(--color-brand)" }}
        >
          TuberMed
        </h1>
        <button
          onClick={handleLogout}
          className="text-sm hover:underline"
          style={{ color: "var(--color-text-muted)" }}
        >
          Изход
        </button>
      </header>

      <section
        className="rounded-2xl p-8"
        style={{ background: "var(--color-bg-card)", borderColor: "var(--color-border)", borderWidth: 1 }}
      >
        <p className="text-sm mb-2" style={{ color: "var(--color-text-hint)" }}>
          Влязохте като
        </p>
        <p className="text-2xl font-medium mb-1">д-р {displayName}</p>
        <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
          {specialty}
        </p>

        <div
          className="mt-8 pt-6 border-t text-sm"
          style={{ borderColor: "var(--color-border)", color: "var(--color-text-muted)" }}
        >
          Записът на консултации идва в C2.
        </div>
      </section>
    </main>
  );
}