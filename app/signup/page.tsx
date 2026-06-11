"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, setSession, ApiError } from "@/lib/api";
import PasswordInput from "@/components/PasswordInput";
import RememberMe from "@/components/RememberMe";

// A4 — invite-gated self-serve signup. Mirrors /app/login: same workspace
// tokens, same session storage (setSession), same post-auth redirect. The
// backend returns the exact /login response shape, so nothing else changes.
export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  // Mismatch errors surface on confirm-blur and on submit only — never while
  // the user is still typing (onChange below only CLEARS a shown error).
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [orgName, setOrgName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  // Checked (default) = current behavior: localStorage, survives a browser
  // restart. Unchecked: sessionStorage, dies with the browser session.
  const [remember, setRemember] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 10) {
      setError("Паролата трябва да е поне 10 знака.");
      return;
    }
    if (password !== confirm) {
      setConfirmError("Паролите не съвпадат");
      return;
    }

    setLoading(true);
    try {
      const res = await api.signup({
        invite_code: inviteCode.trim(),
        name: name.trim(),
        email: email.trim(),
        password,
        org_name: orgName.trim() || undefined,
      });
      setSession({ token: res.token, doctor: res.doctor }, remember);
      router.push("/app/new-visit");
    } catch (err) {
      if (err instanceof ApiError) {
        // The backend's 503-when-disabled body is the literal token
        // "signup_disabled" — translate it; every other message is already
        // user-facing Bulgarian (wrong code 403, duplicate email 409, …).
        setError(
          err.message === "signup_disabled"
            ? "Регистрацията в момента не е отворена. Свържете се с нас за код за достъп."
            : err.message
        );
      } else {
        setError("Грешка при регистрация");
      }
    } finally {
      setLoading(false);
    }
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
              className="mb-2 font-semibold"
              style={{
                color: "var(--color-ink)",
                fontSize: 20,
                lineHeight: "28px",
                letterSpacing: "-0.01em",
              }}
            >
              Регистрация
            </h1>
            <p
              className="mb-6"
              style={{ color: "var(--color-text-secondary)", fontSize: 13 }}
            >
              Нужен е код за достъп — получавате го от екипа на TuberMed.
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <Field label="Име">
                <Input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                  required
                  disabled={loading}
                  autoComplete="name"
                />
              </Field>

              <Field label="Имейл">
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={loading}
                  autoComplete="email"
                />
              </Field>

              <Field label="Парола (поне 10 знака)">
                <PasswordInput
                  value={password}
                  onChange={(e) => {
                    const v = e.target.value;
                    setPassword(v);
                    if (confirmError && v === confirm) setConfirmError(null);
                  }}
                  required
                  disabled={loading}
                  minLength={10}
                  autoComplete="new-password"
                />
              </Field>

              <Field label="Повтори паролата">
                <>
                  <PasswordInput
                    value={confirm}
                    onChange={(e) => {
                      const v = e.target.value;
                      setConfirm(v);
                      if (confirmError && v === password) setConfirmError(null);
                    }}
                    onBlur={() => {
                      if (confirm && confirm !== password) {
                        setConfirmError("Паролите не съвпадат");
                      }
                    }}
                    required
                    disabled={loading}
                    autoComplete="new-password"
                    aria-invalid={!!confirmError}
                  />
                  {confirmError && (
                    <p
                      className="mt-1.5"
                      style={{ color: "var(--color-danger)", fontSize: 13 }}
                    >
                      {confirmError}
                    </p>
                  )}
                </>
              </Field>

              <Field label="Име на практиката (по избор)">
                <Input
                  type="text"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  disabled={loading}
                />
              </Field>

              <Field label="Код за достъп">
                <Input
                  type="text"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  required
                  disabled={loading}
                  mono
                />
              </Field>

              <RememberMe checked={remember} onChange={setRemember} disabled={loading} />

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
                {loading ? "Създаване…" : "Създай акаунт"}
              </button>
            </form>

            <p
              className="mt-6 text-center"
              style={{ color: "var(--color-text-secondary)", fontSize: 13 }}
            >
              Вече имате акаунт?{" "}
              <Link
                href="/app/login"
                style={{ color: "var(--color-accent)", fontWeight: 500 }}
              >
                Вход
              </Link>
            </p>
          </div>
        </div>
      </main>
    </div>
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
}

function Input({ mono, className, ...rest }: InputProps) {
  const cls = [
    "w-full px-3 outline-none",
    mono ? "font-[family-name:var(--font-jetbrains)]" : "",
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
