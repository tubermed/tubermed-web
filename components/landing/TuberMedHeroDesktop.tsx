'use client';

import React, { useEffect, useState, useRef, useCallback } from 'react';
import type { ReactNode } from 'react';
import { useReducedMotion } from 'framer-motion';
import { golosText, interTight } from '@/lib/landing-fonts';
import { TileMark } from './brand';

/**
 * TuberMed — hero product film (Dimitar's prototype, rebuilt to the shipped
 * calm-clinical UI). A moving "camera" (zoom/pan) glides over a faux-real app:
 * patient → record (mic) → processing → Амбулаторен лист → source-grounding →
 * the warfarin × NSAID safety catch → doctor approves → exports unlock. Pure
 * DOM + CSS; loops continuously.
 *
 * ACCURACY is the point — every depicted screen mirrors the shipped house style
 * (components/ui/NoteSection.tsx, app/app/scribe/{page,result/page}.tsx,
 * components/ui/Icon.tsx): de-boxed NoteSection heads (accent tick + small navy
 * icon + ~14px uppercase navy label + hairline — NOT boxed cards), the Lucide
 * SVG icon set (no emoji), the result's left section-nav + center one-sheet +
 * RIGHT meds-safety rail, the calm record sheet (segmented control, navy→red
 * record button, mono tabular timer, green "На запис · AI слуша"), the blue mono
 * МКБ chip, and the workspace token palette (#274C77 navy / #C0392B critical /
 * #2E7D5B success / #B7791F warn). Reproduced via the mock's OWN scoped styles —
 * landing isolation forbids importing workspace components or --color-* tokens.
 *
 * Fonts are self-hosted via next/font (Golos Text for in-mock body, Inter Tight
 * for the display hook/payoff type, JetBrains Mono for МКБ codes/timer) — NO
 * runtime web-font request.
 *
 * Guardrails: on mobile OR prefers-reduced-motion it renders a static, readable
 * end-frame (finished note + critical alert) instead of the scaled 920×600
 * walkthrough; the loop pauses when off-screen or the tab is hidden.
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
    rec: { fx: 510, fy: 300 }, alert: { fx: 720, fy: 250 },
    diag: { fx: 430, fy: 150 }, confirm: { fx: 360, fy: 110 },
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

  // semantic flags derived from the phase (decouples screens from exact ids)
  const recLive = phase.id === 'recording';
  const alertShown = phase.screen === 'result' && (phase.id === 'result_alert' || phase.id === 'result_confirm');

  if (stat) {
    return (
      <div className={`tmd-stage ${golosText.variable} ${interTight.variable}`}>
        <style>{CSS}</style>
        <HeroStaticNote />
      </div>
    );
  }

  return (
    <div className={`tmd-stage ${golosText.variable} ${interTight.variable}`}>
      <style>{CSS}</style>

      <div className="tmd-wrap" ref={wrapRef}>
        <div className="tmd-fit" style={{ transform: `scale(${fit})`, height: APP_H * fit }}>
          <div className="tmd-frame">
            {/* browser chrome */}
            <div className="tmd-chrome">
              <div className="tmd-dots"><span /><span /><span /></div>
              <div className="tmd-omni">
                <Ico n="lock" size={11} /> tubermed.com/app/{phase.screen === 'result' ? 'scribe/result' : phase.screen === 'newvisit' ? 'new-visit' : 'scribe'}
              </div>
              <div className="tmd-eu">EU · криптирано</div>
            </div>

            {/* camera surface */}
            <div className="tmd-cam" style={{ transform: camStr }}>
              <div className="tmd-app" ref={appRef}>
                {/* sidebar */}
                <aside className="tmd-side">
                  <div className="tmd-logo"><TileMark size={22} /> <span>TuberMed</span></div>
                  <nav className="tmd-nav">
                    <div className={`tmd-navi ${phase.screen !== 'result' ? 'on' : ''}`}>
                      <Ico n="plus" size={15} /> Нов преглед
                    </div>
                    <div className="tmd-navi"><Ico n="user" size={15} /> Пациенти</div>
                  </nav>
                  <div className="tmd-doc"><span className="tmd-docav">ДИ</span> Д-р Иванов</div>
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
                            <Row k="Алергии" v="неустановени" />
                            <Row k="Хронични" v="Предсърдно мъждене · Варфарин" warn />
                          </FormBlock>
                          <FormBlock label="Тип на посещението">
                            <div className="tmd-pills">
                              <span className="tmd-pill on">Първичен</span>
                              <span className="tmd-pill">Контролен</span>
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
                                {s === 'done' ? <Ico n="check" size={12} /> : s === 'now' ? <i className="tmd-dot" /> : <i className="tmd-dash" />}
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
                        <div className={`tmd-modecard ${phase.id === 'mode' ? 'sel' : ''}`} ref={pcRef}>
                          <div className="tmd-modeico"><Ico n="mic" size={22} /></div>
                          <div className="tmd-modet">Този компютър</div>
                          <div className="tmd-moded">Запиши директно от микрофона</div>
                        </div>
                        <div className="tmd-modecard">
                          <div className="tmd-modeico"><Ico n="smartphone" size={22} /></div>
                          <div className="tmd-modet">Телефон (QR)</div>
                          <div className="tmd-moded">Сканирай QR и запиши от джоба</div>
                        </div>
                      </div>
                    </Screen>

                    {/* recording — mirrors the real /app/scribe PcMode UI */}
                    <Screen show={phase.screen === 'rec'}>
                      <HeaderStrip rec={recLive} />
                      <div className="tmd-reccard">
                        <div className="tmd-rech">
                          <div className="tmd-rech-t">Запис на консултацията</div>
                          <div className="tmd-rech-s">AI слуша и записва. Нищо не напуска ЕС.</div>
                        </div>
                        <div className="tmd-seg">
                          <span className="tmd-segp on"><Ico n="mic" size={14} /> Микрофон</span>
                          <span className="tmd-segp"><Ico n="smartphone" size={14} /> Телефон (QR)</span>
                        </div>
                        <div className="tmd-rec">
                          <div className="tmd-recstage">
                            {recLive && <><span className="tmd-ring r1" /><span className="tmd-ring r2" /></>}
                            <button
                              ref={recRef}
                              aria-label={recLive ? 'Стоп запис' : 'Започни запис'}
                              className={`tmd-recbtn ${recLive ? 'live' : ''} ${phase.id === 'record_press' ? 'press' : ''}`}
                            >
                              {recLive ? (
                                <svg viewBox="0 0 24 24" width="28" height="28" fill="#fff" aria-hidden="true">
                                  <path d="M6 6h12v12H6z" />
                                </svg>
                              ) : (
                                <svg viewBox="0 0 24 24" width="32" height="32" fill="#fff" aria-hidden="true">
                                  <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm6-3c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
                                </svg>
                              )}
                            </button>
                          </div>
                          <div className={`tmd-timer ${recLive ? 'on' : ''}`}>
                            {recLive ? '00:03' : '00:00'}
                          </div>
                          {recLive ? (
                            <div className="tmd-recstatus live"><i className="tmd-okdot" /> На запис · AI слуша</div>
                          ) : (
                            <div className="tmd-recstatus">Натиснете за запис</div>
                          )}
                          <div className="tmd-wavewrap">
                            <SpeechWave running={recLive} />
                          </div>
                        </div>
                      </div>
                    </Screen>

                    {/* processing */}
                    <Screen show={phase.screen === 'proc'}>
                      <HeaderStrip />
                      <div className="tmd-proccard">
                        <span className="tmd-spin" />
                        <div className="tmd-proct">AI анализира…</div>
                        <div className="tmd-procsub">структуриране · МКБ-10 · проверка за безопасност</div>
                      </div>
                    </Screen>

                    {/* result */}
                    <Screen show={phase.screen === 'result'}>
                      <HeaderStrip done />
                      {phase.screen === 'result' && (
                        <div className="tmd-result">
                          {/* top action bar — StatusBadge (locked → confirmed) + exports */}
                          <div className="tmd-actionbar">
                            <button ref={confirmRef} className={`tmd-statusbadge ${confirmed ? 'ok' : ''}`}>
                              <Ico n={confirmed ? 'check' : 'lock'} size={13} />
                              {confirmed ? 'Потвърдено от лекар' : 'Вярно! Потвърждавам прегледа'}
                            </button>
                            <div className={`tmd-exports ${confirmed ? 'on' : ''}`}>
                              <span className="tmd-expbtn"><Ico n={confirmed ? 'download' : 'lock'} size={12} /> PDF</span>
                              <span className="tmd-expbtn"><Ico n={confirmed ? 'download' : 'lock'} size={12} /> Word</span>
                              <span className="tmd-expbtn"><Ico n={confirmed ? 'copy' : 'lock'} size={12} /> Копирай</span>
                              <span className="tmd-expbtn"><Ico n={confirmed ? 'printer' : 'lock'} size={12} /> Печат</span>
                            </div>
                          </div>

                          <div className="tmd-rwrap">
                            <div className="tmd-rnav">
                              <div className="tmd-rnav-h">Раздели</div>
                              {[
                                { l: 'Диагнози МКБ-10' }, { l: 'Анамнеза' }, { l: 'Обективен статус' },
                                { l: 'Изследвания' }, { l: 'Назначени изследвания', ind: true },
                                { l: 'Терапия' }, { l: 'Медикаменти' },
                                { l: 'Издадени документи' }, { l: 'Направления', ind: true },
                              ].map((n, i) => {
                                const on = (phase.id === 'result_reveal' ? 'Диагнози МКБ-10' : 'Медикаменти') === n.l;
                                return <div key={i} className={`tmd-rnavi ${n.ind ? 'ind' : ''} ${on ? 'on' : ''}`}>{n.l}</div>;
                              })}
                            </div>

                            <div className="tmd-rdoc">
                              <div className="tmd-doch">
                                <div className="tmd-doctitle">Амбулаторен лист</div>
                                <div className="tmd-docdate">21.06.2026</div>
                              </div>

                              <Sec ref={diagRef} i={0} title="Диагнози МКБ-10" icon="clipboard">
                                <div className="tmd-sublabel">Основна диагноза</div>
                                <div className="tmd-diagrow"><span>Лумбаго</span><span className="tmd-mkb">M54.5</span></div>
                                <div className="tmd-sublabel" style={{ marginTop: 9 }}>Придружаващи заболявания</div>
                                <div className="tmd-diagrow"><span>Предсърдно мъждене</span><span className="tmd-mkb">I48.9</span></div>
                              </Sec>

                              <Sec i={1} title="Анамнеза" icon="file-text">
                                Болки в лумбалната област от 3 дни, без травма. Хронична антикоагулантна терапия с варфарин.
                              </Sec>

                              <Sec i={2} title="Обективно състояние" icon="stethoscope">
                                <span className="tmd-vitals">RR: 138/88 mmHg · ЧСС: 76 уд/мин · t°: 36.6°C · SpO2: 98%</span>
                                <br />Палпаторна болезненост паравертебрално.
                              </Sec>

                              <Sec i={3} title="Терапия" icon="pill">
                                Локална НСПВС терапия и аналгетик при болка. Покой, избягване на натоварване.
                              </Sec>
                            </div>

                            {/* right meds + safety rail */}
                            <div className="tmd-rrail">
                              <div className="tmd-medcard">
                                <div className="tmd-medcard-h"><Ico n="pill" size={13} /> Медикаменти</div>
                                {alertShown && (
                                  <div className="tmd-crit" ref={alertRef}>
                                    <span className="tmd-crit-ico"><Ico n="alert-octagon" size={16} /></span>
                                    <div>
                                      <div className="tmd-crit-badge">Внимание</div>
                                      <div className="tmd-crit-msg"><b>Варфарин × НСПВС</b> — повишен риск от кървене.</div>
                                      <div className="tmd-crit-act"><b>Действие:</b> обмисли парацетамол вместо диклофенак.</div>
                                    </div>
                                  </div>
                                )}
                                <div className={`tmd-medrow ${alertShown ? 'trig' : ''}`}>
                                  <span className="tmd-medname">{alertShown && <Ico n="alert-octagon" size={13} />}Диклофенак</span>
                                  <span className="tmd-meddose">гел, локално</span>
                                </div>
                                <div className="tmd-medrow">
                                  <span className="tmd-medname">Парацетамол</span>
                                  <span className="tmd-meddose">500 mg при болка</span>
                                </div>
                              </div>
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
    ['Обективно състояние', 'RR: 138/88 mmHg · ЧСС: 76 уд/мин'],
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
        <span className="text-xs font-bold uppercase tracking-wide" style={{ color: '#274C77' }}>
          Амбулаторен лист
        </span>
        <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold" style={{ background: '#E3F0EA', color: '#1B6B46' }}>
          <Ico n="check" size={12} /> Потвърдено
        </span>
      </div>
      <dl className="mt-4 space-y-3" aria-hidden="true">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: '#274C77' }}>{k}</dt>
            <dd className="mt-0.5 text-sm" style={{ color: '#1C2733' }}>{v}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-4 flex gap-3 rounded-[var(--lp-radius)] p-3.5" style={{ background: '#F6E4E1', border: '1px solid #C0392B' }} aria-hidden="true">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center" style={{ color: '#C0392B' }}><Ico n="alert-octagon" size={18} /></span>
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wide" style={{ color: '#C0392B' }}>Внимание · лекарствено взаимодействие</div>
          <div className="mt-1 text-sm" style={{ color: '#1C2733' }}>
            <b style={{ color: '#C0392B' }}>Варфарин × НСПВС</b> — повишен риск от кървене.
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
      <div className="tmd-strip-row">
        <span className="tmd-savatar">МП</span>
        <span className="tmd-sname">Мария Петрова</span>
        <span className="tmd-sdiv" /><span className="tmd-smeta">58 г.</span>
        <span className="tmd-sdiv" /><span className="tmd-smeta">жена</span>
        <span className="tmd-spill">Първичен</span>
        <span className={`tmd-sstate ${rec ? 'rec' : done ? 'done' : ''}`}>
          {rec ? <><i className="tmd-recdot" /> Запис</> : done ? <><Ico n="check" size={12} /> Готово</> : 'Запис'}
        </span>
      </div>
      <div className="tmd-strip-row ctx">
        <span className="tmd-ctxl">Алергии</span><span className="tmd-ctxv">неустановени</span>
        <span className="tmd-ctxl">Хронични</span><span className="tmd-ctxv warn">Предсърдно мъждене · Варфарин</span>
      </div>
    </div>
  );
}
function Stepper({ current }: { current: number }) {
  const steps = ['Вход', 'Запис', 'Обработка', 'Резултат'];
  return (
    <div className="tmd-stepper">
      {steps.map((s, i) => (
        <React.Fragment key={i}>
          <div className={`tmd-step ${i === current ? 'on' : i < current ? 'past' : ''}`}>
            <span className="tmd-stepn">{i < current ? <Ico n="check" size={11} /> : i + 1}</span> {s}
          </div>
          {i < steps.length - 1 && <span className="tmd-stepline" />}
        </React.Fragment>
      ))}
    </div>
  );
}

// A de-boxed NoteSection: accent tick + small navy icon + uppercase navy label +
// hairline + content — the shipped calm-clinical head (NoteSectionHead).
const Sec = React.forwardRef<HTMLDivElement, { i: number; title: string; icon: string; children: ReactNode }>(
  function Sec({ i, title, icon, children }, ref) {
    return (
      <div ref={ref} className="tmd-sec" style={{ animationDelay: `${160 + i * 240}ms` }}>
        <div className="tmd-sechead">
          <span className="tmd-sectick" />
          <span className="tmd-secico"><Ico n={icon} size={15} /></span>
          <span className="tmd-seclabel">{title}</span>
        </div>
        <div className="tmd-sechair" />
        <div className="tmd-secbody">{children}</div>
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
        <span key={i} ref={(el) => { barsRef.current[i] = el; }} style={{ opacity: i > WAVE_N * 0.72 ? 0.5 : 1 }} />
      ))}
    </div>
  );
}

/* ---------- icon set (reproduces components/ui/Icon.tsx Lucide geometry —
   landing isolation forbids importing the workspace component) ---------- */
const ICONS: Record<string, ReactNode> = {
  mic: (<><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" x2="12" y1="19" y2="22" /></>),
  smartphone: (<><rect width="14" height="20" x="5" y="2" rx="2" ry="2" /><path d="M12 18h.01" /></>),
  'alert-triangle': (<><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" /><path d="M12 9v4" /><path d="M12 17h.01" /></>),
  'alert-octagon': (<><polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86" /><line x1="12" x2="12" y1="8" y2="12" /><line x1="12" x2="12.01" y1="16" y2="16" /></>),
  check: <path d="M20 6 9 17l-5-5" />,
  lock: (<><rect width="18" height="11" x="3" y="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></>),
  download: (<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" x2="12" y1="15" y2="3" /></>),
  printer: (<><polyline points="6 9 6 2 18 2 18 9" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><rect width="12" height="8" x="6" y="14" /></>),
  'file-text': (<><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /><path d="M16 13H8" /><path d="M16 17H8" /><path d="M10 9H8" /></>),
  clipboard: (<><rect width="8" height="4" x="8" y="2" rx="1" ry="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /></>),
  flask: (<><path d="M10 2v7.527a2 2 0 0 1-.211.896L4.72 20.55a1 1 0 0 0 .9 1.45h12.76a1 1 0 0 0 .9-1.45l-5.069-10.127A2 2 0 0 1 14 9.527V2" /><path d="M8.5 2h7" /><path d="M7 16h10" /></>),
  stethoscope: (<><path d="M4.8 2.3A.3.3 0 1 0 5 2H4a2 2 0 0 0-2 2v5a6 6 0 0 0 6 6 6 6 0 0 0 6-6V4a2 2 0 0 0-2-2h-1a.2.2 0 1 0 .3.3" /><path d="M8 15v1a6 6 0 0 0 6 6 6 6 0 0 0 6-6v-4" /><circle cx="20" cy="10" r="2" /></>),
  pill: (<><path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z" /><path d="m8.5 8.5 7 7" /></>),
  copy: (<><rect width="14" height="14" x="8" y="8" rx="2" ry="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></>),
  user: (<><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>),
  plus: (<><path d="M5 12h14" /><path d="M12 5v14" /></>),
  search: (<><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></>),
};

function Ico({ n, size = 16, sw = 1.75 }: { n: string; size?: number; sw?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none"
      stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[n]}
    </svg>
  );
}

const CSS = `
.tmd-stage{
  --ink:#142740; --ink2:#1C2733; --muted:#586472; --hint:#8893A1;
  --surface:#fff; --bg:#F3F5F8; --tint:#F6F9FC; --subtle:#EDF0F4;
  --line:#DCE1E8; --line2:#C2CAD4; --hair:#E7ECF2;
  --steel:#274C77; --steel-d:#1D3B5C; --steel-soft:#E1E9F3; --steel-light:#E8EFF7; --steel-mid:#2F5C8F;
  --crit:#C0392B; --crit-soft:#F6E4E1;
  --ok:#2E7D5B; --ok-soft:#E3F0EA; --ok-strong:#1B6B46;
  --gold:#B7791F; --gold-soft:#F7EDDA;
  --nav:#1B2D49; --nav-elev:#24395A; --nav-text:#AAB6C6; --nav-active:#274C77;
  --shadow-card:0 1px 2px rgba(27,42,65,.06),0 1px 3px rgba(27,42,65,.08);
  position:relative; width:100%; display:flex; flex-direction:column; align-items:center;
  box-sizing:border-box; overflow:visible;
  font-family:var(--font-golos),system-ui,sans-serif;
}
.tmd-stage *{ box-sizing:border-box; }

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
  background:var(--tint); border-bottom:1px solid var(--line); }
.tmd-dots{ display:flex;gap:6px; } .tmd-dots span{ width:10px;height:10px;border-radius:50%;background:#ccd8e6; }
.tmd-omni{ font-size:12px;color:var(--muted); background:#fff;border:1px solid var(--line);
  padding:5px 12px;border-radius:8px; display:flex;align-items:center;gap:6px; }
.tmd-omni svg{ color:var(--muted); }
.tmd-eu{ margin-left:auto;font-size:11px;color:var(--ok-strong);font-weight:600;background:var(--ok-soft);padding:3px 9px;border-radius:20px; }

.tmd-cam{ position:relative; width:${APP_W}px; height:${APP_H - 42}px; transform-origin:0 0;
  transition:transform .9s cubic-bezier(.65,0,.2,1); }
.tmd-app{ position:absolute; inset:0; display:flex; }

.tmd-side{ width:178px; background:var(--nav); color:var(--nav-text); padding:16px 12px;
  display:flex;flex-direction:column; }
.tmd-logo{ color:#fff; font-weight:700; font-size:15px; display:flex;align-items:center;gap:8px; padding:2px 6px 18px; }
.tmd-nav{ display:flex;flex-direction:column;gap:4px; }
.tmd-navi{ display:flex;align-items:center;gap:9px; font-size:13px; padding:9px 10px;border-radius:9px; color:var(--nav-text); }
.tmd-navi.on{ background:var(--nav-active); color:#fff; }
.tmd-doc{ margin-top:auto; display:flex;align-items:center;gap:8px;font-size:12.5px;color:#cdddee; padding:8px; }
.tmd-docav{ width:26px;height:26px;border-radius:8px;background:var(--nav-elev);color:#fff;font-size:10px;
  display:flex;align-items:center;justify-content:center;font-weight:600; }

.tmd-main{ flex:1; display:flex;flex-direction:column; background:var(--surface); min-width:0; }
.tmd-top{ height:52px; border-bottom:1px solid var(--line); display:flex;align-items:center;
  padding:0 22px; gap:20px; background:#fbfdff; }
.tmd-crumb{ font-weight:600;color:var(--ink);font-size:14px; }
.tmd-stepper{ margin-left:auto; display:flex;align-items:center;gap:8px; }
.tmd-step{ display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted); }
.tmd-step.on{ color:var(--steel);font-weight:600; }
.tmd-step.past{ color:var(--ok); }
.tmd-stepn{ width:18px;height:18px;border-radius:50%;background:var(--subtle);color:var(--muted);
  font-size:10.5px;display:flex;align-items:center;justify-content:center;font-weight:600; }
.tmd-step.on .tmd-stepn{ background:var(--steel);color:#fff; }
.tmd-step.past .tmd-stepn{ background:var(--ok);color:#fff; }
.tmd-stepline{ width:18px;height:1.5px;background:var(--line); }

.tmd-content{ position:relative; flex:1; min-height:0; }
.tmd-screen{ position:absolute; inset:0; padding:20px 22px; opacity:0;
  transition:opacity .45s ease; pointer-events:none; overflow:hidden; }
.tmd-screen.on{ opacity:1; }

/* new-visit */
.tmd-nv{ display:flex; gap:18px; height:100%; }
.tmd-nv-form{ flex:1; display:flex;flex-direction:column;gap:11px; min-width:0; }
.tmd-fb{ background:var(--tint);border:1px solid var(--line);border-radius:11px;padding:11px 13px; }
.tmd-fbl{ font-size:10.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--steel);margin-bottom:7px; }
.tmd-row{ display:flex;justify-content:space-between;padding:3px 0;font-size:13px; }
.tmd-rk{ color:var(--muted); } .tmd-rv{ color:var(--ink2);font-weight:500; }
.tmd-rv.mono{ font-variant-numeric:tabular-nums;letter-spacing:.5px; }
.tmd-rv.warn{ color:var(--gold);font-weight:600; }
.tmd-pills{ display:flex;gap:7px; }
.tmd-pill{ font-size:12px;padding:4px 12px;border-radius:20px;background:#fff;border:1px solid var(--line);color:var(--muted); }
.tmd-pill.on{ background:var(--steel-soft);border-color:#bcd0ea;color:var(--steel);font-weight:600; }
.tmd-cc{ font-size:13px;color:var(--ink2); }
.tmd-cta{ margin-top:4px; align-self:flex-end; background:var(--steel);
  color:#fff;border:none;border-radius:10px;padding:11px 20px;font-size:14px;font-weight:600;font-family:inherit;
  display:flex;align-items:center;gap:8px;cursor:pointer; box-shadow:0 8px 18px -8px rgba(39,76,119,.55); }
.tmd-cta span{ transition:transform .3s; }
.tmd-rail{ width:212px;background:var(--tint);border:1px solid var(--line);border-radius:11px;padding:12px; flex:none; }
.tmd-rail-h{ font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);margin-bottom:9px; }
.tmd-rrow{ display:flex;justify-content:space-between;align-items:center;padding:8px 9px;border-radius:8px;margin-bottom:3px; }
.tmd-rrow.cur{ background:#fff;border:1px solid #bcd0ea; }
.tmd-rn{ font-size:12.5px;color:var(--ink2);font-weight:500; } .tmd-rd{ font-size:11px;color:var(--muted); }
.tmd-rpill{ width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center; }
.tmd-rpill.done{ background:var(--ok-soft);color:var(--ok); }
.tmd-rpill.now{ background:var(--steel-soft); }
.tmd-rpill.wait{ background:var(--subtle); }
.tmd-dot{ width:7px;height:7px;border-radius:50%;background:var(--steel);display:block; }
.tmd-dash{ width:8px;height:2px;border-radius:2px;background:var(--muted);display:block; }

/* patient header strip */
.tmd-strip{ display:flex;flex-direction:column;gap:6px;padding:9px 13px;background:var(--surface);
  border:1px solid var(--line);border-radius:10px;margin-bottom:16px; }
.tmd-strip-row{ display:flex;align-items:center;gap:9px; }
.tmd-savatar{ width:30px;height:30px;border-radius:8px;background:var(--steel);
  color:#fff;font-size:11px;font-weight:600;display:flex;align-items:center;justify-content:center; }
.tmd-sname{ font-size:14px;font-weight:600;color:var(--ink); }
.tmd-sdiv{ width:1px;height:14px;background:var(--line); }
.tmd-smeta{ font-size:12.5px;color:var(--muted); }
.tmd-spill{ font-size:10px;text-transform:uppercase;letter-spacing:.06em;background:var(--steel-soft);color:var(--steel);padding:2px 8px;border-radius:5px;font-weight:600; }
.tmd-sstate{ margin-left:auto;font-size:11.5px;font-weight:600;color:var(--muted);background:var(--subtle);padding:4px 11px;border-radius:14px; display:inline-flex;align-items:center;gap:5px; }
.tmd-sstate.rec{ background:var(--crit-soft);color:var(--crit); } .tmd-sstate.done{ background:var(--ok-soft);color:var(--ok-strong); }
.tmd-recdot{ width:7px;height:7px;border-radius:50%;background:var(--crit);display:block;animation:tmd-blink 1s steps(2) infinite; }
.tmd-strip-row.ctx{ gap:7px;flex-wrap:wrap; }
.tmd-ctxl{ font-size:9.5px;text-transform:uppercase;letter-spacing:.14em;font-weight:600;color:var(--muted); }
.tmd-ctxv{ font-size:12px;color:var(--muted);margin-right:8px; }
.tmd-ctxv.warn{ color:var(--gold); }

/* mode picker */
.tmd-mode-q{ text-align:center;font-size:16px;font-weight:600;color:var(--ink);margin:18px 0 22px; }
.tmd-modes{ display:flex;gap:18px;justify-content:center; }
.tmd-modecard{ width:215px;background:var(--surface);border:1.5px solid var(--line);border-radius:14px;
  padding:22px 18px;text-align:center;transition:all .3s ease; }
.tmd-modecard.sel{ border-color:var(--steel);background:var(--tint);box-shadow:0 10px 24px -12px rgba(39,76,119,.4); transform:translateY(-3px); }
.tmd-modeico{ width:46px;height:46px;border-radius:12px;background:var(--steel-soft);color:var(--steel);
  display:flex;align-items:center;justify-content:center;margin:0 auto 12px; }
.tmd-modecard.sel .tmd-modeico{ background:var(--steel);color:#fff; }
.tmd-modet{ font-size:14.5px;font-weight:600;color:var(--ink); }
.tmd-moded{ font-size:12px;color:var(--muted);margin-top:4px; }

/* record sheet */
.tmd-reccard{ max-width:520px;margin:0 auto;background:#fff;border:1px solid var(--line);border-radius:16px;
  padding:20px 24px; box-shadow:var(--shadow-card); }
.tmd-rech-t{ font-size:17px;font-weight:600;color:var(--steel);letter-spacing:-.01em; }
.tmd-rech-s{ margin-top:3px;font-size:12.5px;color:var(--muted); }
.tmd-reccard .tmd-rech{ padding-bottom:14px;border-bottom:1px solid var(--hair); }
.tmd-seg{ display:flex;gap:4px;padding:4px;border-radius:10px;background:var(--subtle);border:1px solid var(--hair);
  max-width:300px;margin:16px auto 0; }
.tmd-segp{ flex:1;display:inline-flex;align-items:center;justify-content:center;gap:6px;
  padding:7px 0;border-radius:7px;font-size:12.5px;font-weight:500;color:var(--muted); }
.tmd-segp.on{ background:#fff;color:var(--steel);box-shadow:var(--shadow-card);font-weight:600; }
.tmd-rec{ display:flex;flex-direction:column;align-items:center;padding-top:18px; }
.tmd-recstage{ position:relative;width:140px;height:120px;display:flex;align-items:center;justify-content:center; }
.tmd-ring{ position:absolute;border-radius:50%; }
.tmd-ring.r1{ width:124px;height:124px;background:var(--steel-light);opacity:.55;animation:tmd-pulse 2.4s ease-in-out infinite; }
.tmd-ring.r2{ width:98px;height:98px;background:var(--steel-soft);opacity:.7;animation:tmd-pulse 2.4s ease-in-out .4s infinite; }
.tmd-recbtn{ position:relative;width:84px;height:84px;border-radius:50%;border:none;cursor:pointer;
  background:var(--steel);box-shadow:0 4px 14px rgba(39,76,119,.22);
  display:flex;align-items:center;justify-content:center;transition:background .35s ease,transform .18s ease,box-shadow .35s ease; }
.tmd-recbtn.live{ background:var(--crit);box-shadow:0 8px 24px rgba(192,57,43,.30); }
.tmd-recbtn.press{ animation:tmd-press .4s ease 0.85s; }
.tmd-timer{ margin-top:14px;color:var(--steel);font-weight:600;font-variant-numeric:tabular-nums;
  font-family:var(--font-jetbrains),ui-monospace,monospace;font-size:30px;letter-spacing:1px; }
.tmd-timer.on{ color:var(--crit); }
.tmd-recstatus{ margin-top:10px;font-size:13px;color:var(--muted); }
.tmd-recstatus.live{ display:inline-flex;align-items:center;gap:7px;background:var(--ok-soft);color:var(--ok-strong);
  font-weight:500;padding:4px 12px;border-radius:20px; }
.tmd-okdot{ width:8px;height:8px;border-radius:50%;background:var(--ok);display:block; }
.tmd-wavewrap{ display:flex;align-items:flex-end;justify-content:center;height:56px;margin-top:18px; }
.tmd-wave2{ display:flex;align-items:flex-end;gap:3px;height:56px; }
.tmd-wave2 span{ width:3px;height:50px;border-radius:2px;background:var(--steel-mid);
  transform-origin:bottom;transform:scaleY(.06);will-change:transform; }

/* processing */
.tmd-proccard{ max-width:440px;margin:14px auto 0;background:#fff;border:1px solid var(--line);border-radius:16px;
  padding:42px 24px;display:flex;flex-direction:column;align-items:center;text-align:center; box-shadow:var(--shadow-card); }
.tmd-spin{ width:40px;height:40px;border-radius:50%;border:4px solid var(--line);border-top-color:var(--steel);
  animation:tmd-spin .8s linear infinite; }
.tmd-proct{ margin-top:22px;font-size:16px;font-weight:600;color:var(--steel); }
.tmd-procsub{ margin-top:6px;font-size:12.5px;color:var(--muted); }

/* result — top action bar */
.tmd-result{ display:flex;flex-direction:column;height:100%;min-height:0; }
.tmd-actionbar{ display:flex;align-items:center;gap:10px;margin-bottom:14px; }
.tmd-statusbadge{ display:inline-flex;align-items:center;gap:7px;padding:7px 12px;border-radius:8px;
  font-size:12.5px;font-weight:600;border:none;font-family:inherit;cursor:pointer;
  background:var(--gold-soft);color:var(--gold);transition:background .4s ease,color .4s ease; }
.tmd-statusbadge.ok{ background:var(--ok-soft);color:var(--ok-strong); }
.tmd-exports{ margin-left:auto;display:flex;gap:6px; }
.tmd-expbtn{ display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:500;
  color:var(--muted);border:1px solid var(--line2);background:#fff;padding:6px 10px;border-radius:8px;
  opacity:.5;transition:opacity .45s ease,color .45s ease,border-color .45s ease; }
.tmd-exports.on .tmd-expbtn{ opacity:1;color:var(--steel);border-color:var(--steel-soft); }

/* result — 3-zone */
.tmd-rwrap{ display:grid; grid-template-columns:132px minmax(0,1fr) 202px; gap:14px; flex:1; min-height:0; }
.tmd-rnav{ display:flex;flex-direction:column;gap:2px; }
.tmd-rnav-h{ font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);font-weight:600;margin-bottom:7px;padding-left:10px; }
.tmd-rnavi{ font-size:12px;color:var(--muted);padding:5px 10px;border-left:2px solid transparent;transition:all .3s ease; }
.tmd-rnavi.ind{ padding-left:22px;font-size:11.5px; }
.tmd-rnavi.on{ color:var(--steel);font-weight:600;border-left-color:var(--steel); }
.tmd-rdoc{ background:#fff;border:1px solid var(--line);border-radius:16px;padding:18px 20px;overflow:hidden; box-shadow:var(--shadow-card); }
.tmd-doch{ display:flex;align-items:baseline;justify-content:space-between;margin-bottom:18px; }
.tmd-doctitle{ font-size:21px;font-weight:600;color:var(--ink);letter-spacing:-.01em; }
.tmd-docdate{ font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums; }
.tmd-sec{ margin-bottom:18px; opacity:0; animation:tmd-rf .55s cubic-bezier(.2,.7,.3,1) forwards; }
.tmd-sec:last-child{ margin-bottom:0; }
.tmd-sechead{ display:flex;align-items:center;gap:8px;min-height:22px; }
.tmd-sectick{ width:3px;height:16px;border-radius:99px;background:var(--steel);flex:none; }
.tmd-secico{ color:var(--steel);display:inline-flex;align-items:center; }
.tmd-seclabel{ font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--steel); }
.tmd-sechair{ border-bottom:1px solid var(--hair);margin-top:8px;margin-bottom:9px; }
.tmd-secbody{ font-size:13px;color:var(--ink2);line-height:1.55; }
.tmd-vitals{ font-variant-numeric:tabular-nums; }
.tmd-sublabel{ font-size:10px;font-weight:600;letter-spacing:.5px;text-transform:uppercase;color:var(--muted);margin-bottom:4px; }
.tmd-diagrow{ display:flex;align-items:center;justify-content:space-between;padding:4px 0;font-size:13.5px;color:var(--ink2); }
.tmd-mkb{ display:inline-block;font-size:11px;font-weight:600;font-family:var(--font-jetbrains),ui-monospace,monospace;
  font-variant-numeric:tabular-nums;letter-spacing:.5px;color:var(--steel);background:var(--steel-soft);
  padding:2px 8px;border-radius:5px;min-width:58px;text-align:center; }

/* result — right meds/safety rail */
.tmd-rrail{ display:flex;flex-direction:column;gap:12px; }
.tmd-medcard{ background:#fff;border:1px solid var(--line);border-radius:14px;padding:13px; box-shadow:var(--shadow-card); }
.tmd-medcard-h{ font-size:10px;text-transform:uppercase;letter-spacing:.07em;font-weight:600;color:var(--muted);
  margin-bottom:10px;display:flex;align-items:center;gap:6px; }
.tmd-medcard-h svg{ color:var(--steel); }
.tmd-crit{ display:flex;gap:8px;padding:9px 10px;border-radius:8px;background:var(--crit-soft);color:var(--crit);
  margin-bottom:10px; opacity:0; animation:tmd-al .5s cubic-bezier(.2,.8,.2,1) forwards; }
.tmd-crit-ico{ flex:none;display:inline-flex;animation:tmd-ap 1.1s ease-in-out 3; }
.tmd-crit-badge{ font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em; }
.tmd-crit-msg{ font-size:11.5px;margin-top:2px;line-height:1.4; }
.tmd-crit-act{ font-size:10.5px;margin-top:5px;padding-top:4px;border-top:1px solid rgba(192,57,43,.3);opacity:.92; }
.tmd-medrow{ display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 0;
  border-bottom:1px solid var(--hair);font-size:12.5px; }
.tmd-medrow:last-child{ border-bottom:none; }
.tmd-medname{ font-weight:600;color:var(--ink);display:flex;align-items:center;gap:5px; }
.tmd-meddose{ color:var(--muted);font-size:11px; }
.tmd-medrow.trig{ background:var(--crit-soft);border-radius:7px;border-bottom-color:transparent;margin:0 -6px;padding:7px 6px; }
.tmd-medrow.trig .tmd-medname{ color:var(--crit); }
.tmd-medrow.trig svg{ color:var(--crit); }

/* cursor */
.tmd-cursor{ position:absolute;z-index:30;pointer-events:none;
  transition:left .85s cubic-bezier(.65,0,.2,1),top .85s cubic-bezier(.65,0,.2,1);
  filter:drop-shadow(0 2px 3px rgba(12,33,56,.35)); }
.tmd-cursor.click{ animation:tmd-tap .35s ease 0.85s; }
.tmd-clickr{ position:absolute;left:-8px;top:-6px;width:40px;height:40px;border-radius:50%;
  background:rgba(39,76,119,.18);border:2px solid var(--steel);opacity:0;animation:tmd-clk .65s ease 0.85s; }

@keyframes tmd-spin{ to{transform:rotate(360deg)} }
@keyframes tmd-rf{ from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:translateY(0)} }
@keyframes tmd-al{ from{opacity:0;transform:translateY(12px) scale(.96)} to{opacity:1;transform:translateY(0) scale(1)} }
@keyframes tmd-ap{ 0%,100%{transform:scale(1)} 50%{transform:scale(1.16)} }
@keyframes tmd-tap{ 0%,100%{transform:scale(1)} 45%{transform:scale(.8)} }
@keyframes tmd-press{ 0%,100%{transform:scale(1)} 45%{transform:scale(.86)} }
@keyframes tmd-clk{ 0%{transform:scale(.6);opacity:.8} 100%{transform:scale(1.8);opacity:0} }
@keyframes tmd-pulse{ 0%,100%{transform:scale(1);opacity:.5} 50%{transform:scale(1.06);opacity:.75} }
@keyframes tmd-blink{ 0%{opacity:1} 100%{opacity:.3} }

@media (prefers-reduced-motion: reduce) {
  .tmd-cam, .tmd-cursor { transition: none !important; }
  .tmd-sec, .tmd-crit, .tmd-ring, .tmd-recdot { animation: none !important; opacity: 1 !important; }
}
`;
