'use client';

import { useState } from 'react';
import Link from 'next/link';

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL ?? '';

const SPECIALTIES = [
  'Общопрактикуващ лекар (ОПЛ)',
  'Кардиология',
  'Ендокринология',
  'Гастроентерология',
  'Неврология',
  'Пневмология',
  'Вътрешни болести',
  'Гинекология',
  'Урология',
  'Дерматология',
  'Ортопедия',
  'Психиатрия',
  'Педиатрия',
  'Друго',
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Status = 'idle' | 'submitting' | 'success' | 'error';
type FieldKey = 'name' | 'email' | 'specialty' | 'specialtyOther' | 'consent';

export function AccessForm() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [specialtyOther, setSpecialtyOther] = useState('');
  const [message, setMessage] = useState('');
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState(''); // honeypot

  const [touched, setTouched] = useState<Record<FieldKey, boolean>>({
    name: false,
    email: false,
    specialty: false,
    specialtyOther: false,
    consent: false,
  });
  const [status, setStatus] = useState<Status>('idle');

  const errors: Partial<Record<FieldKey, string>> = {};
  if (!name.trim()) errors.name = 'Моля, въведете име.';
  if (!email.trim()) errors.email = 'Моля, въведете имейл.';
  else if (!EMAIL_RE.test(email.trim())) errors.email = 'Моля, въведете валиден имейл.';
  if (!specialty) errors.specialty = 'Моля, изберете специалност.';
  if (specialty === 'Друго' && !specialtyOther.trim()) errors.specialtyOther = 'Моля, въведете специалност.';
  if (!consent) errors.consent = 'Необходимо е съгласие, за да продължите.';

  const isValid = Object.keys(errors).length === 0;
  const show = (k: FieldKey) => (touched[k] || status === 'error') && errors[k];

  const markTouched = (k: FieldKey) => setTouched((t) => ({ ...t, [k]: true }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTouched({ name: true, email: true, specialty: true, specialtyOther: true, consent: true });
    if (!isValid || status === 'submitting') return;

    setStatus('submitting');
    try {
      const res = await fetch(`${BACKEND}/api/pilot-leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          specialty: specialty === 'Друго' ? specialtyOther.trim() : specialty,
          message: message.trim() || undefined,
          consent: true,
          website, // honeypot — empty for humans
        }),
      });
      if (!res.ok) throw new Error('request failed');
      setStatus('success');
    } catch {
      setStatus('error'); // keep field values
    }
  }

  if (status === 'success') {
    return (
      <div
        role="status"
        className="rounded-2xl bg-white p-8 text-center"
        style={{ border: '1px solid var(--lp-border)' }}
      >
        <span
          className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full"
          style={{ background: '#E3F0EA', color: '#2E7D5B' }}
          aria-hidden="true"
        >
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </span>
        <p className="text-lg font-semibold" style={{ color: 'var(--lp-heading)' }}>
          Благодаря! Получихме заявката ви и ще се свържем скоро.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="rounded-2xl bg-white p-6 text-left sm:p-8"
      style={{ border: '1px solid var(--lp-border)' }}
    >
      {/* honeypot — visually hidden, off the tab order */}
      <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, overflow: 'hidden' }}>
        <label htmlFor="lp-website">Не попълвайте това поле</label>
        <input
          id="lp-website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
        />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="lp-name" className="lp-label">
            Име <span style={{ color: '#C0392B' }}>*</span>
          </label>
          <input
            id="lp-name"
            className="lp-input"
            type="text"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => markTouched('name')}
            aria-invalid={show('name') ? true : undefined}
            aria-describedby={show('name') ? 'lp-name-err' : undefined}
            required
          />
          {show('name') ? <span id="lp-name-err" className="lp-form-error">{errors.name}</span> : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="lp-email" className="lp-label">
            Имейл <span style={{ color: '#C0392B' }}>*</span>
          </label>
          <input
            id="lp-email"
            className="lp-input"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={() => markTouched('email')}
            aria-invalid={show('email') ? true : undefined}
            aria-describedby={show('email') ? 'lp-email-err' : undefined}
            required
          />
          {show('email') ? <span id="lp-email-err" className="lp-form-error">{errors.email}</span> : null}
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-1.5">
        <label htmlFor="lp-specialty" className="lp-label">
          Специалност <span style={{ color: '#C0392B' }}>*</span>
        </label>
        <select
          id="lp-specialty"
          className="lp-input"
          value={specialty}
          onChange={(e) => setSpecialty(e.target.value)}
          onBlur={() => markTouched('specialty')}
          aria-invalid={show('specialty') ? true : undefined}
          aria-describedby={show('specialty') ? 'lp-specialty-err' : undefined}
          required
        >
          <option value="" disabled>
            Изберете…
          </option>
          {SPECIALTIES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        {show('specialty') ? <span id="lp-specialty-err" className="lp-form-error">{errors.specialty}</span> : null}

        {specialty === 'Друго' ? (
          <div className="mt-2 flex flex-col gap-1.5">
            <label htmlFor="lp-specialty-other" className="lp-label">
              Въведете специалност <span style={{ color: '#C0392B' }}>*</span>
            </label>
            <input
              id="lp-specialty-other"
              className="lp-input"
              type="text"
              value={specialtyOther}
              onChange={(e) => setSpecialtyOther(e.target.value)}
              onBlur={() => markTouched('specialtyOther')}
              aria-invalid={show('specialtyOther') ? true : undefined}
              aria-describedby={show('specialtyOther') ? 'lp-specialty-other-err' : undefined}
              required
            />
            {show('specialtyOther') ? (
              <span id="lp-specialty-other-err" className="lp-form-error">{errors.specialtyOther}</span>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="mt-5 flex flex-col gap-1.5">
        <label htmlFor="lp-message" className="lp-label">
          Вашият въпрос <span style={{ color: 'var(--lp-text-muted)' }}>(по избор)</span>
        </label>
        <textarea
          id="lp-message"
          className="lp-input"
          rows={4}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
      </div>

      <div className="mt-5 flex items-start gap-3">
        <input
          id="lp-consent"
          type="checkbox"
          className="mt-1 h-5 w-5 shrink-0 accent-[var(--lp-navy)]"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          onBlur={() => markTouched('consent')}
          aria-invalid={show('consent') ? true : undefined}
          aria-describedby={show('consent') ? 'lp-consent-err' : undefined}
          required
        />
        <label htmlFor="lp-consent" className="text-sm leading-relaxed" style={{ color: 'var(--lp-text)' }}>
          Съгласен/на съм TuberMed да съхранява данните ми, за да се свърже с мен относно
          пилота.{' '}
          <Link href="/privacy" className="font-semibold underline" style={{ color: 'var(--lp-navy)' }}>
            Политика за поверителност
          </Link>
        </label>
      </div>
      {show('consent') ? <span className="lp-form-error mt-1 block">{errors.consent}</span> : null}

      {status === 'error' ? (
        <p role="alert" className="mt-5 rounded-[var(--lp-radius-sm)] px-4 py-3 text-sm" style={{ background: '#F6E4E1', color: '#9B2C20' }}>
          Нещо се обърка. Опитайте отново или ни пишете на{' '}
          <a href="mailto:contact@tubermed.com" className="font-semibold underline">
            contact@tubermed.com
          </a>
          .
        </p>
      ) : null}

      <button
        type="submit"
        disabled={!isValid || status === 'submitting'}
        className="lp-cta-primary mt-6 w-full rounded-[var(--lp-radius)] px-7 py-3.5 text-base font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-55"
      >
        {status === 'submitting' ? 'Изпращане…' : 'Изпрати заявка'}
      </button>
    </form>
  );
}
