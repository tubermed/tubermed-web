"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, setSession, clearSession, getToken, ApiError } from "@/lib/api";
import AuthBrandPanel from "@/components/AuthBrandPanel";
import AuthBootSplash from "@/components/AuthBootSplash";
import PasswordInput from "@/components/PasswordInput";
import RememberMe from "@/components/RememberMe";

type LoginMode = "email" | "pin";

// Stable no-op subscribe for useSyncExternalStore — the token only changes
// through this page's own navigation, so no store notifications are needed.
const subscribeNoop = () => () => {};

// Client ceiling on the auto-forward session probe. A cold/hung /me must never
// keep the branded splash up indefinitely: past this, forward into the app on the
// still-valid stored token rather than block a remembered doctor on a slow probe.
// Generous vs a normal cold start (~2–4s) so only a genuinely stuck backend hits it.
const PROBE_TIMEOUT_MS = 8000;

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
  // Checked (default) = current behavior: localStorage, survives a browser
  // restart. Unchecked: sessionStorage, dies with the browser session.
  const [remember, setRemember] = useState(true);
  const [loading, setLoading] = useState(false);
  // True once credentials are accepted and we are navigating into the app — the
  // branded splash's correct home is here (authenticating → entering), never as a
  // pre-form gate.
  const [authenticating, setAuthenticating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Auto-forward: an already-authenticated doctor opening the login page goes
  // straight into the workspace. useSyncExternalStore is the hydration-safe
  // way to read storage: the server/hydration snapshot is false (the page is
  // statically prerendered with the form — logged-out render stays
  // byte-identical), then the client snapshot kicks in post-hydration.
  const hasToken = useSyncExternalStore(
    subscribeNoop,
    () => !!getToken(),
    () => false
  );
  // Flipped (asynchronously, in the probe's catch) only on a real 401 — the sole
  // case where a stored token is dead and the form should render after all.
  const [probeFailed, setProbeFailed] = useState(false);
  const probing = hasToken && !probeFailed;

  useEffect(() => {
    if (!hasToken || authenticating) return; // nothing stored, or already entering — render the form / splash as-is
    // `settled` guarantees exactly one outcome wins — success, failure, timeout,
    // or unmount — so a late-resolving /me can't redirect out from under a doctor
    // who has since been shown the form.
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      // Cold/hung /me: the token is almost certainly valid (the backend verifies
      // the JWT synchronously and 401s fast — the slowness is the post-auth DB
      // work), so forward into the app on it rather than force a remembered doctor
      // to re-login. Bounds the splash; auth is untouched.
      router.replace("/app/new-visit");
    }, PROBE_TIMEOUT_MS);
    api
      .me() // validate before forwarding — same probe pattern as /app/scribe
      .then(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        router.replace("/app/new-visit"); // same destination as a fresh login
      })
      .catch((err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err instanceof ApiError && err.status === 401) {
          clearSession(); // dead/stale token — clear it so nothing shadows the next login
          setProbeFailed(true); // real 401 is the ONLY path that falls through to the form
          return;
        }
        // Network failure / 5xx: keep the (valid) session and forward into the
        // app on the stored token — never force re-login on a failed probe.
        router.replace("/app/new-visit");
      });
    return () => {
      settled = true;
      clearTimeout(timer);
    };
  }, [hasToken, authenticating, router]);

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
      setSession({ token: res.token, doctor: res.doctor }, remember);
      setAuthenticating(true); // show the branded splash while entering the app
      router.push("/app/new-visit");
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Грешка при вход";
      setError(msg);
      setLoading(false); // re-enable the form; on success we navigate away instead
    }
  }

  function switchMode(next: LoginMode) {
    setMode(next);
    setError(null);
  }

  // Branded loading state — during a „Запомни ме" auto-login probe, and after a
  // submit while entering the app. Never a blank-white gate, and never a pre-form
  // gate for an un-remembered doctor (probing is false with no token).
  if (probing || authenticating) {
    return <AuthBootSplash />;
  }

  return (
    <div className="min-h-screen flex" style={{ background: "var(--color-bg-surface)" }}>
      {/* ── Left: brand panel (hidden on mobile) ─────────────────────── */}
      <AuthBrandPanel />

      {/* ── Right: form panel ─────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col">
        {/* Compact mobile-only header */}
        <div
          className="md:hidden flex items-center gap-3 px-6 py-5 border-b"
          style={{ borderColor: "var(--color-border-soft)" }}
        >
          <Image src="/brand/tubermed-tile.svg" alt="" width={32} height={32} priority />
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
                    <PasswordInput
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
