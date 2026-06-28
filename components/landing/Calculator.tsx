'use client';

import { useEffect, useRef, useState } from 'react';
import { useInView, useReducedMotion, useSpring, useMotionValueEvent } from 'framer-motion';
import { Container, SectionHeading } from './ui';
import { Reveal } from './Reveal';
import { MagneticCta } from './MagneticCta';

// Honest projection (NOT a claim): time saved = the doctor's OWN inputs minus a
// stated ~1 min review assumption. Numbers count up on scroll-into-view and on
// input change; reduced-motion shows them instantly.

const REVIEW_MIN = 1; // assumption: review/approve ≈ 1 min per finished note

function useCountUp(target: number, active: boolean, reduce: boolean) {
  const mv = useSpring(0, { stiffness: 90, damping: 24, mass: 0.6 });
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (reduce || !active) return;
    mv.set(target); // springs toward target (count-up); re-runs on input change
  }, [target, active, reduce, mv]);
  useMotionValueEvent(mv, 'change', (v) => setVal(v));
  return reduce ? target : val;
}

// Whole-number hours with an honest ≈ prefix; "<1 ч" instead of "0 ч".
const formatHours = (n: number) => {
  const r = Math.round(n);
  return r < 1 ? '<1 ч' : `≈${r} ч`;
};

export function Calculator() {
  const reduce = !!useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const active = useInView(ref, { once: true, margin: '0px 0px -15% 0px' });

  const [visits, setVisits] = useState(20);
  const [minutes, setMinutes] = useState(8);
  const [days, setDays] = useState(5);

  const savedPerNote = Math.max(0, minutes - REVIEW_MIN);
  const weekly = (visits * days * savedPerNote) / 60; // hours / week
  const monthly = weekly * 4.3; // hours / month

  const weeklyShown = useCountUp(weekly, active, reduce);
  const monthlyShown = useCountUp(monthly, active, reduce);

  return (
    <section style={{ background: 'var(--lp-bg)' }}>
      <Container className="py-20 md:py-28">
        <Reveal>
          <SectionHeading
            title="Колко време ще си върнете?"
            intro="Нагласете стойностите спрямо Вашата практика и вижте приблизителна оценка."
          />
        </Reveal>

        <Reveal delay={100}>
          <div
            ref={ref}
            className="mt-12 grid gap-8 rounded-2xl p-6 md:grid-cols-2 md:p-10"
            style={{ background: 'var(--lp-bg-soft)', border: '1px solid var(--lp-border)' }}
          >
            {/* sliders */}
            <div className="flex flex-col gap-7">
              <Slider
                id="calc-visits" label="Прегледи на ден" value={visits} min={5} max={60} step={1}
                onChange={setVisits} suffix=""
              />
              <Slider
                id="calc-minutes" label="Минути за амбулаторен лист" value={minutes} min={2} max={20} step={1}
                onChange={setMinutes} suffix=" мин"
              />
              <Slider
                id="calc-days" label="Работни дни в седмицата" value={days} min={3} max={7} step={1}
                onChange={setDays} suffix=""
              />
            </div>

            {/* outputs */}
            <div className="flex flex-col justify-center gap-5 rounded-xl bg-white p-6" style={{ border: '1px solid var(--lp-border)' }}>
              <Output label="Спестено време на седмица" value={formatHours(weeklyShown)} />
              <div style={{ height: 1, background: 'var(--lp-border)' }} />
              <Output label="Спестено време на месец" value={formatHours(monthlyShown)} big />
              <p className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--lp-text-muted)' }}>
                Приблизителна оценка спрямо въведеното (преглед ≈ {REVIEW_MIN} мин/лист).
                Не е гаранция.
              </p>
              <div className="mt-1">
                <MagneticCta href="#access">Заявка за достъп</MagneticCta>
              </div>
            </div>
          </div>
        </Reveal>
      </Container>
    </section>
  );
}

function Slider({
  id, label, value, min, max, step, onChange, suffix,
}: {
  id: string; label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; suffix: string;
}) {
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <label htmlFor={id} className="text-sm font-semibold" style={{ color: 'var(--lp-text)' }}>
          {label}
        </label>
        <span className="font-[family-name:var(--font-inter-tight)] text-lg font-bold tabular-nums" style={{ color: 'var(--lp-navy)' }}>
          {value}{suffix}
        </span>
      </div>
      <input
        id={id}
        type="range"
        className="lp-range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

function Output({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--lp-text-muted)' }}>
        {label}
      </div>
      <div
        className={`font-[family-name:var(--font-inter-tight)] font-bold tabular-nums ${big ? 'text-5xl' : 'text-3xl'}`}
        style={{ color: big ? 'var(--lp-accent)' : 'var(--lp-heading)' }}
      >
        {value}
      </div>
    </div>
  );
}
