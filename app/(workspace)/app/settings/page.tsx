'use client';

// Настройки v1 — doctor profile + practice/document identity + security.
// Lives in the (workspace) route group, so the auth gate + AppShell come from
// app/(workspace)/layout.tsx; this page renders only the inner content. Uses the
// workspace --color-* tokens (NOT the landing --lp-* set) and the shared
// SpecialtyTypeahead / PasswordInput, matching the SectionCard look from
// PatientForm. Loads via api.me(), saves via api.updateMe(); password change via
// api.changePassword. Deliberately scoped to safe, durable settings — no
// templates / data-retention / consent / team / billing / language selection.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, clearSession, ApiError } from '@/lib/api';
import type { MeResponse, UpdateMePayload } from '@/lib/api';
import SpecialtyTypeahead from '@/components/SpecialtyTypeahead';
import PasswordInput from '@/components/PasswordInput';

const APP_VERSION = '0.1.0';
// Placeholder support address — confirm the real one before pilot. Claim-free:
// no data-retention / residency / processor wording here (pre-attorney).
const SUPPORT_EMAIL = 'support@tubermed.com';

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

  const [me, setMe] = useState<MeResponse | null>(null);
  const [form, setForm] = useState<ProfileForm>(EMPTY_FORM);
  const [loadError, setLoadError] = useState(false);

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
        if (alive) {
          setMe(m);
          setForm(formFromMe(m));
        }
      })
      .catch(() => {
        if (alive) setLoadError(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  function setField(key: keyof ProfileForm, value: string) {
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

  return (
    <div className="w-full max-w-3xl mx-auto px-6 py-8 flex flex-col gap-6">
      <header>
        <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text-primary)' }}>
          Настройки
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>
          Вашите данни и предпочитания.
        </p>
      </header>

      {loadError && (
        <div
          role="alert"
          className="text-sm px-4 py-3 rounded-md"
          style={{ background: 'var(--color-danger-soft)', color: 'var(--color-danger)' }}
        >
          Профилът не можа да се зареди. Опитайте да презаредите страницата.
        </div>
      )}

      {/* ── Профил ── */}
      <Card title="Профил">
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
      </Card>

      {/* ── Практика и документ ── */}
      <Card title="Практика и документ">
        <p className="text-xs mb-4" style={{ color: 'var(--color-text-hint)' }}>
          Тези данни се отпечатват в горната част на Амбулаторния лист.
        </p>
        <div className="flex flex-col gap-4">
          <Field label="Адрес">
            <TextInput
              value={form.practice_address}
              onChange={(e) => setField('practice_address', e.target.value)}
              placeholder="напр. гр. Пловдив, ул. Цар Борис III 12"
              maxLength={200}
            />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Рег. № на лечебното заведение (РЗИ)">
              <TextInput
                value={form.rzi_number}
                onChange={(e) => setField('rzi_number', e.target.value)}
                maxLength={200}
              />
            </Field>
            <Field label="Договор с НЗОК №">
              <TextInput
                value={form.nzok_contract}
                onChange={(e) => setField('nzok_contract', e.target.value)}
                maxLength={200}
              />
            </Field>
            <Field label="Телефон">
              <TextInput
                value={form.practice_phone}
                onChange={(e) => setField('practice_phone', e.target.value)}
                placeholder="напр. 032 123 456"
                autoComplete="tel"
                maxLength={200}
              />
            </Field>
            <Field label="УИН">
              <TextInput
                value={form.uin}
                onChange={(e) => setField('uin', e.target.value)}
                placeholder="Уникален идентификационен номер"
                maxLength={32}
              />
            </Field>
          </div>
        </div>
      </Card>

      {/* Save bar — covers Профил + Практика (both go through api.updateMe). */}
      <div className="flex items-center justify-end gap-3">
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
        <button
          type="button"
          onClick={saveProfile}
          disabled={saving}
          className="px-4 h-10 text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed"
          style={{ background: 'var(--color-accent)', color: 'white', borderRadius: 'var(--radius-sm)' }}
        >
          {saving ? 'Запазване…' : 'Запази промените'}
        </button>
      </div>

      {/* ── Сигурност ── */}
      <Card title="Сигурност">
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
                <button
                  type="button"
                  onClick={changePassword}
                  disabled={pwSaving}
                  className="px-4 h-10 text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed"
                  style={{ background: 'var(--color-accent)', color: 'white', borderRadius: 'var(--radius-sm)' }}
                >
                  {pwSaving ? 'Запазване…' : 'Смени паролата'}
                </button>
              </div>
            </div>
          </div>

          <div className="pt-5" style={{ borderTop: '1px solid var(--color-border)' }}>
            <button
              type="button"
              onClick={logout}
              className="px-4 h-10 text-sm font-medium"
              style={{
                background: 'transparent',
                color: 'var(--color-danger)',
                border: '1px solid var(--color-border-strong)',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              Изход
            </button>
          </div>
        </div>
      </Card>

      {/* ── За приложението — claim-free, neutral facts only ── */}
      <Card title="За приложението">
        <div className="text-sm flex flex-col gap-1" style={{ color: 'var(--color-text-muted)' }}>
          <div>
            <span className="font-medium" style={{ color: 'var(--color-text-primary)' }}>
              TuberMed
            </span>{' '}
            · версия {APP_VERSION}
          </div>
          <div>Поддръжка: {SUPPORT_EMAIL}</div>
        </div>
      </Card>
    </div>
  );
}

// ── Local presentational helpers (mirror the workspace SectionCard look) ──

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      className="rounded-xl"
      style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}
    >
      <div className="px-6 pt-5 pb-2">
        <h2
          className="text-[10px] uppercase tracking-[0.22em] font-semibold"
          style={{ color: 'var(--color-text-hint)' }}
        >
          {title}
        </h2>
      </div>
      <div className="px-6 pb-5">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="block text-xs mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
        {label}
      </span>
      {children}
    </div>
  );
}

function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { className, style, onFocus, onBlur, type, ...rest } = props;
  return (
    <input
      {...rest}
      type={type ?? 'text'}
      className={['w-full px-3 outline-none', className ?? ''].filter(Boolean).join(' ')}
      style={{
        height: 40,
        background: 'white',
        border: '1px solid var(--color-border-strong)',
        borderRadius: 'var(--radius-sm)',
        fontSize: 14,
        color: 'var(--color-text-primary)',
        ...(style || {}),
      }}
      onFocus={(e) => {
        e.currentTarget.style.borderColor = 'var(--color-accent)';
        e.currentTarget.style.boxShadow = '0 0 0 2px var(--color-accent-soft)';
        onFocus?.(e);
      }}
      onBlur={(e) => {
        e.currentTarget.style.borderColor = 'var(--color-border-strong)';
        e.currentTarget.style.boxShadow = 'none';
        onBlur?.(e);
      }}
    />
  );
}
