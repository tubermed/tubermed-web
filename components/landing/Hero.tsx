import { Container, Eyebrow, Cta } from './ui';
import { Reveal } from './Reveal';

export function Hero() {
  return (
    <section className="relative overflow-hidden" style={{ background: 'var(--lp-bg)' }}>
      {/* soft brand glow behind the hero */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[420px]"
        style={{
          background:
            'radial-gradient(60% 120% at 70% 0%, rgba(143,192,232,0.20) 0%, rgba(143,192,232,0) 60%)',
        }}
      />
      <Container className="relative grid items-center gap-12 py-16 md:py-24 lg:grid-cols-[1.05fr_0.95fr] lg:gap-10">
        <Reveal>
          <Eyebrow>AI медицински скрайб · България</Eyebrow>
          <h1
            className="font-[family-name:var(--font-inter-tight)] mt-5 text-4xl font-bold leading-[1.08] tracking-[-0.025em] sm:text-5xl md:text-6xl"
            style={{ color: 'var(--lp-ink)' }}
          >
            От разговор до амбулаторен лист{' '}
            <span style={{ color: 'var(--lp-accent)' }}>за секунди.</span>
          </h1>
          <p
            className="mt-6 max-w-xl text-lg leading-relaxed"
            style={{ color: 'var(--lp-text-muted)' }}
          >
            TuberMed записва консултацията и я превръща в готов, структуриран
            амбулаторен лист на български. Вие преглеждате, поправяте и
            одобрявате — за минута, не за вечер.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Cta href="#access" variant="primary">
              Заявка за достъп
            </Cta>
            <Cta href="#how" variant="secondary">
              Вижте как работи
            </Cta>
          </div>
          <p className="mt-7 text-sm font-medium" style={{ color: 'var(--lp-text-muted)' }}>
            GDPR-съвместим · Обработка в ЕС · Лекарят остава авторът
          </p>
        </Reveal>

        <Reveal delay={120}>
          <HeroDeviceFrame />
        </Reveal>
      </Container>
    </section>
  );
}

// CSS-only product mockup loop (запис → AI обработка → готов лист).
// ⚠ Placeholder: replace the <DeviceScreen> body with a poster + lazy <video>
// once the anonymized screen-capture asset exists.
function HeroDeviceFrame() {
  return (
    <div
      role="img"
      aria-label="Демонстрация: запис на консултацията, AI обработка и готов структуриран амбулаторен лист."
      className="relative mx-auto w-full max-w-md"
    >
      <div
        className="overflow-hidden rounded-2xl bg-white"
        style={{ border: '1px solid var(--lp-border)', boxShadow: '0 30px 60px -24px rgba(20,39,64,0.35)' }}
      >
        {/* window chrome */}
        <div
          className="flex items-center gap-2 px-4 py-3"
          style={{ borderBottom: '1px solid var(--lp-border)', background: 'var(--lp-bg-soft)' }}
          aria-hidden="true"
        >
          <span className="h-3 w-3 rounded-full" style={{ background: '#E2848A' }} />
          <span className="h-3 w-3 rounded-full" style={{ background: '#E6C16B' }} />
          <span className="h-3 w-3 rounded-full" style={{ background: '#8FC9A0' }} />
          <span className="ml-3 text-xs font-medium" style={{ color: 'var(--lp-text-muted)' }}>
            TuberMed · Амбулаторен лист
          </span>
        </div>

        {/* stages */}
        <div className="relative h-[340px] sm:h-[372px]" aria-hidden="true">
          <StageRecord />
          <StageProcess />
          <StageNote />
        </div>
      </div>
    </div>
  );
}

function StageRecord() {
  return (
    <div className="lp-anim lp-stage lp-stage--record flex flex-col items-center justify-center gap-6 px-6">
      <span
        className="flex h-16 w-16 items-center justify-center rounded-full"
        style={{ background: 'var(--lp-bg-tint)', color: 'var(--lp-navy)' }}
      >
        <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Z" />
          <path d="M19 11a7 7 0 0 1-14 0H3a9 9 0 0 0 8 8.94V23h2v-3.06A9 9 0 0 0 21 11h-2Z" />
        </svg>
      </span>
      <div className="lp-anim lp-wave flex h-12 items-center gap-1">
        {WAVE_BARS.map((d, i) => (
          <span
            key={i}
            className="block w-1 rounded-full"
            style={{ height: '100%', background: 'var(--lp-accent)', animationDelay: `${d}ms` }}
          />
        ))}
      </div>
      <p className="text-sm font-semibold" style={{ color: 'var(--lp-navy)' }}>
        Записване · 00:42
      </p>
    </div>
  );
}

function StageProcess() {
  return (
    <div className="lp-anim lp-stage lp-stage--process flex flex-col items-center justify-center gap-5 px-6">
      <span
        className="lp-anim lp-spin block h-12 w-12 rounded-full"
        style={{ border: '3px solid var(--lp-bg-tint)', borderTopColor: 'var(--lp-accent)' }}
      />
      <p className="text-sm font-semibold" style={{ color: 'var(--lp-navy)' }}>
        AI обработка…
      </p>
      <p className="max-w-[16rem] text-center text-xs leading-relaxed" style={{ color: 'var(--lp-text-muted)' }}>
        Транскрипция в ЕС · анамнеза, статус, диагнози, МКБ-10, терапия
      </p>
    </div>
  );
}

function StageNote() {
  return (
    <div className="lp-anim lp-stage lp-stage--note flex flex-col gap-3 px-5 py-5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--lp-navy)' }}>
          Амбулаторен лист
        </span>
        <span
          className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
          style={{ background: '#E3F0EA', color: '#2E7D5B' }}
        >
          ✓ Готов
        </span>
      </div>
      {NOTE_ROWS.map((row) => (
        <div key={row.label} className="flex flex-col gap-1.5">
          <span className="text-[11px] font-semibold" style={{ color: 'var(--lp-accent)' }}>
            {row.label}
          </span>
          {row.lines.map((w, i) => (
            <span
              key={i}
              className="block h-2 rounded-full"
              style={{ width: w, background: 'var(--lp-bg-tint)' }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

const WAVE_BARS = [0, 120, 240, 80, 200, 40, 160, 300, 100, 220, 60, 180, 20, 260, 140, 0];

const NOTE_ROWS = [
  { label: 'Анамнеза', lines: ['100%', '88%'] },
  { label: 'Обективен статус', lines: ['94%', '70%'] },
  { label: 'Диагноза · МКБ-10', lines: ['62%'] },
  { label: 'Терапия', lines: ['90%', '76%'] },
];
