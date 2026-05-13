import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="text-center max-w-xl">
        <h1 className="text-6xl font-semibold tracking-tight mb-4 font-[family-name:var(--font-cormorant)]"
            style={{ color: "var(--color-brand)" }}>
          TuberMed
        </h1>
        <p className="text-lg mb-2" style={{ color: "var(--color-text-muted)" }}>
          AI Медицински скрайб за български лекари.
        </p>
        <p className="text-sm mb-10" style={{ color: "var(--color-text-hint)" }}>
          GDPR-съвместим · EU инфраструктура · Анамнеза за секунди
        </p>
        <Link
          href="/app/login"
          className="inline-block px-8 py-3 rounded-lg text-white font-medium transition hover:opacity-90"
          style={{ background: "var(--gradient-brand)" }}
        >
          Вход за лекари →
        </Link>
      </div>
    </main>
  );
}