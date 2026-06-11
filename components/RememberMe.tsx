'use client';

// "Запомни ме" — shared by /app/login (both modes) and /signup. Checked
// (default) = session in localStorage (survives a browser restart, the
// pre-checkbox behavior); unchecked = sessionStorage (dies with the browser
// session). Consumed as the `remember` argument of lib/api.ts setSession().
export default function RememberMe({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      className="flex items-center gap-2 cursor-pointer select-none"
      style={{ color: 'var(--color-text-secondary)', fontSize: 13 }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        style={{ accentColor: 'var(--color-accent)', width: 15, height: 15 }}
      />
      Запомни ме
    </label>
  );
}
