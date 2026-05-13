export default function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="text-center max-w-xl">
        <h1 className="text-5xl font-semibold tracking-tight mb-4"
            style={{ color: 'var(--color-brand-primary)' }}>
          TuberMed
        </h1>
        <p className="text-lg text-[var(--color-brand-muted)] mb-8">
          AI Медицински скрайб за български лекари. Скоро.
        </p>
        <a href="/app/login"
           className="inline-block px-6 py-3 rounded-lg text-white font-medium transition hover:opacity-90"
           style={{ background: 'var(--color-brand-primary)' }}>
          Вход за лекари →
        </a>
      </div>
    </main>
  );
}