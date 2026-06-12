'use client';

import React, { useEffect, useState, useRef, useCallback } from 'react';
import type { ReactNode } from 'react';
import { useReducedMotion } from 'framer-motion';
import { golosText } from '@/lib/landing-fonts';

/**
 * TuberMed — hero walkthrough (Dimitar's prototype, vendored + reskinned).
 * Moving "camera" (zoom/pan) over a faux-real app: new-visit → mode → record
 * → processing → Амбулаторен лист → warfarin × NSAID CRITICAL alert. Pure
 * DOM + CSS; loops continuously.
 *
 * Reskinned from the original steel-blue (#1f63d6) to the landing Navy tokens
 * (#274C77 / #1D3B5C / #4F8FBF / #8FC0E8). Fonts are self-hosted via next/font
 * (Golos Text for in-mock body, JetBrains Mono for МКБ codes) — NO runtime
 * Google Fonts request.
 *
 * Guardrails: on mobile OR prefers-reduced-motion it renders a static, readable
 * end-frame (finished note + alert) instead of the scaled 920×600 walkthrough;
 * the loop pauses when off-screen or the tab is hidden.
 */

const APP_W = 920;
const APP_H = 600;
const CX = APP_W / 2;
const CY = APP_H / 2;

const cam = (s: number, fx = CX, fy = CY) =>
  `translate(${CX - s * fx}px, ${CY - s * fy}px) scale(${s})`;

type Phase = {
  id: string;
  dur: number;
  screen: string;
  zoom: number;
  focus: string;
  cursor: string | null;
  dy?: number;
  click?: boolean;
};

const PHASES: Phase[] = [
  { id: 'newvisit',       dur: 2000, screen: 'newvisit', zoom: 1.0,  focus: 'center',  cursor: 'rest' },
  { id: 'newvisit_cta',   dur: 1300, screen: 'newvisit', zoom: 1.28, focus: 'cta', dy: -70, cursor: 'cta', click: true },
  { id: 'mode',           dur: 1900, screen: 'mode',     zoom: 1.30, focus: 'pc',      cursor: 'pc',      click: true },
  { id: 'record_press',   dur: 1500, screen: 'rec',      zoom: 1.20, focus: 'rec',     cursor: 'rec',     click: true },
  { id: 'recording',      dur: 2700, screen: 'rec',      zoom: 1.16, focus: 'rec',     cursor: null },
  { id: 'processing',     dur: 1500, screen: 'proc',     zoom: 1.1,  focus: 'center',  cursor: null },
  { id: 'result_reveal',  dur: 2600, screen: 'result',   zoom: 1.06, focus: 'diag',    cursor: null },
  { id: 'result_alert',   dur: 2000, screen: 'result',   zoom: 1.26, focus: 'alert',   cursor: null },
  { id: 'result_confirm', dur: 1900, screen: 'result',   zoom: 1.12, focus: 'confirm', dy: -90, cursor: 'confirm', click: true },
];

type Pt = { fx: number; fy: number };

export default function TuberMedHeroDesktop() {
  const reduce = !!useReducedMotion();
  const [isMobile, setIsMobile] = useState(false);
  const stat = isMobile || reduce; // static end-frame instead of the walkthrough

  const [idx, setIdx] = useState(0);
  const [cycle, setCycle] = useState(0);
  const [fit, setFit] = useState(1);
  const [active, setActive] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const wrapRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<HTMLDivElement>(null);
  const ctaRef = useRef<HTMLButtonElement>(null);
  const pcRef = useRef<HTMLDivElement>(null);
  const recRef = useRef<HTMLButtonElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  const diagRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const [targets, setTargets] = useState<Record<string, Pt>>({
    cta: { fx: 565, fy: 548 }, pc: { fx: 600, fy: 360 },
    rec: { fx: 510, fy: 300 }, alert: { fx: 520, fy: 460 },
    diag: { fx: 470, fy: 150 }, confirm: { fx: 470, fy: 640 },
  });

  const appCoords = useCallback((el: Element | null): Pt | null => {
    const app = appRef.current;
    if (!el || !app) return null;
    const er = el.getBoundingClientRect();
    const ar = app.getBoundingClientRect();
    if (!ar.width) return null;
    const scale = ar.width / APP_W;
    return {
      fx: (er.left + er.width / 2 - ar.left) / scale,
      fy: (er.top + er.height / 2 - ar.top) / scale,
    };
  }, []);

  const measure = useCallback(() => {
    setTargets((prev) => {
      const next = { ...prev };
      const c = appCoords(ctaRef.current); if (c) next.cta = c;
      const p = appCoords(pcRef.current); if (p) next.pc = p;
      const r = appCoords(recRef.current); if (r) next.rec = r;
      const a = appCoords(alertRef.current); if (a) next.alert = a;
      const d = appCoords(diagRef.current); if (d) next.diag = d;
      const cf = appCoords(confirmRef.current); if (cf) next.confirm = cf;
      return next;
    });
  }, [appCoords]);

  const phase = PHASES[idx];
  let focusT: Pt | null = phase.focus === 'center' ? { fx: CX, fy: CY } : targets[phase.focus];
  if (focusT && phase.dy) focusT = { fx: focusT.fx, fy: focusT.fy + phase.dy };
  const camStr = focusT ? cam(phase.zoom, focusT.fx, focusT.fy) : cam(phase.zoom);
  let curPos: Pt | null = null;
  if (phase.cursor === 'rest') curPos = { fx: 360, fy: 430 };
  else if (phase.cursor) curPos = targets[phase.cursor];

  // viewport: static end-frame on phones (scaled-down walkthrough is unreadable)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const on = () => setIsMobile(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  // responsive: scale the fixed 920×600 frame to container width
  useEffect(() => {
    if (stat) return;
    const applyFit = () => {
      const w = wrapRef.current?.clientWidth ?? APP_W;
      setFit(Math.min(1, w / (APP_W + 8)));
    };
    applyFit();
    const ro = new ResizeObserver(applyFit);
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, [stat]);

  // measure interaction targets after layout settles
  useEffect(() => {
    if (stat) return;
    const id = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(id);
  }, [idx, fit, measure, stat]);

  // pause the loop when off-screen or the tab is hidden
  useEffect(() => {
    if (stat) return;
    const el = wrapRef.current;
    if (!el) return;
    let onScreen = true;
    const apply = () => setActive(onScreen && !document.hidden);
    const io = new IntersectionObserver(
      ([e]) => { onScreen = e.isIntersecting; apply(); },
      { threshold: 0.15 },
    );
    io.observe(el);
    const onVis = () => apply();
    document.addEventListener('visibilitychange', onVis);
    apply();
    return () => { io.disconnect(); document.removeEventListener('visibilitychange', onVis); };
  }, [stat]);

  // timeline — only runs while active (visible) and not static
  useEffect(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    if (stat || !active) return;
    // start each (re)activation from a clean loop (deferred — not a synchronous
    // setState in the effect body)
    timers.current.push(setTimeout(() => { setIdx(0); setConfirmed(false); }, 0));
    let t = 0;
    PHASES.forEach((p, i) => {
      if (i === 0) return;
      timers.current.push(setTimeout(() => setIdx(i), (t += PHASES[i - 1].dur)));
    });
    const total = PHASES.reduce((a, p) => a + p.dur, 0);
    timers.current.push(setTimeout(() => { setIdx(0); setCycle((c) => c + 1); }, total));
    return () => timers.current.forEach(clearTimeout);
  }, [cycle, active, stat]);

  // flip the confirm button to confirmed shortly after the click lands.
  // (reset back to false happens at loop restart in the timeline effect.)
  useEffect(() => {
    if (phase.id !== 'result_confirm') return;
    const t = setTimeout(() => setConfirmed(true), 850);
    return () => clearTimeout(t);
  }, [phase.id]);

  const stepFor = (s: string) =>
    s === 'newvisit' ? 0 : s === 'proc' ? 2 : s === 'result' ? 3 : 1;

  if (stat) {
    return (
      <div className={`tmd-stage ${golosText.variable}`}>
        <style>{CSS}</style>
        <HeroStaticNote />
      </div>
    );
  }

  return (
    <div className={`tmd-stage ${golosText.variable}`}>
      <style>{CSS}</style>

      <div className="tmd-wrap" ref={wrapRef}>
        <div className="tmd-fit" style={{ transform: `scale(${fit})`, height: APP_H * fit }}>
          <div className="tmd-frame">
            {/* browser chrome */}
            <div className="tmd-chrome">
              <div className="tmd-dots"><span /><span /><span /></div>
              <div className="tmd-omni">
                <span className="tmd-lock">🔒</span> tubermed.com/app/{phase.screen === 'result' ? 'scribe/result' : phase.screen === 'newvisit' ? 'new-visit' : 'scribe'}
              </div>
              <div className="tmd-eu">EU · криптирано</div>
            </div>

            {/* camera surface */}
            <div className="tmd-cam" style={{ transform: camStr }}>
              <div className="tmd-app" ref={appRef}>
                {/* sidebar */}
                <aside className="tmd-side">
                  <div className="tmd-logo"><span className="tmd-cross">✚</span> TuberMed</div>
                  <nav className="tmd-nav">
                    <div className={`tmd-navi ${phase.screen !== 'result' ? 'on' : ''}`}>
                      <Ico n="plus" /> Нов преглед
                    </div>
                    <div className="tmd-navi"><Ico n="users" /> Пациенти</div>
                  </nav>
                  <div className="tmd-doc"><span className="tmd-docav">ИИ</span> Д-р Иванов</div>
                </aside>

                {/* main */}
                <main className="tmd-main">
                  <div className="tmd-top">
                    <div className="tmd-crumb">
                      {phase.screen === 'newvisit' ? 'Нов преглед' : phase.screen === 'result' ? 'Амбулаторен лист' : 'Запис'}
                    </div>
                    <Stepper current={stepFor(phase.screen)} />
                  </div>

                  <div className="tmd-content">
                    {/* new-visit */}
                    <Screen show={phase.screen === 'newvisit'}>
                      <div className="tmd-nv">
                        <div className="tmd-nv-form">
                          <FormBlock label="Идентификация">
                            <Row k="Име" v="Мария Петрова" />
                            <Row k="ЕГН" v="•• •• •• 50 12" mono />
                            <Row k="Възраст" v="58 г. · жена" />
                          </FormBlock>
                          <FormBlock label="Клиничен контекст">
                            <Row k="Алергии" v="няма данни" />
                            <Row k="Хронични" v="Предсърдно мъждене · Варфарин" warn />
                          </FormBlock>
                          <FormBlock label="Тип на посещението">
                            <div className="tmd-pills">
                              <span className="tmd-pill on">Амбулаторен</span>
                              <span className="tmd-pill on">Първичен</span>
                            </div>
                          </FormBlock>
                          <FormBlock label="Главна жалба">
                            <div className="tmd-cc">Болки в кръста от 3 дни, без травма.</div>
                          </FormBlock>
                          <button className="tmd-cta" ref={ctaRef}>Започни запис <span>→</span></button>
                        </div>
                        <div className="tmd-rail">
                          <div className="tmd-rail-h">Днешен ден</div>
                          {([
                            ['Г. Стоянов', 'Профилактика', 'done'],
                            ['Р. Илиева', 'Хипертония', 'done'],
                            ['М. Петрова', 'Болки в кръста', 'now'],
                            ['Н. Колев', 'Контролен', 'wait'],
                          ] as const).map(([n, d, s], i) => (
                            <div key={i} className={`tmd-rrow ${s === 'now' ? 'cur' : ''}`}>
                              <div>
                                <div className="tmd-rn">{n}</div>
                                <div className="tmd-rd">{d}</div>
                              </div>
                              <span className={`tmd-rpill ${s}`}>
                                {s === 'done' ? '✓' : s === 'now' ? '•' : '—'}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </Screen>

                    {/* mode picker */}
                    <Screen show={phase.screen === 'mode'}>
                      <HeaderStrip />
                      <div className="tmd-mode-q">Откъде да запиша прегледа?</div>
                      <div className="tmd-modes">
                        <div className="tmd-modecard">
                          <div className="tmd-modeico"><Ico n="qr" /></div>
                          <div className="tmd-modet">Телефон</div>
                          <div className="tmd-moded">Сканирай QR и запиши от джоба</div>
                        </div>
                        <div className={`tmd-modecard ${phase.id === 'mode' ? 'sel' : ''}`} ref={pcRef}>
                          <div className="tmd-modeico"><Ico n="mic" /></div>
                          <div className="tmd-modet">Този компютър</div>
                          <div className="tmd-moded">Запиши директно от микрофона</div>
                        </div>
                      </div>
                    </Screen>

                    {/* recording — mirrors the real /app/scribe PcMode UI */}
                    <Screen show={phase.screen === 'rec'}>
                      <HeaderStrip rec={phase.id === 'recording'} />
                      <div className="tmd-rec">
                        <div className="tmd-reclabel">Запис от микрофон</div>
                        <div className="tmd-wavewrap">
                          <SpeechWave running={phase.id === 'recording'} />
                        </div>
                        <button
                          ref={recRef}
                          aria-label={phase.id === 'recording' ? 'Стоп запис' : 'Започни запис'}
                          className={`tmd-recbtn ${phase.id === 'recording' ? 'live' : ''} ${phase.id === 'record_press' ? 'press' : ''}`}
                        >
                          {phase.id === 'recording' ? (
                            <svg viewBox="0 0 24 24" width="26" height="26" fill="#fff" aria-hidden="true">
                              <path d="M6 6h12v12H6z" />
                            </svg>
                          ) : (
                            <svg viewBox="0 0 24 24" width="30" height="30" fill="#fff" aria-hidden="true">
                              <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm6-3c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
                            </svg>
                          )}
                        </button>
                        <div className={`tmd-timer ${phase.id === 'recording' ? 'on' : ''}`}>
                          {phase.id === 'recording' ? '00:03' : '00:00'}
                        </div>
                        <div className="tmd-recstatus">
                          {phase.id === 'recording' ? 'Записва се - натиснете за стоп' : 'Натиснете за запис'}
                        </div>
                      </div>
                    </Screen>

                    {/* processing */}
                    <Screen show={phase.screen === 'proc'}>
                      <HeaderStrip />
                      <div className="tmd-proc">
                        <span className="tmd-spin" />
                        <div className="tmd-proct">AI анализира разговора…</div>
                        <div className="tmd-procsub">структуриране · МКБ-10 · проверка за безопасност</div>
                      </div>
                    </Screen>

                    {/* result */}
                    <Screen show={phase.screen === 'result'}>
                      <HeaderStrip done />
                      {phase.screen === 'result' && (
                        <div className="tmd-rwrap">
                          <div className="tmd-rnav">
                            {[
                              { l: 'Диагнози МКБ-10' }, { l: 'Анамнеза' }, { l: 'Обективен статус' },
                              { l: 'Изследвания' }, { l: 'Терапия' }, { l: 'Медикаменти' },
                              { l: 'Издадени документи' }, { l: 'Направления', ind: true },
                              { l: 'Назначени изследвания', ind: true },
                            ].map((n, i) => {
                              const on = (phase.id === 'result_reveal' ? 'Диагнози МКБ-10' : 'Медикаменти') === n.l;
                              return <div key={i} className={`tmd-rnavi ${n.ind ? 'ind' : ''} ${on ? 'on' : ''}`}>{n.l}</div>;
                            })}
                          </div>

                          <div className="tmd-rdoc">
                            <Card ref={diagRef} i={0} title="Диагнози МКБ-10">
                              <div className="tmd-sublabel">Основна диагноза</div>
                              <div className="tmd-diagrow"><span>Лумбаго</span><span className="tmd-mkb">M54.5</span></div>
                              <div className="tmd-sublabel" style={{ marginTop: 9 }}>Придружаващи заболявания</div>
                              <div className="tmd-diagrow"><span>Предсърдно мъждене</span><span className="tmd-mkb">I48.9</span></div>
                            </Card>

                            <Card i={1} title="Анамнеза">
                              Болки в лумбалната област от 3 дни, без травма. Хронична антикоагулантна терапия.
                            </Card>

                            <Card i={2} title="Обективен статус">
                              RR: 138/88 mmHg · ЧСС: 76 уд/мин · палпаторна болезненост паравертебрално.
                            </Card>

                            <Card i={3} title="Терапия">
                              Локална НСПВС терапия и аналгетик при болка. Покой, избягване на натоварване.
                            </Card>

                            <Card i={4} title="Медикаменти">
                              <div className="tmd-medrow"><span className="tmd-medname">Диклофенак</span><span className="tmd-meddose">гел, локално</span></div>
                              <div className="tmd-medrow"><span className="tmd-medname">Парацетамол</span><span className="tmd-meddose">500 mg при болка</span></div>
                              <div className="tmd-warn" ref={alertRef} style={{ animationDelay: '1450ms' }}>
                                <div className="tmd-warnico">!</div>
                                <div>
                                  <div className="tmd-warnh">КРИТИЧНО · лекарствено взаимодействие</div>
                                  <div className="tmd-warnt">Пациентът приема <b>Варфарин</b>. НСПВС повишават риска от кървене.</div>
                                  <div className="tmd-warna">→ Обмисли парацетамол вместо диклофенак.</div>
                                </div>
                              </div>
                            </Card>

                            <div className="tmd-rconfirm">
                              <button ref={confirmRef} className={`tmd-confirm ${confirmed ? 'done' : ''}`}>
                                {confirmed ? '✓ Потвърдено' : '✓ Вярно! Потвърждавам'}
                              </button>
                              <span className="tmd-exp">PDF</span>
                              <span className="tmd-exp">Word</span>
                            </div>
                          </div>
                        </div>
                      )}
                    </Screen>
                  </div>
                </main>
              </div>

              {/* cursor */}
              {curPos && (
                <div className={`tmd-cursor ${phase.click ? 'click' : ''}`} style={{ left: curPos.fx, top: curPos.fy }}>
                  <svg viewBox="0 0 24 24" width="22" height="22">
                    <path d="M4 2 L4 20 L9 15 L12.5 22 L15.5 20.5 L12 13.5 L19 13 Z"
                      fill="#0c2138" stroke="#fff" strokeWidth="1.4" strokeLinejoin="round" />
                  </svg>
                  {phase.click && <span className="tmd-clickr" />}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- static end-frame (mobile + reduced-motion) ---------- */
function HeroStaticNote() {
  const rows: [string, string][] = [
    ['Диагноза · МКБ-10', 'Лумбаго · M54.5'],
    ['Обективен статус', 'RR: 138/88 mmHg · ЧСС: 76 уд/мин'],
    ['Медикаменти', 'Диклофенак гел · Парацетамол 500 mg'],
  ];
  return (
    <div
      role="img"
      aria-label="Готов амбулаторен лист с критично предупреждение за взаимодействие варфарин × НСПВС."
      className="mx-auto w-full max-w-md rounded-2xl bg-white p-5"
      style={{ border: '1px solid var(--lp-border)', boxShadow: '0 24px 50px -28px rgba(20,39,64,.35)' }}
    >
      <div className="flex items-center justify-between" aria-hidden="true">
        <span className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--lp-navy)' }}>
          Амбулаторен лист
        </span>
        <span className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold" style={{ background: '#E3F0EA', color: '#2E7D5B' }}>
          ✓ Готов
        </span>
      </div>
      <dl className="mt-4 space-y-3" aria-hidden="true">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt className="text-[11px] font-semibold" style={{ color: 'var(--lp-accent)' }}>{k}</dt>
            <dd className="mt-0.5 text-sm" style={{ color: 'var(--lp-text)' }}>{v}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-4 flex gap-3 rounded-[var(--lp-radius)] p-3.5" style={{ background: '#fdecec', border: '1px solid #f6c9c9' }} aria-hidden="true">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-sm font-extrabold" style={{ background: '#C0392B', color: '#fff' }}>!</span>
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wide" style={{ color: '#C0392B' }}>Критично · лекарствено взаимодействие</div>
          <div className="mt-1 text-sm" style={{ color: 'var(--lp-text)' }}>
            Пациентът приема <b style={{ color: '#C0392B' }}>Варфарин</b>. НСПВС повишават риска от кървене.
          </div>
          <div className="mt-1.5 text-xs" style={{ color: '#9a3636' }}>→ Обмисли парацетамол вместо диклофенак.</div>
        </div>
      </div>
    </div>
  );
}

/* ---------- small components ---------- */
function Screen({ show, children }: { show: boolean; children: ReactNode }) {
  return <div className={`tmd-screen ${show ? 'on' : ''}`}>{children}</div>;
}
function FormBlock({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="tmd-fb">
      <div className="tmd-fbl">{label}</div>
      {children}
    </div>
  );
}
function Row({ k, v, mono, warn }: { k: string; v: string; mono?: boolean; warn?: boolean }) {
  return (
    <div className="tmd-row">
      <span className="tmd-rk">{k}</span>
      <span className={`tmd-rv ${mono ? 'mono' : ''} ${warn ? 'warn' : ''}`}>{v}</span>
    </div>
  );
}
function HeaderStrip({ rec, done }: { rec?: boolean; done?: boolean }) {
  return (
    <div className="tmd-strip">
      <span className="tmd-savatar">МП</span>
      <span className="tmd-sname">Мария Петрова · 58 г · ж</span>
      <span className="tmd-spill">Първичен</span>
      <span className="tmd-salg">Алергии: няма</span>
      <span className={`tmd-sstate ${rec ? 'rec' : done ? 'done' : ''}`}>
        {rec ? '● Запис' : done ? '✓ Готово' : 'Запис'}
      </span>
    </div>
  );
}
function Stepper({ current }: { current: number }) {
  const steps = ['Пациент', 'Запис', 'Обработка', 'Лист'];
  return (
    <div className="tmd-stepper">
      {steps.map((s, i) => (
        <React.Fragment key={i}>
          <div className={`tmd-step ${i === current ? 'on' : i < current ? 'past' : ''}`}>
            <span className="tmd-stepn">{i < current ? '✓' : i + 1}</span> {s}
          </div>
          {i < steps.length - 1 && <span className="tmd-stepline" />}
        </React.Fragment>
      ))}
    </div>
  );
}
const Card = React.forwardRef<HTMLDivElement, { i: number; title: string; children: ReactNode }>(
  function Card({ i, title, children }, ref) {
    return (
      <div ref={ref} className="tmd-card" style={{ animationDelay: `${200 + i * 280}ms` }}>
        <div className="tmd-cardt">{title}</div>
        <div className="tmd-cardb">{children}</div>
      </div>
    );
  },
);

// Waveform driven by requestAnimationFrame writing transform:scaleY directly to
// the bar refs — NO per-tick React setState (that high-frequency re-render of
// the whole app mock was a top-of-page jank source). Compositor-only (scaleY),
// reduced-motion + tab-hidden safe.
const WAVE_N = 40;

function SpeechWave({ running }: { running: boolean }) {
  const barsRef = useRef<(HTMLSpanElement | null)[]>([]);
  useEffect(() => {
    if (!running) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const amps = new Array(WAVE_N).fill(0.06);
    const m = { mode: 'pause', left: 3, len: 1, pos: 0, syl: 3, loud: 0.8 };
    let raf = 0;
    let last = 0;
    let live = true;
    const apply = () => {
      for (let i = 0; i < WAVE_N; i++) {
        const el = barsRef.current[i];
        if (el) el.style.transform = `scaleY(${Math.max(0.06, amps[i])})`;
      }
    };
    const step = (t: number) => {
      if (!live) return;
      if (t - last >= 70) {
        last = t;
        if (m.left <= 0) {
          if (m.mode === 'word') {
            m.mode = 'pause';
            m.left = Math.random() < 0.22 ? 6 + Math.floor(Math.random() * 5) : 2 + Math.floor(Math.random() * 3);
          } else {
            m.mode = 'word';
            m.len = 4 + Math.floor(Math.random() * 9);
            m.left = m.len;
            m.pos = 0;
            m.syl = 2 + Math.floor(Math.random() * 4);
            m.loud = 0.55 + Math.random() * 0.45;
          }
        }
        let a: number;
        if (m.mode === 'word') {
          const tt = m.len ? m.pos / m.len : 0;
          const env = Math.sin(Math.PI * Math.min(1, Math.max(0, tt)));
          const syl = 0.5 + 0.5 * Math.abs(Math.sin(tt * m.syl * Math.PI));
          a = Math.min(1, env * syl * m.loud * (0.8 + Math.random() * 0.35));
          m.pos++;
        } else {
          a = 0.03 + Math.random() * 0.05;
        }
        m.left--;
        amps.shift();
        amps.push(a);
        apply();
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    const onVis = () => {
      if (document.hidden) { live = false; cancelAnimationFrame(raf); }
      else if (!live) { live = true; last = 0; raf = requestAnimationFrame(step); }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => { live = false; cancelAnimationFrame(raf); document.removeEventListener('visibilitychange', onVis); };
  }, [running]);
  return (
    <div className="tmd-wave2" aria-hidden="true">
      {Array.from({ length: WAVE_N }).map((_, i) => (
        <span key={i} ref={(el) => { barsRef.current[i] = el; }} style={{ opacity: 0.4 + 0.6 * (i / (WAVE_N - 1)) }} />
      ))}
    </div>
  );
}

function Ico({ n }: { n: string }) {
  const p = ({
    mic: 'M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM7 11a5 5 0 0 0 10 0M12 16v4',
    qr: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h3v3h-3zM18 18h2v2h-2z',
    users: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20a6 6 0 0 1 12 0M17 11a3 3 0 1 0 0-6M21 20a6 6 0 0 0-4-5.6',
    plus: 'M12 5v14M5 12h14',
  } as Record<string, string>)[n];
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={p} />
    </svg>
  );
}

const CSS = `
.tmd-stage{
  --ink:#0C2138; --ink2:#173352; --muted:#5d7491;
  --surface:#fff; --s2:#f3f7fb; --s3:#eaf1f9; --line:#e3ebf3;
  --steel:#274C77; --steel-d:#1D3B5C; --steelsoft:#DCE8F7;
  --rec:#e5484d; --crit:#C0392B; --ok:#2E7D5B; --warn:#B7791F;
  --gold:#B7791F; --goldsoft:#F7EDDA;
  --nav:#1D3B5C; --navtext:#aebfd4; --navactive:#274C77;
  position:relative; width:100%; display:flex; flex-direction:column; align-items:center;
  box-sizing:border-box; overflow:visible;
  font-family:var(--font-golos),system-ui,sans-serif;
}

.tmd-wrap{ position:relative; z-index:2; width:min(940px,100%); }
/* origin top-left so the scaled 920px frame fills its (possibly narrow) grid
   track from the left; the empty layout overflow is clipped by the hero
   section's overflow-hidden. */
.tmd-fit{ transform-origin:top left; }
.tmd-frame{
  width:${APP_W}px; height:${APP_H}px; background:var(--surface);
  border:1px solid var(--line); border-radius:16px; overflow:hidden;
  box-shadow:0 30px 70px -28px rgba(12,33,56,.4),0 6px 18px -10px rgba(12,33,56,.2);
}
.tmd-chrome{ height:42px; display:flex;align-items:center;gap:12px; padding:0 16px;
  background:var(--s2); border-bottom:1px solid var(--line); }
.tmd-dots{ display:flex;gap:6px; } .tmd-dots span{ width:10px;height:10px;border-radius:50%;background:#ccd8e6; }
.tmd-omni{ font-size:12px;color:var(--muted); background:#fff;border:1px solid var(--line);
  padding:5px 12px;border-radius:8px; }
.tmd-lock{ font-size:9px; }
.tmd-eu{ margin-left:auto;font-size:11px;color:var(--ok);font-weight:600;background:#e8f7f0;padding:3px 9px;border-radius:20px; }

.tmd-cam{ position:relative; width:${APP_W}px; height:${APP_H - 42}px; transform-origin:0 0;
  transition:transform .9s cubic-bezier(.65,0,.2,1); }
.tmd-app{ position:absolute; inset:0; display:flex; }

.tmd-side{ width:178px; background:var(--nav); color:var(--navtext); padding:16px 12px;
  display:flex;flex-direction:column; }
.tmd-logo{ color:#fff; font-weight:700; font-size:15px; display:flex;align-items:center;gap:7px; padding:4px 8px 18px; }
.tmd-cross{ color:#8FC0E8; }
.tmd-nav{ display:flex;flex-direction:column;gap:4px; }
.tmd-navi{ display:flex;align-items:center;gap:9px; font-size:13px; padding:9px 10px;border-radius:9px; color:var(--navtext); }
.tmd-navi.on{ background:var(--navactive); color:#fff; }
.tmd-doc{ margin-top:auto; display:flex;align-items:center;gap:8px;font-size:12.5px;color:#cdddee; padding:8px; }
.tmd-docav{ width:26px;height:26px;border-radius:8px;background:#21508a;color:#fff;font-size:10px;
  display:flex;align-items:center;justify-content:center;font-weight:600; }

.tmd-main{ flex:1; display:flex;flex-direction:column; background:var(--surface); }
.tmd-top{ height:52px; border-bottom:1px solid var(--line); display:flex;align-items:center;
  padding:0 22px; gap:20px; background:#fbfdff; }
.tmd-crumb{ font-weight:600;color:var(--ink);font-size:14px; }
.tmd-stepper{ margin-left:auto; display:flex;align-items:center;gap:8px; }
.tmd-step{ display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted); }
.tmd-step.on{ color:var(--steel);font-weight:600; }
.tmd-step.past{ color:var(--ok); }
.tmd-stepn{ width:18px;height:18px;border-radius:50%;background:var(--s3);color:var(--muted);
  font-size:10.5px;display:flex;align-items:center;justify-content:center;font-weight:600; }
.tmd-step.on .tmd-stepn{ background:var(--steel);color:#fff; }
.tmd-step.past .tmd-stepn{ background:var(--ok);color:#fff; }
.tmd-stepline{ width:18px;height:1.5px;background:var(--line); }

.tmd-content{ position:relative; flex:1; }
.tmd-screen{ position:absolute; inset:0; padding:20px 22px; opacity:0;
  transition:opacity .45s ease; pointer-events:none; }
.tmd-screen.on{ opacity:1; }

.tmd-nv{ display:flex; gap:18px; height:100%; }
.tmd-nv-form{ flex:1; display:flex;flex-direction:column;gap:11px; }
.tmd-fb{ background:var(--s2);border:1px solid var(--line);border-radius:11px;padding:11px 13px; }
.tmd-fbl{ font-size:10.5px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:var(--steel);margin-bottom:7px; }
.tmd-row{ display:flex;justify-content:space-between;padding:3px 0;font-size:13px; }
.tmd-rk{ color:var(--muted); } .tmd-rv{ color:var(--ink2);font-weight:500; }
.tmd-rv.mono{ font-variant-numeric:tabular-nums;letter-spacing:.5px; }
.tmd-rv.warn{ color:var(--warn);font-weight:600; }
.tmd-pills{ display:flex;gap:7px; }
.tmd-pill{ font-size:12px;padding:4px 12px;border-radius:20px;background:#fff;border:1px solid var(--line);color:var(--muted); }
.tmd-pill.on{ background:var(--steelsoft);border-color:#bcd0ea;color:var(--steel-d);font-weight:600; }
.tmd-cc{ font-size:13px;color:var(--ink2); }
.tmd-cta{ margin-top:4px; align-self:flex-end; background:linear-gradient(135deg,#2E5A8F,#1D3B5C);
  color:#fff;border:none;border-radius:10px;padding:11px 20px;font-size:14px;font-weight:600;font-family:inherit;
  display:flex;align-items:center;gap:8px;cursor:pointer; box-shadow:0 8px 18px -8px rgba(39,76,119,.6); }
.tmd-cta span{ transition:transform .3s; }
.tmd-rail{ width:218px;background:var(--s2);border:1px solid var(--line);border-radius:11px;padding:12px; }
.tmd-rail-h{ font-size:12px;font-weight:700;color:var(--ink);margin-bottom:9px; }
.tmd-rrow{ display:flex;justify-content:space-between;align-items:center;padding:8px 9px;border-radius:8px;margin-bottom:3px; }
.tmd-rrow.cur{ background:#fff;border:1px solid #bcd0ea; }
.tmd-rn{ font-size:12.5px;color:var(--ink2);font-weight:500; } .tmd-rd{ font-size:11px;color:var(--muted); }
.tmd-rpill{ width:20px;height:20px;border-radius:50%;font-size:11px;display:flex;align-items:center;justify-content:center; }
.tmd-rpill.done{ background:#e8f7f0;color:var(--ok); }
.tmd-rpill.now{ background:var(--steelsoft);color:var(--steel); }
.tmd-rpill.wait{ background:var(--s3);color:var(--muted); }

.tmd-strip{ display:flex;align-items:center;gap:10px;padding:9px 12px;background:var(--s2);
  border:1px solid var(--line);border-radius:10px;margin-bottom:16px; }
.tmd-savatar{ width:30px;height:30px;border-radius:8px;background:linear-gradient(135deg,#2E5A8F,#1D3B5C);
  color:#fff;font-size:11px;font-weight:600;display:flex;align-items:center;justify-content:center; }
.tmd-sname{ font-size:13px;font-weight:600;color:var(--ink); }
.tmd-spill{ font-size:11px;background:var(--steelsoft);color:var(--steel-d);padding:2px 9px;border-radius:14px;font-weight:600; }
.tmd-salg{ font-size:12px;color:var(--muted); }
.tmd-sstate{ margin-left:auto;font-size:11.5px;font-weight:600;color:var(--muted);background:#eef3f9;padding:4px 11px;border-radius:14px; }
.tmd-sstate.rec{ background:#fdeaea;color:var(--rec); } .tmd-sstate.done{ background:#e8f7f0;color:var(--ok); }

.tmd-mode-q{ text-align:center;font-size:16px;font-weight:600;color:var(--ink);margin:18px 0 22px; }
.tmd-modes{ display:flex;gap:18px;justify-content:center; }
.tmd-modecard{ width:215px;background:var(--surface);border:1.5px solid var(--line);border-radius:14px;
  padding:22px 18px;text-align:center;transition:all .3s ease; }
.tmd-modecard.sel{ border-color:var(--steel);background:#f6faff;box-shadow:0 10px 24px -12px rgba(39,76,119,.4); transform:translateY(-3px); }
.tmd-modeico{ width:46px;height:46px;border-radius:12px;background:var(--steelsoft);color:var(--steel);
  display:flex;align-items:center;justify-content:center;margin:0 auto 12px; }
.tmd-modecard.sel .tmd-modeico{ background:var(--steel);color:#fff; }
.tmd-modet{ font-size:14.5px;font-weight:600;color:var(--ink); }
.tmd-moded{ font-size:12px;color:var(--muted);margin-top:4px; }

.tmd-rec{ display:flex;flex-direction:column;align-items:center;padding-top:10px; }
.tmd-reclabel{ font-size:13px;color:var(--muted);margin-bottom:20px; }
.tmd-wavewrap{ display:flex;align-items:flex-end;justify-content:center;height:64px;margin-bottom:24px; }
.tmd-recbtn{ width:80px;height:80px;border-radius:50%;border:none;cursor:pointer;
  background:linear-gradient(135deg,#2E5A8F,#1D3B5C);box-shadow:0 10px 24px -8px rgba(39,76,119,.55);
  display:flex;align-items:center;justify-content:center;transition:background .35s ease,transform .18s ease; }
.tmd-recbtn.live{ background:linear-gradient(135deg,#ec5b60,#e5484d);box-shadow:0 10px 24px -8px rgba(229,72,77,.6); }
.tmd-recbtn.press{ animation:tmd-press .4s ease 0.85s; }
.tmd-timer{ margin-top:20px;color:var(--muted);font-weight:600;font-variant-numeric:tabular-nums;
  font-family:var(--font-jetbrains),ui-monospace,monospace;font-size:24px; }
.tmd-timer.on{ color:var(--rec); }
.tmd-recstatus{ margin-top:8px;font-size:13px;color:var(--muted); }
.tmd-wave2{ display:flex;align-items:flex-end;gap:2px;height:64px; }
.tmd-wave2 span{ width:3px;height:56px;border-radius:3px;background:linear-gradient(180deg,#8FC0E8,#4F8FBF);
  transform-origin:bottom;transform:scaleY(.06);will-change:transform; }

.tmd-proc{ display:flex;flex-direction:column;align-items:center;justify-content:center;padding-top:46px; }
.tmd-spin{ width:34px;height:34px;border-radius:50%;border:3.5px solid var(--s3);border-top-color:var(--steel);
  animation:tmd-spin .8s linear infinite; }
.tmd-proct{ margin-top:18px;font-size:15px;font-weight:600;color:var(--ink); }
.tmd-procsub{ margin-top:6px;font-size:12.5px;color:var(--muted); }

.tmd-rwrap{ display:flex; gap:16px; }
.tmd-rnav{ width:138px; flex:none; display:flex; flex-direction:column; gap:2px; padding-top:4px; }
.tmd-rnavi{ font-size:12px; color:var(--muted); padding:7px 10px; border-radius:8px;
  border-left:2px solid transparent; transition:all .3s ease; }
.tmd-rnavi.on{ color:var(--steel); background:#f4f8fe; border-left-color:var(--steel); font-weight:600; }
.tmd-rnavi.ind{ padding-left:22px; }
.tmd-rdoc{ flex:1; display:flex; flex-direction:column; gap:12px; }
.tmd-card{ background:#fff; border:1px solid var(--line); border-radius:16px; padding:15px 17px;
  opacity:0; animation:tmd-rf .55s cubic-bezier(.2,.7,.3,1) forwards; box-shadow:0 1px 2px rgba(12,33,56,.03); }
.tmd-cardt{ font-size:13.5px; font-weight:700; color:var(--ink); margin-bottom:9px; }
.tmd-cardb{ font-size:13px; color:var(--ink2); line-height:1.5; }
.tmd-sublabel{ font-size:10px; font-weight:600; letter-spacing:.5px; text-transform:uppercase; color:var(--muted); margin-bottom:4px; }
.tmd-diagrow{ display:flex; align-items:center; justify-content:space-between; padding:5px 0; font-size:13.5px; color:var(--ink2); }
.tmd-mkb{ display:inline-block; font-size:11px; font-weight:700; font-family:var(--font-jetbrains),monospace;
  letter-spacing:.5px; color:var(--gold); background:var(--goldsoft); padding:2px 8px; border-radius:6px; }
.tmd-medrow{ display:flex; align-items:center; justify-content:space-between; padding:7px 0; border-bottom:1px solid var(--s2); font-size:13px; }
.tmd-medname{ font-weight:600; color:var(--ink); }
.tmd-meddose{ color:var(--muted); font-size:12px; }
.tmd-warn{ display:flex; gap:11px; margin-top:12px; padding:13px; border-radius:11px; background:#fdecec;
  border:1px solid #f6c9c9; opacity:0; animation:tmd-al .55s cubic-bezier(.2,.8,.2,1) forwards; }
.tmd-warnico{ flex:none; width:25px; height:25px; border-radius:50%; background:var(--crit); color:#fff;
  font-weight:800; display:flex; align-items:center; justify-content:center; font-size:14px; animation:tmd-ap 1.1s ease-in-out 3; }
.tmd-warnh{ font-size:10px; font-weight:700; letter-spacing:.5px; color:var(--crit); text-transform:uppercase; }
.tmd-warnt{ font-size:13px; color:var(--ink); margin-top:3px; } .tmd-warnt b{ color:var(--crit); }
.tmd-warna{ font-size:12px; color:#9a3636; margin-top:5px; font-weight:500; }
.tmd-rconfirm{ display:flex; align-items:center; gap:10px; padding:4px 0 8px; opacity:0;
  animation:tmd-fu .5s ease 1950ms forwards; }
.tmd-confirm{ background:var(--steel); color:#fff; border:none; border-radius:9px; padding:10px 18px;
  font-size:13px; font-weight:600; font-family:inherit; cursor:pointer; transition:background .4s ease; }
.tmd-confirm.done{ background:var(--ok); }
.tmd-exp{ font-size:12px; color:var(--steel); font-weight:600; border:1px solid var(--steelsoft); padding:7px 13px; border-radius:8px; }

.tmd-cursor{ position:absolute;z-index:30;pointer-events:none;
  transition:left .85s cubic-bezier(.65,0,.2,1),top .85s cubic-bezier(.65,0,.2,1);
  filter:drop-shadow(0 2px 3px rgba(12,33,56,.35)); }
.tmd-cursor.click{ animation:tmd-tap .35s ease 0.85s; }
.tmd-clickr{ position:absolute;left:-8px;top:-6px;width:40px;height:40px;border-radius:50%;
  background:rgba(39,76,119,.18);border:2px solid var(--steel);opacity:0;animation:tmd-clk .65s ease 0.85s; }

@keyframes tmd-spin{ to{transform:rotate(360deg)} }
@keyframes tmd-fu{ from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
@keyframes tmd-rf{ from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:translateY(0)} }
@keyframes tmd-al{ from{opacity:0;transform:translateY(14px) scale(.97)} to{opacity:1;transform:translateY(0) scale(1)} }
@keyframes tmd-ap{ 0%,100%{transform:scale(1)} 50%{transform:scale(1.18)} }
@keyframes tmd-tap{ 0%,100%{transform:scale(1)} 45%{transform:scale(.8)} }
@keyframes tmd-press{ 0%,100%{transform:scale(1)} 45%{transform:scale(.86)} }
@keyframes tmd-clk{ 0%{transform:scale(.6);opacity:.8} 100%{transform:scale(1.8);opacity:0} }

@media (prefers-reduced-motion: reduce) {
  .tmd-cam, .tmd-cursor { transition: none !important; }
  .tmd-card, .tmd-warn, .tmd-rconfirm, .tmd-tline { animation: none !important; opacity: 1 !important; }
}
`;
