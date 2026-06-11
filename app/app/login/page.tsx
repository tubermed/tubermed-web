"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, setSession, ApiError } from "@/lib/api";

type LoginMode = "email" | "pin";

export default function LoginPage() {
  const router = useRouter();
  // A4: two credential modes on one endpoint. "Имейл" is the self-serve
  // default; "Клиника + ПИН" is the original admin-provisioned flow,
  // unchanged, one click away.
  const [mode, setMode] = useState<LoginMode>("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
      const res =
        mode === "email"
          ? await api.login({ email: email.trim(), password })
          : await api.login({
              organizationSlug: organizationSlug.trim(),
              doctorId: doctorId.trim(),
              pin: pin.trim(),
            });
      setSession({ token: res.token, doctor: res.doctor });
      router.push("/app/new-visit");
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Грешка при вход";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  function switchMode(next: LoginMode) {
    setMode(next);
    setError(null);
  }

  return (
    <div className="min-h-screen flex" style={{ background: "var(--color-bg-surface)" }}>
      {/* ── Left: brand panel (hidden on mobile) ─────────────────────── */}
      <aside
        className="hidden md:flex flex-col items-stretch justify-between px-10 py-12"
        style={{
          background: "var(--color-nav-bg)",
          color: "var(--color-nav-text)",
          width: "clamp(420px, 42vw, 560px)",
          flexShrink: 0,
        }}
      >
        <div />
        <div className="flex flex-col items-start gap-4">
          {/* Brand mark slot — drop a true white/mono asset at
              public/logo-white.svg and uncomment the <Image> below.
              The source /logo.png is opaque RGB on white, so any
              filter-based recolor produces a solid white block on
              the navy panel — do NOT reintroduce the filter. */}
          {/*
          <Image src="/logo-white.svg" alt="" width={40} height={40} priority />
          */}
          <Wordmark size="lg" onDark />
          <p
            className="leading-snug"
            style={{
              color: "var(--color-nav-text)",
              fontSize: 15,
              maxWidth: 340,
            }}
          >
            Амбулаторни листове, генерирани от консултацията.
          </p>
        </div>
        <p style={{ color: "var(--color-nav-text)", fontSize: 12 }}>
          GDPR-съвместим · Данните се обработват в EU
        </p>
      </aside>

      {/* ── Right: form panel ─────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col">
        {/* Compact mobile-only header */}
        <div
          className="md:hidden flex items-center gap-3 px-6 py-5 border-b"
          style={{ borderColor: "var(--color-border-soft)" }}
        >
          <Image src="/logo.png" alt="" width={28} height={28} priority />
          <Wordmark size="sm" />
        </div>

        <div className="flex-1 flex items-center justify-center px-6 py-12">
          <div className="w-full" style={{ maxWidth: 360 }}>
            <h1
              className="mb-6 font-semibold"
              style={{
                color: "var(--color-ink)",
                fontSize: 20,
                lineHeight: "28px",
                letterSpacing: "-0.01em",
              }}
            >
              Вход в портала за лекари
            </h1>

            {/* Mode switch — Имейл (self-serve) / Клиника + ПИН (original) */}
            <div
              className="flex gap-1 mb-5 p-1"
              style={{
                background: "var(--color-bg-surface)",
                border: "1px solid var(--color-border-soft)",
                borderRadius: "var(--radius-md)",
              }}
            >
              <ModeTab active={mode === "email"} onClick={() => switchMode("email")}>
                Имейл
              </ModeTab>
              <ModeTab active={mode === "pin"} onClick={() => switchMode("pin")}>
                Клиника + ПИН
              </ModeTab>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {mode === "email" ? (
                <>
                  <Field label="Имейл">
                    <Input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      autoFocus
                      required
                      disabled={loading}
                      autoComplete="email"
                    />
                  </Field>

                  <Field label="Парола">
                    <Input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      disabled={loading}
                      autoComplete="current-password"
                    />
                  </Field>
                </>
              ) : (
                <>
                  <Field label="Кабинет (slug)">
                    <Input
                      type="text"
                      value={organizationSlug}
                      onChange={(e) => setOrganizationSlug(e.target.value)}
                      autoFocus
                      required
                      disabled={loading}
                    />
                  </Field>

                  <Field label="ID на лекар (UUID)">
                    <Input
                      type="text"
                      value={doctorId}
                      onChange={(e) => setDoctorId(e.target.value)}
                      required
                      disabled={loading}
                      mono
                    />
                  </Field>

                  <Field label="ПИН">
                    <Input
                      type="password"
                      value={pin}
                      onChange={(e) => setPin(e.target.value)}
                      required
                      disabled={loading}
                      inputMode="numeric"
                      mono
                      spaced
                    />
                  </Field>
                </>
              )}

              {error && (
                <div
                  className="px-3 py-2"
                  style={{
                    background: "var(--color-danger-soft)",
                    color: "var(--color-danger)",
                    borderRadius: "var(--radius-sm)",
                    fontSize: 13,
                  }}
                >
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full text-white transition disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  background: "var(--color-accent)",
                  borderRadius: "var(--radius-md)",
                  height: 40,
                  fontSize: 14,
                  fontWeight: 500,
                }}
                onMouseEnter={(e) => {
                  if (!loading) e.currentTarget.style.background = "var(--color-accent-hover)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "var(--color-accent)";
                }}
              >
                {loading ? "Влизане…" : "Вход"}
              </button>
            </form>

            <p
              className="mt-6 text-center"
              style={{ color: "var(--color-text-secondary)", fontSize: 13 }}
            >
              Нямате акаунт?{" "}
              <Link
                href="/signup"
                style={{ color: "var(--color-accent)", fontWeight: 500 }}
              >
                Регистрация
              </Link>
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}

function ModeTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex-1 transition"
      style={{
        height: 32,
        fontSize: 13,
        fontWeight: 500,
        borderRadius: "var(--radius-sm)",
        background: active ? "white" : "transparent",
        color: active ? "var(--color-ink)" : "var(--color-text-secondary)",
        boxShadow: active ? "0 1px 2px rgba(0,0,0,0.08)" : "none",
        border: active ? "1px solid var(--color-border-soft)" : "1px solid transparent",
      }}
    >
      {children}
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span
        className="block mb-1.5 font-medium"
        style={{ color: "var(--color-text-secondary)", fontSize: 13 }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  mono?: boolean;
  spaced?: boolean;
}

function Input({ mono, spaced, className, ...rest }: InputProps) {
  const cls = [
    "w-full px-3 outline-none",
    mono ? "font-[family-name:var(--font-jetbrains)]" : "",
    spaced ? "tracking-widest" : "",
    className ?? "",
  ].filter(Boolean).join(" ");
  return (
    <input
      {...rest}
      className={cls}
      style={{
        height: 40,
        background: "white",
        border: "1px solid var(--color-border-strong)",
        borderRadius: "var(--radius-sm)",
        fontSize: 14,
        color: "var(--color-text-primary)",
      }}
      onFocus={(e) => {
        e.currentTarget.style.borderColor = "var(--color-accent)";
        e.currentTarget.style.boxShadow = "0 0 0 2px var(--color-accent-soft)";
        rest.onFocus?.(e);
      }}
      onBlur={(e) => {
        e.currentTarget.style.borderColor = "var(--color-border-strong)";
        e.currentTarget.style.boxShadow = "none";
        rest.onBlur?.(e);
      }}
    />
  );
}

function Wordmark({ size, onDark = false }: { size: "sm" | "lg"; onDark?: boolean }) {
  const fontSize = size === "lg" ? 28 : 18;
  return (
    <span
      style={{
        fontFamily: "var(--font-ui)",
        fontWeight: 600,
        fontSize,
        letterSpacing: "-0.01em",
        color: onDark ? "var(--color-nav-text-active)" : "var(--color-ink)",
        lineHeight: 1.1,
      }}
    >
      TuberMed
    </span>
  );
}
