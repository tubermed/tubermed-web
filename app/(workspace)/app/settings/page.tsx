'use client';

// Настройки — doctor profile + practice/document identity + security.
// Lives in the (workspace) route group, so the auth gate + AppShell come from
// app/(workspace)/layout.tsx; this page renders only the inner content. Uses the
// workspace --color-* tokens (NOT the landing --lp-* set) and the shared
// SpecialtyTypeahead / PasswordInput. Loads via api.me(), saves via
// api.updateMe(); password change via api.changePassword. Deliberately scoped to
// safe, durable settings — no templates / data-retention / consent / team /
// billing / language selection.
//
// Layout: a left sub-nav selects one of four panes (local state, no routing).
// Flicker fix: the form is SEEDED synchronously from getSession() on first
// render (Име / Специалност / Място на работа are correct immediately), and the
// me()-only fields (practice/document) render skeletons until me() resolves —
// never an empty input that then fills.

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, clearSession, getSession, updateSessionDoctor, ApiError } from '@/lib/api';
import type { DoctorInfo, MeResponse, UpdateMePayload } from '@/lib/api';
import { useDoctorContext } from '@/components/DoctorContext';
import SpecialtyTypeahead from '@/components/SpecialtyTypeahead';
import PasswordInput from '@/components/PasswordInput';
import SkeletonInput from '@/components/SkeletonInput';
import { NoteSectionHead } from '@/components/ui/NoteSection';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Field, TextInput } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';

const APP_VERSION = '0.1.0';
// Placeholder support address — confirm the real one before pilot. Claim-free:
// no data-retention / residency / processor wording here (pre-attorney).
const SUPPORT_EMAIL = 'support@tubermed.com';

type PaneKey = 'profile' | 'practice' | 'security' | 'about';

interface ProfileForm {
  name: string;
  specialty: string;
  org_name: string;
  practice_address: string;
  rzi_number: string;
  nzok_contract: string;
  practice_phone: string;
  uin: string;
}

const EMPTY_FORM: ProfileForm = {
  name: '',
  specialty: '',
  org_name: '',
  practice_address: '',
  rzi_number: '',
  nzok_contract: '',
  practice_phone: '',
  uin: '',
};

function formFromMe(m: MeResponse): ProfileForm {
  return {
    name: m.name ?? '',
    specialty: m.specialty ?? '',
    org_name: m.organizationName ?? '',
    practice_address: m.practice_address ?? '',
    rzi_number: m.rzi_number ?? '',
    nzok_contract: m.nzok_contract ?? '',
    practice_phone: m.practice_phone ?? '',
    uin: m.uin ?? '',
  };
}

// Instant seed from the cached login session so the common fields paint correct
// on first render (no empty-then-fill). The runtime session doctor carries
// organizationName (login response), now declared on DoctorInfo.
function seedFromSession(): ProfileForm {
  const d = getSession()?.doctor;
  if (!d) return EMPTY_FORM;
  return {
    ...EMPTY_FORM,
    name: d.name ?? '',
    specialty: d.specialty ?? '',
    org_name: d.organizationName ?? '',
  };
}

// Include a field in the PATCH only when it's non-empty AND changed from the
// loaded value: empty never blanks (backend contract), and skipping an unchanged
// org_name avoids needless org-slug regeneration on every save.
function changedValue(current: string, loaded: string | null | undefined): string | undefined {
  const t = current.trim();
  if (!t) return undefined;
  if (t === (loaded ?? '').trim()) return undefined;
  return t;
}

export default function SettingsPage() {
  const router = useRouter();
  // Live sidebar channel (provided by app/(workspace)/layout.tsx). Null-safe:
  // null when no provider is mounted — the save then still persists via the
  // session merge, so a reload reflects it.
  const doctorCtx = useDoctorContext();

  const [pane, setPane] = useState<PaneKey>('profile');
  const [me, setMe] = useState<MeResponse | null>(null);
  const [form, setForm] = useState<ProfileForm>(seedFromSession);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  // True once the user starts editing — guards the me() reconcile from
  // clobbering an in-progress edit (the seed/reconcile races the fetch).
  const userEditedRef = useRef(false);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);

  const [pwCurrent, setPwCurrent] = useState('');
  const [pwNext, setPwNext] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [pwConfirmError, setPwConfirmError] = useState<string | null>(null);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwOk, setPwOk] = useState(false);
  const [pwSaving, setPwSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .me()
      .then((m) => {
        if (!alive) return;
        setMe(m);
        // Reconcile to the server truth ONLY if the user hasn't started editing
        // (otherwise the seed-vs-fetch race would wipe their in-progress edit).
        if (!userEditedRef.current) setForm(formFromMe(m));
        setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setLoadError(true);
        setLoading(false); // stop skeletons; keep the session-seeded values
      });
    return () => {
      alive = false;
    };
  }, []);

  function setField(key: keyof ProfileForm, value: string) {
    userEditedRef.current = true;
    setForm((f) => ({ ...f, [key]: value }));
    setSaveOk(false);
    setSaveError(null);
  }

  async function saveProfile() {
    setSaveError(null);
    setSaveOk(false);

    const payload: UpdateMePayload = {};
    const next = (cur: string, loaded: string | null | undefined) => changedValue(cur, loaded);
    const n = next(form.name, me?.name);
    if (n !== undefined) payload.name = n;
    const s = next(form.specialty, me?.specialty);
    if (s !== undefined) payload.specialty = s;
    const o = next(form.org_name, me?.organizationName);
    if (o !== undefined) payload.org_name = o;
    const ad = next(form.practice_address, me?.practice_address);
    if (ad !== undefined) payload.practice_address = ad;
    const rz = next(form.rzi_number, me?.rzi_number);
    if (rz !== undefined) payload.rzi_number = rz;
    const nz = next(form.nzok_contract, me?.nzok_contract);
    if (nz !== undefined) payload.nzok_contract = nz;
    const ph = next(form.practice_phone, me?.practice_phone);
    if (ph !== undefined) payload.practice_phone = ph;
    const u = next(form.uin, me?.uin);
    if (u !== undefined) payload.uin = u;

    if (Object.keys(payload).length === 0) {
      setSaveOk(true);
      return;
    }

    setSaving(true);
    try {
      const updated = await api.updateMe(payload);
      setMe(updated);
      setForm(formFromMe(updated));
      // Propagate the saved identity to the sidebar — both facets. Build the
      // doctor partial ONLY from non-empty fields on the server truth (mirrors
      // the form's "non-empty" discipline; never blanks specialty/org if the
      // response omits one — DoctorInfo.specialty is non-nullable, org nullable).
      const doctorPatch: Partial<DoctorInfo> = {};
      if (updated.name) doctorPatch.name = updated.name;
      if (updated.specialty) doctorPatch.specialty = updated.specialty;
      if (updated.organizationName) doctorPatch.organizationName = updated.organizationName;
      if (Object.keys(doctorPatch).length > 0) {
        updateSessionDoctor(doctorPatch);                              // (A) reload-persistent
        doctorCtx?.setDoctor((d) => (d ? { ...d, ...doctorPatch } : d)); // (B) live re-render
      }
      setSaveOk(true);
    } catch (err) {
      setSaveError(
        err instanceof ApiError
          ? err.message
          : 'Възникна грешка при запазването. Опитайте отново.',
      );
    } finally {
      setSaving(false);
    }
  }

  async function changePassword() {
    setPwError(null);
    setPwOk(false);
    if (pwNext.length < 10) {
      setPwError('Новата парола трябва да е поне 10 знака.');
      return;
    }
    if (pwNext !== pwConfirm) {
      setPwConfirmError('Паролите не съвпадат');
      return;
    }
    setPwSaving(true);
    try {
      await api.changePassword({ current_password: pwCurrent, new_password: pwNext });
      setPwOk(true);
      setPwCurrent('');
      setPwNext('');
      setPwConfirm('');
      setPwConfirmError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 400 && err.message === 'password_change_unavailable') {
        setPwError('Този акаунт използва PIN за вход — смяната на парола не е налична тук.');
      } else if (err instanceof ApiError) {
        setPwError(err.message); // 401 „Грешна текуща парола." и др. вече са на български
      } else {
        setPwError('Възникна грешка. Опитайте отново.');
      }
    } finally {
      setPwSaving(false);
    }
  }

  function logout() {
    clearSession();
    router.replace('/app/login');
  }

  const saveBar = (
    <div className="flex items-center justify-end gap-3 mt-5">
      {saveError && (
        <span role="alert" className="text-sm mr-auto" style={{ color: 'var(--color-danger)' }}>
          {saveError}
        </span>
      )}
      {saveOk && !saveError && (
        <span className="text-sm mr-auto" style={{ color: 'var(--color-ok)' }}>
          Запазено.
        </span>
      )}
      <Button variant="primary" onClick={saveProfile} disabled={saving || loading}>
        {saving ? 'Запазване…' : 'Запази промените'}
      </Button>
    </div>
  );

  return (
    <div className="flex-1 flex flex-col sm:flex-row min-w-0">
      {/* Secondary rail — flush against the dark app sidebar: a vertical panel
          on sm+, collapsing to a wrapping row above the content on narrow. */}
      <nav
        className="flex flex-row sm:flex-col flex-wrap gap-1 p-3 sm:p-4 sm:w-56 sm:flex-shrink-0 border-b sm:border-b-0 sm:border-r"
        style={{ background: 'var(--color-surface-tint)', borderColor: 'var(--color-border)' }}
      >
        {PANES.map((p) => (
          <SubNavItem
            key={p.key}
            label={p.label}
            icon={p.icon}
            active={pane === p.key}
            onClick={() => setPane(p.key)}
          />
        ))}
      </nav>

      {/* Content pane — fills the remaining width; the form is held to a readable
          measure and left-aligned so the rail + content read as one product. */}
      <div className="flex-1 min-w-0 px-6 sm:px-8 py-8">
        <div className="max-w-2xl">
          <header className="mb-6">
            <h1 className="text-xl font-semibold" style={{ color: 'var(--color-heading)' }}>
              Настройки
            </h1>
            <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>
              Вашите данни и предпочитания.
            </p>
          </header>

          {loadError && (
            <div
              role="alert"
              className="text-sm px-4 py-3 rounded-md mb-6"
              style={{ background: 'var(--color-danger-soft)', color: 'var(--color-danger)' }}
            >
              Профилът не можа да се зареди. Опитайте да презаредите страницата.
            </div>
          )}
          {pane === 'profile' && (
            <Pane title="Профил" icon="user">
              <div className="flex flex-col gap-4">
                <Field label="Име">
                  <TextInput
                    value={form.name}
                    onChange={(e) => setField('name', e.target.value)}
                    placeholder="напр. д-р Мария Иванова"
                    autoComplete="name"
                    maxLength={120}
                  />
                </Field>
                <Field label="Специалност">
                  <SpecialtyTypeahead value={form.specialty} onChange={(v) => setField('specialty', v)} />
                </Field>
                <Field label="Място на работа">
                  <TextInput
                    value={form.org_name}
                    onChange={(e) => setField('org_name', e.target.value)}
                    placeholder="напр. АИППМП Здраве"
                    maxLength={200}
                  />
                </Field>
              </div>
              {saveBar}
            </Pane>
          )}

          {pane === 'practice' && (
            <Pane title="Практика и документ" icon="file-text">
              <p className="text-xs mb-4" style={{ color: 'var(--color-text-muted)' }}>
                Тези данни се отпечатват в горната част на Амбулаторния лист.
              </p>
              <div className="flex flex-col gap-4">
                <Field label="Адрес">
                  {loading ? (
                    <SkeletonInput />
                  ) : (
                    <TextInput
                      value={form.practice_address}
                      onChange={(e) => setField('practice_address', e.target.value)}
                      placeholder="напр. гр. Пловдив, ул. Цар Борис III 12"
                      maxLength={200}
                    />
                  )}
                </Field>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label="Рег. № на лечебното заведение (РЗИ)">
                    {loading ? (
                      <SkeletonInput />
                    ) : (
                      <TextInput
                        value={form.rzi_number}
                        onChange={(e) => setField('rzi_number', e.target.value)}
                        maxLength={200}
                      />
                    )}
                  </Field>
                  <Field label="Договор с НЗОК №">
                    {loading ? (
                      <SkeletonInput />
                    ) : (
                      <TextInput
                        value={form.nzok_contract}
                        onChange={(e) => setField('nzok_contract', e.target.value)}
                        maxLength={200}
                      />
                    )}
                  </Field>
                  <Field label="Телефон">
                    {loading ? (
                      <SkeletonInput />
                    ) : (
                      <TextInput
                        value={form.practice_phone}
                        onChange={(e) => setField('practice_phone', e.target.value)}
                        placeholder="напр. 032 123 456"
                        autoComplete="tel"
                        maxLength={200}
                      />
                    )}
                  </Field>
                  <Field label="УИН">
                    {loading ? (
                      <SkeletonInput />
                    ) : (
                      <TextInput
                        value={form.uin}
                        onChange={(e) => setField('uin', e.target.value)}
                        placeholder="Уникален идентификационен номер"
                        maxLength={32}
                      />
                    )}
                  </Field>
                </div>
              </div>
              {saveBar}
            </Pane>
          )}

          {pane === 'security' && (
            <Pane title="Сигурност" icon="lock">
              <div className="flex flex-col gap-6">
                <div>
                  <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--color-text-primary)' }}>
                    Смяна на парола
                  </h3>
                  <div className="flex flex-col gap-4 max-w-sm">
                    <Field label="Текуща парола">
                      <PasswordInput
                        value={pwCurrent}
                        autoComplete="current-password"
                        onChange={(e) => {
                          setPwCurrent(e.target.value);
                          setPwError(null);
                          setPwOk(false);
                        }}
                      />
                    </Field>
                    <Field label="Нова парола (поне 10 знака)">
                      <PasswordInput
                        value={pwNext}
                        autoComplete="new-password"
                        onChange={(e) => {
                          setPwNext(e.target.value);
                          setPwError(null);
                          setPwOk(false);
                          if (pwConfirmError && e.target.value === pwConfirm) setPwConfirmError(null);
                        }}
                      />
                    </Field>
                    <Field label="Повтори новата парола">
                      <PasswordInput
                        value={pwConfirm}
                        autoComplete="new-password"
                        onChange={(e) => {
                          setPwConfirm(e.target.value);
                          if (pwConfirmError && pwNext === e.target.value) setPwConfirmError(null);
                        }}
                        onBlur={() => {
                          if (pwConfirm && pwNext !== pwConfirm) setPwConfirmError('Паролите не съвпадат');
                        }}
                      />
                    </Field>
                    {pwConfirmError && (
                      <span role="alert" className="text-sm" style={{ color: 'var(--color-danger)' }}>
                        {pwConfirmError}
                      </span>
                    )}
                    {pwError && (
                      <span role="alert" className="text-sm" style={{ color: 'var(--color-danger)' }}>
                        {pwError}
                      </span>
                    )}
                    {pwOk && (
                      <span className="text-sm" style={{ color: 'var(--color-ok)' }}>
                        Паролата е сменена.
                      </span>
                    )}
                    <div>
                      <Button variant="primary" onClick={changePassword} disabled={pwSaving}>
                        {pwSaving ? 'Запазване…' : 'Смени паролата'}
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="pt-5" style={{ borderTop: '1px solid var(--color-border)' }}>
                  <Button variant="danger" onClick={logout}>
                    Изход
                  </Button>
                </div>
              </div>
            </Pane>
          )}

          {pane === 'about' && (
            <Pane title="За приложението" icon="info">
              <div className="text-sm flex flex-col gap-1" style={{ color: 'var(--color-text-muted)' }}>
                <div>
                  <span className="font-medium" style={{ color: 'var(--color-text-primary)' }}>
                    TuberMed
                  </span>{' '}
                  · версия {APP_VERSION}
                </div>
                <div>Поддръжка: {SUPPORT_EMAIL}</div>
              </div>
            </Pane>
          )}
        </div>
      </div>
    </div>
  );
}

// Calm-clinical pane — ONE hairline sheet (whisper shadow) with a NoteSectionHead
// group label (tick + UPPERCASE navy label + hairline), replacing the old elevated
// tinted-header SectionCard. Matches the result/scribe house style.
function Pane({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: IconName;
  children: React.ReactNode;
}) {
  return (
    <div
      className="bg-white rounded-2xl border p-6 sm:p-8"
      style={{ borderColor: 'var(--color-border)', boxShadow: 'var(--shadow-card)' }}
    >
      <NoteSectionHead title={title} icon={icon ? <Icon name={icon} /> : undefined} />
      {children}
    </div>
  );
}

// ── Sub-nav config + presentational helpers (workspace --color-* tokens) ──

const PANES: { key: PaneKey; label: string; icon: React.ReactNode }[] = [
  { key: 'profile', label: 'Профил', icon: <ProfileIcon /> },
  { key: 'practice', label: 'Практика и документ', icon: <PracticeIcon /> },
  { key: 'security', label: 'Сигурност', icon: <SecurityIcon /> },
  { key: 'about', label: 'За приложението', icon: <AboutIcon /> },
];

function SubNavItem({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className="flex items-center gap-2.5 px-3 py-2 rounded-md text-sm text-left transition-colors sm:w-full focus-ring"
      style={
        active
          ? { background: 'var(--color-accent-soft)', color: 'var(--color-ink)', fontWeight: 500 }
          : { background: 'transparent', color: 'var(--color-text-secondary)', fontWeight: 400 }
      }
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = 'var(--color-bg-subtle)';
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = 'transparent';
      }}
    >
      <span className="w-4 h-4 flex items-center justify-center flex-shrink-0">{icon}</span>
      <span className="whitespace-nowrap">{label}</span>
    </button>
  );
}

function NavIcon({ children }: { children: React.ReactNode }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}
function ProfileIcon() {
  return (
    <NavIcon>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0116 0" />
    </NavIcon>
  );
}
function PracticeIcon() {
  return (
    <NavIcon>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 7h8M8 11h8M8 15h5" />
    </NavIcon>
  );
}
function SecurityIcon() {
  return (
    <NavIcon>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 018 0v3" />
    </NavIcon>
  );
}
function AboutIcon() {
  return (
    <NavIcon>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </NavIcon>
  );
}
