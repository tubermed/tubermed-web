// Elevated brand-navy card primitives — the single source for the "raised"
// surface treatment shared across new-visit, Настройки, and Пациенти.
//
// Lifted verbatim from the new-visit redesign (was private to PatientForm.tsx)
// so every screen references ONE definition — no copy-pasted style drift. The
// design tokens (--color-bg-surface / --color-border-soft / --shadow-raised /
// --radius-lg / --color-surface-tint / --color-heading / --color-text-muted-new)
// and the `.nv-card-enter` mount animation already live in app/globals.css.
//
//   Card          — bare elevated surface (white, hairline border, raised shadow)
//   SectionHeader — tinted header band: optional navy icon tile + navy title +
//                   muted subtitle + optional right-aligned `action` slot
//   SectionCard   — Card + SectionHeader + a 16px body (the new-visit composite)

type CardProps = React.HTMLAttributes<HTMLElement> & {
  /** Apply the fade+rise mount animation (reduced-motion-safe in globals.css). */
  enter?: boolean;
  'data-tour'?: string;
};

export function Card({ enter = false, className = '', style, children, ...rest }: CardProps) {
  return (
    <section
      className={[enter ? 'nv-card-enter' : '', className].filter(Boolean).join(' ')}
      style={{
        background: 'var(--color-bg-surface)',
        border: '1px solid var(--color-border-soft)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-raised)',
        ...style,
      }}
      {...rest}
    >
      {children}
    </section>
  );
}

export function SectionHeader({
  title,
  subtitle,
  icon,
  action,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  /** Optional right-aligned control (e.g. a count badge or a Save button). */
  action?: React.ReactNode;
}) {
  return (
    <div
      className="flex items-center gap-3 px-4 py-3"
      style={{
        background: 'var(--color-surface-tint)',
        borderBottom: '1px solid var(--color-border-soft)',
        borderTopLeftRadius: 'var(--radius-lg)',
        borderTopRightRadius: 'var(--radius-lg)',
      }}
    >
      {icon && (
        <span
          aria-hidden
          className="flex items-center justify-center flex-shrink-0"
          style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--color-accent)', color: '#fff' }}
        >
          {icon}
        </span>
      )}
      <div className="flex flex-col min-w-0">
        <h3 className="font-medium leading-tight truncate" style={{ fontSize: '15px', color: 'var(--color-heading)' }}>
          {title}
        </h3>
        {subtitle && (
          <span className="leading-tight truncate" style={{ fontSize: '12px', color: 'var(--color-text-muted-new)', marginTop: '1px' }}>
            {subtitle}
          </span>
        )}
      </div>
      {action && <div className="ml-auto flex-shrink-0">{action}</div>}
    </div>
  );
}

// Elevated section card: surface + hairline + raised shadow, a tinted header
// band (navy icon tile + heading + one-line subtitle), and a 16px body. Chrome
// only — `dataTour` + `children` pass straight through. overflow stays VISIBLE so
// an absolutely-positioned dropdown inside the body is never clipped.
export function SectionCard({
  title,
  subtitle,
  icon,
  children,
  dataTour,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  dataTour?: string;
}) {
  return (
    <Card enter data-tour={dataTour}>
      <SectionHeader title={title} subtitle={subtitle} icon={icon} />
      <div className="px-4 py-4">{children}</div>
    </Card>
  );
}
