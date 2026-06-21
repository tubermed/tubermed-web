// Shared button primitive for the workspace — the brand-navy action treatment.
//
// The `primary` and `secondary` variants reproduce the new-visit action-bar
// buttons EXACTLY (same class strings + inline styles), so lifting them here
// leaves new-visit byte-identical while Настройки and Пациенти adopt the same
// look. `danger` is the outline-red variant (e.g. Изход).
//
//   primary   — filled accent CTA (white text, soft accent shadow), hover + press
//   secondary — navy-outline on transparent, press
//   danger    — red-outline on transparent, press
//   toolbar   — small bordered ghost (px-3 py-1.5, hover bg) for action bars;
//               reproduces the old result-page TopbarBtn byte-for-byte

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'toolbar';

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary:
    'inline-flex items-center gap-2 text-sm px-5 py-2.5 rounded-md text-white font-medium transition hover:opacity-95 active:scale-[0.985] motion-reduce:active:scale-100 disabled:opacity-50 disabled:cursor-not-allowed',
  secondary:
    'text-sm px-4 py-2 rounded-md font-medium transition active:scale-[0.985] motion-reduce:active:scale-100 disabled:opacity-50 disabled:cursor-not-allowed',
  danger:
    'text-sm px-4 py-2 rounded-md font-medium transition active:scale-[0.985] motion-reduce:active:scale-100 disabled:opacity-50 disabled:cursor-not-allowed',
  toolbar:
    'px-3 py-1.5 rounded-md text-sm font-medium border transition hover:bg-[var(--color-bg)] disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1.5',
};

const VARIANT_STYLE: Record<ButtonVariant, React.CSSProperties> = {
  primary: { background: 'var(--color-accent)', boxShadow: '0 2px 8px rgba(39, 76, 119, 0.25)' },
  secondary: { background: 'transparent', color: 'var(--color-brand)', border: '1px solid var(--color-brand)' },
  danger: { background: 'transparent', color: 'var(--color-danger)', border: '1px solid var(--color-border-strong)' },
  toolbar: { borderColor: 'var(--color-border-mid)', color: 'var(--color-text-muted)' },
};

export function Button({
  variant = 'primary',
  className = '',
  style,
  type,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; 'data-tour'?: string }) {
  return (
    <button
      type={type ?? 'button'}
      className={`${VARIANT_CLASS[variant]} focus-ring ${className}`.trim()}
      style={{ ...VARIANT_STYLE[variant], ...style }}
      {...rest}
    >
      {children}
    </button>
  );
}
