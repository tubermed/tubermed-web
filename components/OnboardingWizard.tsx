'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import SpecialtyTypeahead from '@/components/SpecialtyTypeahead';
import { api, type ConsultationsBand, type MeResponse, type UpdateMePayload } from '@/lib/api';

// ── A4 first-run wizard ──────────────────────────────────────────────────────
// Shown ONCE EVER, server-tracked: the new-visit page opens it only when
// GET /me returns onboarding_completed_at === null (explicitly — an ABSENT key
// means backend migration 015 isn't applied and nothing is shown). EVERY path
// out of the wizard (Пропусни on step 1, Esc, Не сега, Започни) fires
// PATCH { onboarding_completed: true } exactly once — first-write-wins
// server-side — so a doctor is never nagged twice, even after skipping all of
// it. The PATCH is best-effort: if it fails (offline), the wizard may appear
// once more next session; it never blocks the doctor.
//
// Step 2's quiet "Пропусни" is different: it skips the PROFILE SAVE and moves
// to the tour offer — it does not end the wizard.
//
// Styling mirrors PatientLoadConfirmModal (fixed inset overlay, --color-bg-card
// card, --color-brand primary action).

const BANDS: { value: ConsultationsBand; label: string }[] = [
  { value: 'under_100', label: 'До 100' },
  { value: '100_200', label: '100–200' },
  { value: 'over_200', label: 'Над 200' },
];

interface OnboardingWizardProps {
  me: MeResponse;
  /** Close without a tour (doctor done with the wizard). */
  onClose: () => void;
  /** Close AND start the spotlight tour (purely visual — the completion PATCH
   *  has already been fired by the wizard before this is invoked). */
  onStartTour: () => void;
  /** ── MEDIA SLOT ──────────────────────────────────────────────────────────
   *  Drop-in for the real welcome photo/video Dimitar plans to supply: pass
   *  any node (e.g. <video … /> or <Image …/> from /public) and it REPLACES
   *  the default gradient-waveform header band on step 1, same 152px frame.
   *  Until then leave unset. */
  welcomeMedia?: React.ReactNode;
}

export default function OnboardingWizard({ me, onClose, onStartTour, welcomeMedia }: OnboardingWizardProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [specialty, setSpecialty] = useState('');
  const [orgName, setOrgName] = useState(me.organizationName ?? '');
  const [band, setBand] = useState<ConsultationsBand | null>(null);
  const [saving, setSaving] = useState(false);
  // Step-2 profile-PATCH failure — surfaced inline (was silently swallowed:
  // the deployed pre-016 backend dropped consultations_band as an unknown
  // field without erroring, but a real 4xx/5xx/network failure also vanished
  // and the wizard advanced as if saved). Stay on step 2 so Продължи retries;
  // Пропусни still skips the save entirely.
  const [saveError, setSaveError] = useState<string | null>(null);

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
      // defaultPrevented = some inner control already consumed this Esc (the
      // SpecialtyTypeahead closing its dropdown). stopPropagation can NOT
      // shield us: Next's App Router hydrates the whole document, so React's
      // delegated listeners sit ON document — the same node as this listener,
      // and stopPropagation only blocks FURTHER nodes, never same-node
      // listeners. preventDefault is the ordering-independent handshake.
      if (e.key === 'Escape' && !e.defaultPrevented) finish(false);
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
    if (band) payload.consultations_band = band;
    if (Object.keys(payload).length > 0) {
      setSaving(true);
      setSaveError(null);
      try {
        await api.updateMe(payload);
      } catch {
        setSaveError('Запазването не успя. Опитайте отново или пропуснете тази стъпка.');
        setSaving(false);
        return; // stay on step 2 — retry possible, Пропусни still works
      }
      setSaving(false);
    }
    setStep(3);
  }

  return (
    // ⚠ NO backdrop click-to-close — deliberate (bug fix, 2026-06-11). The
    // browser fires `click` on the nearest COMMON ANCESTOR of the mousedown
    // and mouseup targets, so selecting text in a wizard input with a drag
    // that releases outside the card landed a click on this backdrop — which
    // closed the wizard AND (by design of finish()) permanently marked
    // onboarding complete. Verified live. The wizard closes ONLY via its
    // explicit controls: Пропусни / Не сега / Esc / Започни.
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(27, 42, 65, 0.55)' }}
    >
      <div
        className="rounded-2xl shadow-2xl max-w-md w-full overflow-hidden"
        style={{ background: 'var(--color-bg-card)' }}
      >
        {step === 1 && (
          <>
            {welcomeMedia ?? <WelcomeBand />}
            <div className="px-7 pt-6 pb-7">
              <h2
                className="font-semibold"
                style={{ color: 'var(--color-ink)', fontSize: 22, letterSpacing: '-0.01em' }}
              >
                Добре дошли в TuberMed
              </h2>
              <p
                className="mt-2 leading-relaxed"
                style={{ color: 'var(--color-text-muted)', fontSize: 14 }}
              >
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
            <div className="px-7 pt-6 pb-7">
              <h2 className="text-lg font-semibold" style={{ color: 'var(--color-ink)' }}>
                Няколко думи за вас
              </h2>
              <p className="text-sm mt-1 mb-5" style={{ color: 'var(--color-text-muted)' }}>
                Всичко е по избор — помага ни да настроим TuberMed за вашата практика.
              </p>
              <div className="space-y-4">
                <WizardField label="Специалност">
                  <SpecialtyTypeahead value={specialty} onChange={setSpecialty} disabled={saving} />
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
                <WizardField label="Среден брой прегледи на месец">
                  <div role="group" aria-label="Среден брой прегледи на месец" className="grid grid-cols-3 gap-2">
                    {BANDS.map((b) => {
                      const selected = band === b.value;
                      return (
                        <button
                          key={b.value}
                          type="button"
                          aria-pressed={selected}
                          disabled={saving}
                          // tap again to deselect — the field stays optional
                          onClick={() => setBand(selected ? null : b.value)}
                          className="rounded-lg text-sm font-medium transition disabled:opacity-50"
                          style={{
                            height: 42,
                            border: `1px solid ${selected ? 'var(--color-brand)' : 'var(--color-border-strong)'}`,
                            background: selected ? 'var(--color-brand)' : 'white',
                            color: selected ? 'white' : 'var(--color-text)',
                          }}
                        >
                          {b.label}
                        </button>
                      );
                    })}
                  </div>
                </WizardField>
              </div>
              {saveError && (
                <p
                  role="alert"
                  className="mt-4"
                  style={{ color: 'var(--color-danger)', fontSize: 13 }}
                >
                  {saveError}
                </p>
              )}
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
            <div className="px-7 pt-6 pb-7">
              <h2 className="text-lg font-semibold" style={{ color: 'var(--color-ink)' }}>
                Кратка обиколка? (30 секунди)
              </h2>
              <p className="text-sm mt-2 leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
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

// Default step-1 visual: deep navy gradient + the white TuberMed mark + a
// quiet CSS/SVG waveform motif echoing the recording UI. Pure local assets —
// no third-party origins (EU invariant). Replaced wholesale by the
// `welcomeMedia` prop when a real photo/video lands.
function WelcomeBand() {
  // Static bar heights — an abstract "voice" waveform, calm by design.
  const bars = [10, 18, 26, 38, 30, 46, 34, 52, 40, 28, 44, 32, 22, 36, 26, 16, 24, 14, 20, 12];
  return (
    <div
      className="relative"
      style={{
        height: 152,
        background: 'linear-gradient(135deg, #16263D 0%, #1D3B5C 55%, #2E5A8F 100%)',
      }}
    >
      <Image
        src="/brand/tubermed-mark-white.svg"
        alt=""
        width={42}
        height={42}
        priority
        style={{ position: 'absolute', top: 24, left: 28 }}
      />
      <svg
        aria-hidden="true"
        viewBox="0 0 400 60"
        preserveAspectRatio="none"
        style={{ position: 'absolute', insetInline: 0, bottom: 0, width: '100%', height: 60 }}
      >
        {bars.map((h, i) => (
          <rect
            key={i}
            x={i * 20 + 6}
            y={60 - h}
            width={8}
            rx={4}
            height={h}
            fill="rgba(143, 192, 232, 0.28)"
          />
        ))}
      </svg>
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
        className="block mb-1.5 font-medium"
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
      className="px-7 py-4 flex items-center justify-between border-t"
      style={{ borderColor: 'var(--color-border)' }}
    >
      <div className="flex items-center gap-1.5" aria-hidden="true">
        {[1, 2, 3].map((i) => (
          <span
            key={i}
            className="rounded-full"
            style={{
              width: i === dots ? 18 : 6,
              height: 6,
              background: i === dots ? 'var(--color-brand)' : 'var(--color-border)',
              transition: 'width 200ms ease, background 200ms ease',
            }}
          />
        ))}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onSecondary}
          className="text-sm px-3 py-2 rounded-md transition hover:bg-[var(--color-bg)]"
          style={{ color: 'var(--color-text-muted)' }}
        >
          {secondary}
        </button>
        <button
          type="button"
          onClick={onPrimary}
          disabled={primaryDisabled}
          className="text-sm px-5 py-2 rounded-md font-medium text-white disabled:opacity-50 transition hover:opacity-95"
          style={{ background: 'var(--color-brand)' }}
        >
          {primary}
        </button>
      </div>
    </div>
  );
}
