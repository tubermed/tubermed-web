'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  loadIal,
  getIalDataSync,
  searchIal,
  totalOptions,
  type IalEntry,
  type SearchHit,
} from '@/lib/ial-meds';
import type { Medication } from '@/lib/types';
import { Dialog } from '@/components/ui/Dialog';

interface MedsPickerProps {
  isOpen: boolean;
  onClose: () => void;
  /** Emits a Medication. The parent decides whether to append (when opened
   *  from "+ Добави медикамент") or replace at a known index (when opened
   *  by tapping an existing row). The picker itself is index-unaware. */
  onPick: (med: Medication) => void;
  /** When set, the picker opens in edit mode: the search query is preset to
   *  the medication's INN, a matching IAL row is auto-expanded with its
   *  form / dose / regimen / duration pre-filled, and the modal title flips
   *  to "Редакция на лекарство". Leaving this undefined preserves the
   *  append-only behaviour used by the "+ Добави медикамент" button. */
  initialMed?: Medication;
}

const NOT_SPECIFIED = 'не е посочена';

/** Treat empty + the literal "не е посочена" as missing, returning '' so
 *  controlled inputs start empty instead of forcing the doctor to delete
 *  the server-placeholder text before typing. */
function sanitizeInitial(v: string | undefined): string {
  if (!v) return '';
  const t = v.trim();
  if (!t || t.toLowerCase() === NOT_SPECIFIED) return '';
  return v;
}

interface InitialFormValues {
  form: string;
  dose: string;
  regimen: string;
  duration: string;
}

export default function MedsPicker({
  isOpen,
  onClose,
  onPick,
  initialMed,
}: MedsPickerProps) {
  const isEditing = !!initialMed;
  const [query, setQuery] = useState('');
  const [data, setData] = useState<IalEntry[] | null>(getIalDataSync());
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [expandedInn, setExpandedInn] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset on open. In edit mode, preset the query to the med's INN so the
  // matching IAL row surfaces immediately and auto-expands below. <Dialog>
  // focuses the search input via initialFocus={inputRef}.
  useEffect(() => {
    if (!isOpen) return;
    setQuery(sanitizeInitial(initialMed?.inn) || '');
    setExpandedInn(null);
  }, [isOpen, initialMed]);

  useEffect(() => {
    if (!isOpen || data) return;
    setLoadErr(null);
    let cancelled = false;
    loadIal()
      .then((rows) => {
        if (!cancelled) setData(rows);
      })
      .catch((e: Error) => {
        if (!cancelled)
          setLoadErr(e.message || 'Грешка при зареждане на ИАЛ');
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, data]);

  // Auto-expand matching IAL entry in edit mode so the doctor lands directly
  // on a pre-filled form.
  useEffect(() => {
    if (!isOpen || !isEditing || !data || !initialMed) return;
    const lower = (initialMed.inn || '').trim().toLowerCase();
    if (!lower) return;
    const match = data.find(
      (e) => e.b.toLowerCase() === lower || e.i.toLowerCase() === lower
    );
    if (match) setExpandedInn(match.i);
  }, [isOpen, isEditing, data, initialMed]);

  // Empty query → most option-rich drugs first (rough usage proxy)
  const hits: SearchHit[] = useMemo(() => {
    if (!data) return [];
    if (!query.trim()) {
      return [...data]
        .sort((a, b) => totalOptions(b) - totalOptions(a))
        .slice(0, 30)
        .map((entry) => ({ entry, matchKind: 'inn-prefix' as const }));
    }
    return searchIal(query, 100);
  }, [data, query]);

  const handlePickMed = useCallback(
    (med: Medication) => {
      onPick(med);
      onClose();
    },
    [onPick, onClose]
  );

  // Initial form values for ExpandedForm. Only seeded when the row being
  // expanded matches initialMed — picking a different drug in edit mode
  // intentionally starts that drug's form blank (with the doctor's typed
  // regimen/duration being theirs to enter).
  const initialFormValues: InitialFormValues | undefined = useMemo(() => {
    if (!isEditing || !initialMed) return undefined;
    return {
      form: sanitizeInitial(initialMed.route),
      dose: sanitizeInitial(initialMed.dose),
      regimen: sanitizeInitial(initialMed.regimen),
      duration: sanitizeInitial(initialMed.duration),
    };
  }, [isEditing, initialMed]);

  function matchesInitial(entry: IalEntry): boolean {
    if (!isEditing || !initialMed) return false;
    const lower = (initialMed.inn || '').trim().toLowerCase();
    if (!lower) return false;
    return (
      entry.b.toLowerCase() === lower || entry.i.toLowerCase() === lower
    );
  }

  if (!isOpen) return null;

  // No IAL hit while editing → fall back to a full manual edit form so the
  // doctor doesn't lose dose/regimen/route/duration when their drug isn't
  // in the IAL register.
  const showManualEdit =
    isEditing &&
    !!initialMed &&
    !!data &&
    hits.length === 0 &&
    query.trim().length > 0;

  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      title={isEditing ? 'Редакция на лекарство' : 'Избор на лекарство'}
      size="lg"
      showClose={false}
      initialFocus={inputRef}
      className="max-h-[85vh] flex flex-col"
    >
        <div
          className="p-5 border-b flex items-center gap-3"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <div className="flex-1 min-w-0">
            <div
              className="font-semibold text-base"
              style={{ color: 'var(--color-ink)' }}
            >
              {isEditing ? 'Редакция на лекарство' : 'Избор на лекарство'}
            </div>
            {data && (
              <div
                className="text-xs mt-0.5"
                style={{ color: 'var(--color-text-muted)' }}
              >
                {data.length.toLocaleString('bg-BG')} INN от ИАЛ ·{' '}
                {data.filter((d) => !d.r).length} БЛП
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Затвори"
            className="text-2xl leading-none w-8 h-8 flex items-center justify-center rounded transition hover:bg-[var(--color-bg)]"
            style={{ color: 'var(--color-text-muted)' }}
          >
            ×
          </button>
        </div>

        <div
          className="p-4 border-b"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setExpandedInn(null);
            }}
            placeholder={
              data
                ? 'Латиница или кирилица: Ибупрофен, Нурофен, Lisinopril...'
                : 'Зарежда се ИАЛ регистър...'
            }
            disabled={!data}
            className="w-full px-3 py-2 rounded-md border outline-none text-sm disabled:opacity-50"
            style={{
              borderColor: 'var(--color-border-mid)',
              background: 'white',
            }}
          />
          {data && (
            <div
              className="text-xs mt-2"
              style={{ color: 'var(--color-text-muted)' }}
            >
              {query.trim()
                ? `${hits.length} ${hits.length === 1 ? 'резултат' : 'резултата'}`
                : 'Най-често предписвани'}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {!data && !loadErr && <LoadingView />}
          {loadErr && (
            <ErrorView
              message={loadErr}
              onRetry={() => {
                setData(null);
                setLoadErr(null);
              }}
            />
          )}
          {showManualEdit && initialMed && (
            <ManualEditForm
              initialMed={initialMed}
              query={query}
              onCommit={handlePickMed}
            />
          )}
          {data && hits.length === 0 && query.trim() && !showManualEdit && (
            <EmptyResultsView
              query={query}
              onAddManual={() => handlePickMed({ inn: query.trim() })}
            />
          )}
          {data && hits.length > 0 && (
            <div className="p-2">
              {hits.map((hit) => {
                const seedThisRow = matchesInitial(hit.entry);
                return (
                  <MedRow
                    key={hit.entry.i}
                    entry={hit.entry}
                    matchKind={hit.matchKind}
                    expanded={expandedInn === hit.entry.i}
                    onToggleExpand={() =>
                      setExpandedInn(
                        expandedInn === hit.entry.i ? null : hit.entry.i
                      )
                    }
                    onCommit={handlePickMed}
                    initialValues={
                      seedThisRow ? initialFormValues : undefined
                    }
                  />
                );
              })}
            </div>
          )}
        </div>
    </Dialog>
  );
}

/* ────────────────────────────────────────────────────────── */

function LoadingView() {
  return (
    <div
      className="p-8 text-center text-sm"
      style={{ color: 'var(--color-text-muted)' }}
    >
      <div className="inline-flex items-center gap-2">
        <span
          className="inline-block w-3 h-3 rounded-full animate-pulse"
          style={{ background: 'var(--color-brand)' }}
        />
        Зарежда се ИАЛ регистър...
      </div>
      <div
        className="text-xs mt-2"
        style={{ color: 'var(--color-text-muted)' }}
      >
        ~80 KB, кешира се след първото зареждане
      </div>
    </div>
  );
}

function ErrorView({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="p-8 text-center">
      <div className="text-sm mb-3" style={{ color: 'var(--color-red)' }}>
        Грешка при зареждане на ИАЛ регистър
        {message && (
          <div
            className="text-xs mt-1 font-[family-name:var(--font-jetbrains)]"
            style={{ color: 'var(--color-text-muted)' }}
          >
            {message}
          </div>
        )}
      </div>
      <button
        onClick={onRetry}
        className="px-4 py-2 rounded-md text-sm text-white transition hover:opacity-90"
        style={{ background: 'var(--color-brand)' }}
      >
        Опитай отново
      </button>
    </div>
  );
}

function EmptyResultsView({
  query,
  onAddManual,
}: {
  query: string;
  onAddManual: () => void;
}) {
  return (
    <div
      className="p-8 text-center text-sm"
      style={{ color: 'var(--color-text-muted)' }}
    >
      Няма резултати за <strong>{query}</strong>
      <div
        className="text-xs mt-2 mb-4"
        style={{ color: 'var(--color-text-muted)' }}
      >
        Опитайте с друго изписване (латиница ↔ кирилица) или добавете ръчно:
      </div>
      <button
        onClick={onAddManual}
        className="px-4 py-2 rounded-md text-sm text-white transition hover:opacity-90"
        style={{ background: 'var(--color-brand)' }}
      >
        + Добави &quot;{query}&quot; ръчно
      </button>
    </div>
  );
}

/** Free-form edit pane shown when the doctor is editing a medication whose
 *  INN isn't in the IAL register. Preserves every field — switching the
 *  search query in this state doesn't drop dose/regimen/route/duration. */
function ManualEditForm({
  initialMed,
  query,
  onCommit,
}: {
  initialMed: Medication;
  query: string;
  onCommit: (med: Medication) => void;
}) {
  const seedInn = sanitizeInitial(initialMed.inn) || query.trim();
  const [inn, setInn] = useState(seedInn);
  const [form, setForm] = useState(sanitizeInitial(initialMed.route));
  const [dose, setDose] = useState(sanitizeInitial(initialMed.dose));
  const [regimen, setRegimen] = useState(
    sanitizeInitial(initialMed.regimen)
  );
  const [duration, setDuration] = useState(
    sanitizeInitial(initialMed.duration)
  );

  // Keep INN synced with the search input until the doctor has typed in it
  // themselves. After mount the doctor's edits stick — we only re-seed when
  // initialMed itself changes (i.e. picker reopened for a different row).
  useEffect(() => {
    setInn(sanitizeInitial(initialMed.inn) || query.trim());
    setForm(sanitizeInitial(initialMed.route));
    setDose(sanitizeInitial(initialMed.dose));
    setRegimen(sanitizeInitial(initialMed.regimen));
    setDuration(sanitizeInitial(initialMed.duration));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMed]);

  function commit() {
    const innVal = inn.trim();
    if (!innVal) return;
    onCommit({
      inn: innVal,
      dose: dose.trim() || undefined,
      regimen: regimen.trim() || undefined,
      route: form.trim() || undefined,
      duration: duration.trim() || undefined,
    });
  }

  return (
    <div className="p-4 space-y-3">
      <div
        className="text-xs"
        style={{ color: 'var(--color-text-muted)' }}
      >
        Лекарството не е в ИАЛ регистъра — редактирай ръчно.
      </div>
      <FieldRow label="Лекарство (INN)">
        <input
          type="text"
          value={inn}
          onChange={(e) => setInn(e.target.value)}
          className="w-full px-2 py-1.5 rounded text-sm border outline-none bg-white"
          style={{ borderColor: 'var(--color-border-mid)' }}
        />
      </FieldRow>
      <div className="grid grid-cols-2 gap-2">
        <FieldRow label="Форма / Път">
          <input
            type="text"
            value={form}
            onChange={(e) => setForm(e.target.value)}
            placeholder="напр. таблетки, р.о."
            className="w-full px-2 py-1.5 rounded text-sm border outline-none bg-white"
            style={{ borderColor: 'var(--color-border-mid)' }}
          />
        </FieldRow>
        <FieldRow label="Доза">
          <input
            type="text"
            value={dose}
            onChange={(e) => setDose(e.target.value)}
            placeholder="напр. 200 мг"
            className="w-full px-2 py-1.5 rounded text-sm border outline-none bg-white"
            style={{ borderColor: 'var(--color-border-mid)' }}
          />
        </FieldRow>
      </div>
      <FieldRow label="Прием">
        <input
          type="text"
          value={regimen}
          onChange={(e) => setRegimen(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
          }}
          placeholder="напр. 1 т. 3 пъти дневно"
          className="w-full px-2 py-1.5 rounded text-sm border outline-none bg-white"
          style={{ borderColor: 'var(--color-border-mid)' }}
        />
      </FieldRow>
      <FieldRow label="Продължителност">
        <input
          type="text"
          value={duration}
          onChange={(e) => setDuration(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
          }}
          placeholder="напр. 7 дни"
          className="w-full px-2 py-1.5 rounded text-sm border outline-none bg-white"
          style={{ borderColor: 'var(--color-border-mid)' }}
        />
      </FieldRow>
      <button
        onClick={commit}
        disabled={!inn.trim()}
        className="w-full py-2 rounded-md text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
        style={{ background: 'var(--gradient-brand)' }}
      >
        + Добави в плана
      </button>
    </div>
  );
}

function FieldRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        className="block text-[10px] uppercase tracking-wider mb-1 font-semibold"
        style={{ color: 'var(--color-text-muted)' }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}

function MedRow({
  entry,
  matchKind,
  expanded,
  onToggleExpand,
  onCommit,
  initialValues,
}: {
  entry: IalEntry;
  matchKind: SearchHit['matchKind'];
  expanded: boolean;
  onToggleExpand: () => void;
  onCommit: (med: Medication) => void;
  initialValues?: InitialFormValues;
}) {
  return (
    <div
      className="rounded-md mb-1 transition"
      style={{
        background: expanded ? 'var(--color-brand-light)' : 'transparent',
      }}
    >
      <button
        onClick={onToggleExpand}
        className="w-full flex items-center gap-3 px-3 py-2.5 text-left rounded-md hover:bg-[var(--color-bg)] transition"
      >
        <div className="flex-1 min-w-0">
          <div
            className="text-sm font-medium leading-tight truncate"
            style={{ color: 'var(--color-text)' }}
          >
            {entry.b}
          </div>
          <div
            className="text-[11px] mt-0.5 truncate font-[family-name:var(--font-jetbrains)]"
            style={{ color: 'var(--color-text-muted)' }}
          >
            {entry.i}
            {entry.a ? ' · ' + entry.a : ''}
            {matchKind === 'brand' ? ' · търговско име' : ''}
          </div>
        </div>
        <Badge rx={entry.r} />
        <span
          className="text-xs flex-shrink-0"
          style={{ color: 'var(--color-text-muted)' }}
        >
          {expanded ? '▴' : '▾'}
        </span>
      </button>

      {expanded && (
        <ExpandedForm
          entry={entry}
          onCommit={onCommit}
          initialValues={initialValues}
        />
      )}
    </div>
  );
}

function ExpandedForm({
  entry,
  onCommit,
  initialValues,
}: {
  entry: IalEntry;
  onCommit: (med: Medication) => void;
  initialValues?: InitialFormValues;
}) {
  // If the doctor's existing form/dose aren't in the IAL options, prepend
  // them as additional choices so the selects can still represent the
  // current value. Without this, an existing dose like "200 мг" might be
  // missing from the dropdown for a form that only lists "400 мг" / "600 мг".
  const forms = useMemo(() => {
    const base = Object.keys(entry.fd);
    const seed = initialValues?.form;
    if (seed && !base.includes(seed)) return [seed, ...base];
    return base;
  }, [entry.fd, initialValues?.form]);

  const [form, setForm] = useState<string>(
    initialValues?.form || forms[0] || ''
  );

  const doses = useMemo(() => {
    const base = form ? entry.fd[form] || [] : [];
    const seed = initialValues?.dose;
    if (
      seed &&
      form === initialValues?.form &&
      !base.includes(seed)
    ) {
      return [seed, ...base];
    }
    return base;
  }, [entry.fd, form, initialValues?.dose, initialValues?.form]);

  const [dose, setDose] = useState<string>(
    initialValues?.dose || doses[0] || ''
  );

  // When form changes, reset dose to the first option of the new form —
  // unless the seeded dose still fits the new form's option list.
  useEffect(() => {
    if (
      initialValues?.dose &&
      form === initialValues.form &&
      doses.includes(initialValues.dose)
    ) {
      setDose(initialValues.dose);
    } else {
      setDose(doses[0] || '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, doses]);

  const [regimen, setRegimen] = useState(initialValues?.regimen || '');
  const [duration, setDuration] = useState(
    initialValues?.duration || ''
  );

  function commit() {
    onCommit({
      inn: entry.b, // Bulgarian as primary display
      dose: dose || undefined,
      regimen: regimen.trim() || undefined,
      route: form || undefined,
      duration: duration.trim() || undefined,
    });
  }

  return (
    <div
      className="px-3 pb-3 pt-1 space-y-2 border-t"
      style={{ borderColor: 'var(--color-border)' }}
    >
      {forms.length === 0 ? (
        <div
          className="text-xs py-2"
          style={{ color: 'var(--color-text-muted)' }}
        >
          Няма данни за форма/доза от ИАЛ — въведете ръчно по-долу.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label
              className="block text-[10px] uppercase tracking-wider mb-1 font-semibold"
              style={{ color: 'var(--color-text-muted)' }}
            >
              Форма
              {forms.length > 1 && (
                <span
                  className="ml-1 normal-case font-normal"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  ({forms.length})
                </span>
              )}
            </label>
            {forms.length === 1 ? (
              <div
                className="px-2 py-1.5 rounded text-sm border bg-white"
                style={{
                  borderColor: 'var(--color-border-light)',
                  color: 'var(--color-text)',
                }}
              >
                {forms[0]}
              </div>
            ) : (
              <select
                value={form}
                onChange={(e) => setForm(e.target.value)}
                className="w-full px-2 py-1.5 rounded text-sm border outline-none bg-white"
                style={{ borderColor: 'var(--color-border-mid)' }}
              >
                {forms.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div>
            <label
              className="block text-[10px] uppercase tracking-wider mb-1 font-semibold"
              style={{ color: 'var(--color-text-muted)' }}
            >
              Доза
              {doses.length > 1 && (
                <span
                  className="ml-1 normal-case font-normal"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  ({doses.length})
                </span>
              )}
            </label>
            {doses.length === 1 ? (
              <div
                className="px-2 py-1.5 rounded text-sm border bg-white truncate"
                style={{
                  borderColor: 'var(--color-border-light)',
                  color: 'var(--color-text)',
                }}
                title={doses[0]}
              >
                {doses[0]}
              </div>
            ) : doses.length === 0 ? (
              <input
                type="text"
                value={dose}
                onChange={(e) => setDose(e.target.value)}
                placeholder="напр. 200 мг"
                className="w-full px-2 py-1.5 rounded text-sm border outline-none bg-white"
                style={{ borderColor: 'var(--color-border-mid)' }}
              />
            ) : (
              <select
                value={dose}
                onChange={(e) => setDose(e.target.value)}
                className="w-full px-2 py-1.5 rounded text-sm border outline-none bg-white"
                style={{ borderColor: 'var(--color-border-mid)' }}
              >
                {doses.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
      )}

      <div>
        <label
          className="block text-[10px] uppercase tracking-wider mb-1 font-semibold"
          style={{ color: 'var(--color-text-muted)' }}
        >
          Прием
        </label>
        <input
          type="text"
          value={regimen}
          onChange={(e) => setRegimen(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
          }}
          placeholder="например 1 т. 3 пъти дневно"
          className="w-full px-2 py-1.5 rounded text-sm border outline-none"
          style={{ borderColor: 'var(--color-border-mid)' }}
        />
      </div>

      <div>
        <label
          className="block text-[10px] uppercase tracking-wider mb-1 font-semibold"
          style={{ color: 'var(--color-text-muted)' }}
        >
          Продължителност
        </label>
        <input
          type="text"
          value={duration}
          onChange={(e) => setDuration(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
          }}
          placeholder="напр. 7 дни"
          className="w-full px-2 py-1.5 rounded text-sm border outline-none"
          style={{ borderColor: 'var(--color-border-mid)' }}
        />
      </div>

      <button
        onClick={commit}
        className="w-full py-2 rounded-md text-sm font-medium text-white transition hover:opacity-90"
        style={{ background: 'var(--gradient-brand)' }}
      >
        + Добави в плана
      </button>
    </div>
  );
}

function Badge({ rx }: { rx: boolean }) {
  return (
    <span
      className="text-[10px] font-bold px-2 py-1 rounded flex-shrink-0"
      style={{
        background: rx ? 'var(--color-brand)' : 'var(--color-ok-soft)',
        color: rx ? 'white' : 'var(--color-ok)',
      }}
      title={rx ? 'Изисква рецепта' : 'Без лекарско предписание'}
    >
      {rx ? 'Rx' : 'БЛП'}
    </span>
  );
}
