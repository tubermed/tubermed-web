'use client';

import { useEffect, useRef, useState } from 'react';

interface EditableFieldProps {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
}

export default function EditableField({
  value,
  onChange,
  placeholder = 'Не е споменато',
}: EditableFieldProps) {
  const [editing, setEditing] = useState(false);
  const [local, setLocal] = useState(value);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Sync local when parent value changes externally (e.g. new consultation)
  useEffect(() => {
    setLocal(value);
  }, [value]);

  // Autosize + focus on entering edit mode
  useEffect(() => {
    if (editing && textareaRef.current) {
      const t = textareaRef.current;
      t.style.height = 'auto';
      t.style.height = t.scrollHeight + 'px';
      t.focus();
      t.setSelectionRange(0, 0);
      t.scrollTop = 0;
    }
  }, [editing]);

  function commit() {
    setEditing(false);
    if (local !== value) onChange(local);
  }

  if (editing) {
    return (
      <textarea
        ref={textareaRef}
        value={local}
        onChange={(e) => {
          setLocal(e.target.value);
          e.currentTarget.style.height = 'auto';
          e.currentTarget.style.height =
            e.currentTarget.scrollHeight + 'px';
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.currentTarget.blur();
          }
        }}
        className="w-full px-3 py-2 rounded-md border outline-none resize-none leading-relaxed text-base"
        style={{
          borderColor: 'var(--color-brand)',
          background: 'var(--color-brand-light)',
          color: 'var(--color-text)',
          fontFamily: 'var(--font-sans)',
        }}
      />
    );
  }

  const hasContent = value.trim().length > 0;
  return (
    <div
      onClick={() => setEditing(true)}
      title="Кликни за редакция"
      className="px-3 py-2 rounded-md cursor-text leading-relaxed text-base hover:bg-[var(--color-brand-light)] transition-colors whitespace-pre-wrap"
      style={{
        color: hasContent
          ? 'var(--color-text)'
          : 'var(--color-text-hint)',
        minHeight: '38px',
      }}
    >
      {hasContent ? (
        value
      ) : (
        <em className="italic text-sm">{placeholder}</em>
      )}
    </div>
  );
}
