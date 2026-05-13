"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, setSession, ApiError } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [organizationSlug, setOrganizationSlug] = useState("");
  const [doctorId, setDoctorId] = useState("");
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api.login({
        organizationSlug: organizationSlug.trim(),
        doctorId: doctorId.trim(),
        pin: pin.trim(),
      });
      setSession({ token: res.token, doctor: res.doctor });
      router.push("/app/scribe");
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Грешка при вход";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-10">
          <h1
            className="text-5xl font-semibold mb-2 font-[family-name:var(--font-cormorant)]"
            style={{ color: "var(--color-brand)" }}
          >
            TuberMed
          </h1>
          <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
            Вход в портала за лекари
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-2xl shadow-sm p-8 space-y-5"
          style={{ background: "var(--color-bg-card)", borderColor: "var(--color-border)", borderWidth: 1 }}
        >
          <Field label="Кабинет (slug)">
            <input
              type="text"
              value={organizationSlug}
              onChange={(e) => setOrganizationSlug(e.target.value)}
              autoFocus
              required
              disabled={loading}
              className="w-full px-3 py-2 rounded-md border outline-none"
              style={{ borderColor: "var(--color-border-mid)", background: "white" }}
            />
          </Field>

          <Field label="ID на лекар (UUID)">
            <input
              type="text"
              value={doctorId}
              onChange={(e) => setDoctorId(e.target.value)}
              required
              disabled={loading}
              className="w-full px-3 py-2 rounded-md border outline-none font-[family-name:var(--font-jetbrains)] text-sm"
              style={{ borderColor: "var(--color-border-mid)", background: "white" }}
            />
          </Field>

          <Field label="ПИН">
            <input
              type="password"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              required
              disabled={loading}
              inputMode="numeric"
              className="w-full px-3 py-2 rounded-md border outline-none font-[family-name:var(--font-jetbrains)] tracking-widest"
              style={{ borderColor: "var(--color-border-mid)", background: "white" }}
            />
          </Field>

          {error && (
            <div
              className="text-sm px-3 py-2 rounded-md"
              style={{ background: "#FDECEA", color: "var(--color-red)" }}
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-md text-white font-medium transition hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: "var(--gradient-brand)" }}
          >
            {loading ? "Влизане…" : "Вход"}
          </button>
        </form>

        <p className="text-center text-xs mt-6" style={{ color: "var(--color-text-hint)" }}>
          GDPR-съвместим · Данните се обработват в EU
        </p>
      </div>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-sm mb-1.5 font-medium" style={{ color: "var(--color-text-muted)" }}>
        {label}
      </span>
      {children}
    </label>
  );
}