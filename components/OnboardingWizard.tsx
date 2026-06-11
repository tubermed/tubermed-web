'use client';

import { useEffect, useState } from 'react';
import { api, type MeResponse, type UpdateMePayload } from '@/lib/api';

// ── A4 first-run wizard ──────────────────────────────────────────────────────
// Shown ONCE EVER, server-tracked: the new-visit page opens it only when
// GET /me returns onboarding_completed_at === null (explicitly — an ABSENT key
// means backend migration 015 isn't applied and nothing is shown). EVERY path
// out of the wizard (Пропусни on any step, Esc, backdrop, Не сега, Започни)
// fires PATCH { onboarding_completed: true } exactly once — first-write-wins
// server-side — so a doctor is never nagged twice, even after skipping all of
// it. The PATCH is best-effort: if it fails (offline), the wizard may appear
// once more next session; it never blocks the doctor.
//
// Step 2's quiet "Пропусни" is different: it skips the PROFILE SAVE and moves
// to the tour offer — it does not end the wizard.
//
// Styling mirrors PatientLoadConfirmModal (fixed inset overlay, --color-bg-card
// card, --color-brand primary action).

const SPECIALTIES = [
  'Общопрактикуващ лекар',
  'Кардиолог',
  'Педиатър',
  'Невролог',
  'Ендокринолог',
  'Пулмолог',
  'Гастроентеролог',
  'Акушер-гинеколог',
  'Уролог',
  'Дерматолог',
];

interface OnboardingWizardProps {
  me: MeResponse;
  /** Close without a tour (doctor done with the wizard). */
  onClose: () => void;
  /** Close AND start the spotlight tour (purely visual — the completion PATCH
   *  has already been fired by the wizard before this is invoked). */
  onStartTour: () => void;
}

export default function OnboardingWizard({ me, onClose, onStartTour }: OnboardingWizardProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [specialty, setSpecialty] = useState('');
  const [orgName, setOrgName] = useState(me.organizationName ?? '');
  const [avg, setAvg] = useState('');
  const [saving, setSaving] = useState(false);

  // The single exit point — marks onboarding complete (once; the wizard
  // unmounts immediately after) and routes to the tour or plain close.
  function finish(startTour: boolean) {
    api.updateMe({ onboarding_completed: true }).catch(() => {
      /* best-effort — see header comment */
    });
    if (startTour) onStartTour();
    else onClose();
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') finish(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- finish is stable in behavior; re-binding per render is unnecessary
  }, []);

  async function submitProfile() {
    const payload: UpdateMePayload = {};
    if (specialty.trim()) payload.specialty = specialty.trim();
    const trimmedOrg = orgName.trim();
    if (trimmedOrg && trimmedOrg !== (me.organizationName ?? '')) {
      payload.org_name = trimmedOrg;
    }
    const n = Number(avg);
    if (avg.trim() && Number.isInteger(n) && n >= 1 && n <= 5000) {
      payload.avg_monthly_consultations = n;
    }
    if (Object.keys(payload).length > 0) {
      setSaving(true);
      try {
        await api.updateMe(payload);
      } catch {
        /* non-blocking — profile details are optional */
      } finally {
        setSaving(false);
      }
    }
    setStep(3);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(27, 42, 65, 0.55)' }}
      onClick={() => finish(false)}
    >
      <div
        className="rounded-2xl shadow-2xl max-w-md w-full"
        style={{ background: 'var(--color-bg-card)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {step === 1 && (
          <>
            <div className="p-6">
              <h2 className="text-xl font-semibold" style={{ color: 'var(--color-ink)' }}>
                Добре дошли в TuberMed
              </h2>
              <p className="text-sm mt-2" style={{ color: 'var(--color-text-muted)' }}>
                Говорете с пациента — амбулаторният лист се пише сам.
              </p>
            </div>
            <Footer
              primary="Напред"
              onPrimary={() => setStep(2)}
              secondary="Пропусни"
              onSecondary={() => finish(false)}
              dots={step}
            />
          </>
        )}

        {step === 2 && (
          <>
            <div className="p-6">
              <h2 className="text-lg font-semibold" style={{ color: 'var(--color-ink)' }}>
                Няколко думи за вас
              </h2>
              <p className="text-sm mt-1 mb-4" style={{ color: 'var(--color-text-muted)' }}>
                Всичко е по избор — помага ни да настроим TuberMed за вашата практика.
              </p>
              <div className="space-y-3">
                <WizardField label="Специалност">
                  <input
                    type="text"
                    list="onboarding-specialties"
                    value={specialty}
                    onChange={(e) => setSpecialty(e.target.value)}
                    disabled={saving}
                    className="w-full px-3 outline-none rounded-md"
                    style={fieldStyle}
                  />
                  <datalist id="onboarding-specialties">
                    {SPECIALTIES.map((s) => (
                      <option key={s} value={s} />
                    ))}
                  </datalist>
                </WizardField>
                <WizardField label="Място на работа">
                  <input
                    type="text"
                    value={orgName}
                    onChange={(e) => setOrgName(e.target.value)}
                    disabled={saving}
                    maxLength={200}
                    className="w-full px-3 outline-none rounded-md"
                    style={fieldStyle}
                  />
                </WizardField>
                <WizardField label="Среден брой консултации на месец">
                  <input
                    type="number"
                    min={1}
                    max={5000}
                    value={avg}
                    onChange={(e) => setAvg(e.target.value)}
                    disabled={saving}
                    className="w-full px-3 outline-none rounded-md"
                    style={fieldStyle}
                  />
                </WizardField>
              </div>
            </div>
            <Footer
              primary={saving ? 'Запазване…' : 'Продължи'}
              onPrimary={submitProfile}
              primaryDisabled={saving}
              secondary="Пропусни"
              onSecondary={() => setStep(3)}
              dots={step}
            />
          </>
        )}

        {step === 3 && (
          <>
            <div className="p-6">
              <h2 className="text-lg font-semibold" style={{ color: 'var(--color-ink)' }}>
                Кратка обиколка? (30 секунди)
              </h2>
              <p className="text-sm mt-2" style={{ color: 'var(--color-text-muted)' }}>
                Четири бързи стъпки върху екрана за нов преглед.
              </p>
            </div>
            <Footer
              primary="Започни"
              onPrimary={() => finish(true)}
              secondary="Не сега"
              onSecondary={() => finish(false)}
              dots={step}
            />
          </>
        )}
      </div>
    </div>
  );
}

const fieldStyle: React.CSSProperties = {
  height: 38,
  background: 'white',
  border: '1px solid var(--color-border-strong)',
  fontSize: 14,
  color: 'var(--color-text-primary)',
};

function WizardField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span
        className="block mb-1 font-medium"
        style={{ color: 'var(--color-text-secondary)', fontSize: 13 }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

function Footer({
  primary,
  onPrimary,
  primaryDisabled,
  secondary,
  onSecondary,
  dots,
}: {
  primary: string;
  onPrimary: () => void;
  primaryDisabled?: boolean;
  secondary: string;
  onSecondary: () => void;
  dots: 1 | 2 | 3;
}) {
  return (
    <div
      className="px-6 py-4 flex items-center justify-between border-t"
      style={{ borderColor: 'var(--color-border)' }}
    >
      <div className="flex items-center gap-1.5" aria-hidden="true">
        {[1, 2, 3].map((i) => (
          <span
            key={i}
            className="rounded-full"
            style={{
              width: 6,
              height: 6,
              background: i === dots ? 'var(--color-brand)' : 'var(--color-border)',
            }}
          />
        ))}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onSecondary}
          className="text-sm px-3 py-2 rounded-md"
          style={{ color: 'var(--color-text-muted)' }}
        >
          {secondary}
        </button>
        <button
          type="button"
          onClick={onPrimary}
          disabled={primaryDisabled}
          className="text-sm px-4 py-2 rounded-md font-medium text-white disabled:opacity-50"
          style={{ background: 'var(--color-brand)' }}
        >
          {primary}
        </button>
      </div>
    </div>
  );
}
