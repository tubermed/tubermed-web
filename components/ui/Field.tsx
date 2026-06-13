// Shared field primitives for the workspace forms — the navy-system label and
// the navy-outlined text input. Lifted from the new-visit form so Настройки and
// Пациенти render fields identically to new-visit.
//
//   FieldLabel — the 11px field caption (was private to PatientForm.tsx)
//   Field      — a FieldLabel above its control
//   TextInput  — a drop-in <input> on the shared `.nv-field` treatment (1.5px
//                navy outline, --control-h height, CSS hover/focus ring). Focus
//                and hover live in globals.css, so no JS focus handlers are needed.

export function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="block mb-1.5 font-medium"
      style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}
    >
      {children}
    </span>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      {children}
    </div>
  );
}

export function TextInput({ className = '', type, ...rest }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input type={type ?? 'text'} className={`nv-field ${className}`.trim()} {...rest} />;
}
