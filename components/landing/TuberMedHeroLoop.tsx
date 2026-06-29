'use client';

/**
 * TuberMedHeroLoop — the v2.1 hero loop, ported to a self-contained React component.
 *
 * Zero runtime dependencies beyond React itself (provided by your app).
 *   • No CDN / unpkg / external scripts.
 *   • No Google Fonts request — this component references the font FAMILIES
 *     'Inter', 'Inter Tight' and 'JetBrains Mono' but never loads them. Your
 *     Next.js app must self-host those families (e.g. via next/font/local or
 *     your own @font-face). If a family is missing it falls back to sans-serif.
 *   • All icons are inline SVG; there are no companion asset files.
 *
 * Behaviour:
 *   • Autoplays a seamless ~15.8s loop (hook → patient → record → note →
 *     safety catch → payoff), muted/visual-only.
 *   • Respects prefers-reduced-motion: renders a static final frame
 *     (finished note + safety alert + confirmed banner), no animation.
 *   • Scales responsively to fill its container's width at a fixed 920×648
 *     (≈1.42:1) frame — the "card fills the frame, no border" framing.
 *
 * Usage:
 *   import TuberMedHeroLoop from './TuberMedHeroLoop';
 *   <TuberMedHeroLoop style={{ maxWidth: 920, margin: '0 auto' }} />
 */

import React from 'react';

/* ------------------------------------------------------------------ */
/* Timeline                                                            */
/* ------------------------------------------------------------------ */

type Ease = string;

interface Phase {
  id: string;
  screen: 'newvisit' | 'rec' | 'proc' | 'result';
  dur: number;
  zoom: number;
  fx: number;
  fy: number;
  camDur: number;
  ease: Ease;
  cursor: { x: number; y: number };
  click?: boolean;
}

const GLIDE: Ease = 'cubic-bezier(.6,0,.25,1)';
const SNAP: Ease = 'cubic-bezier(.45,0,.22,1)';
const PUNCH: Ease = 'cubic-bezier(.38,0,.24,1)';

// hero loop re-cut (~15.8s): hook → start → record/listen → note snaps →
// safety catch → payoff.
const PHASES: Phase[] = [
  { id: 'hook',        screen: 'newvisit', dur: 2600, zoom: 1.09, fx: 460, fy: 300, camDur: 1700, ease: GLIDE, cursor: { x: 240, y: 430 } },
  { id: 'patient_cta', screen: 'newvisit', dur: 1500, zoom: 1.16, fx: 300, fy: 300, camDur: 900,  ease: SNAP,  cursor: { x: 312, y: 336 }, click: true },
  { id: 'rec_press',   screen: 'rec',      dur: 1300, zoom: 1.12, fx: 552, fy: 270, camDur: 850,  ease: SNAP,  cursor: { x: 552, y: 255 }, click: true },
  { id: 'listening',   screen: 'rec',      dur: 2600, zoom: 1.20, fx: 552, fy: 300, camDur: 1050, ease: PUNCH, cursor: { x: 600, y: 330 } },
  { id: 'note_snap',   screen: 'result',   dur: 2500, zoom: 1.05, fx: 430, fy: 260, camDur: 900,  ease: GLIDE, cursor: { x: 486, y: 300 } },
  { id: 'climax',      screen: 'result',   dur: 2600, zoom: 1.22, fx: 794, fy: 230, camDur: 1020, ease: PUNCH, cursor: { x: 768, y: 230 } },
  { id: 'payoff',      screen: 'result',   dur: 2700, zoom: 1.00, fx: 460, fy: 300, camDur: 900,  ease: GLIDE, cursor: { x: 768, y: 230 } },
];

const TOTAL = PHASES.reduce((a, p) => a + p.dur, 0);
// cursor travel time before it lands on a target (matches the longest cursor
// transition axis, top .96s) — clicks fire on ARRIVAL, never a fixed early timer.
const CURSOR_TRAVEL = 980;

const STAGE_W = 920;
const STAGE_H = 648;
const CAM_CX = 460; // half of camera viewport width  (920)
const CAM_CY = 292; // half of camera viewport height (584)

/* ------------------------------------------------------------------ */
/* Scoped CSS (keyframes + box-sizing reset). Complete; ends with `).   */
/* ------------------------------------------------------------------ */

const HERO_LOOP_CSS = `
.tmd-hero, .tmd-hero *{box-sizing:border-box;}
@keyframes tmdwave{0%,100%{transform:scaleY(0.14)}50%{transform:scaleY(var(--pk,0.7))}}
@keyframes tmd-spin{to{transform:rotate(360deg)}}
@keyframes tmd-ring{0%{transform:scale(0.75);opacity:0.55}100%{transform:scale(1.7);opacity:0}}
@keyframes tmd-clickr{0%{transform:scale(0.2);opacity:0.5}100%{transform:scale(1.6);opacity:0}}
@keyframes tmd-slam{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
@keyframes tmd-srcin{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}
@keyframes tmd-kin{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
@keyframes tmd-kinblur{0%{opacity:0;transform:translateY(18px)}100%{opacity:1;transform:translateY(0)}}
@keyframes tmd-bgfade{from{opacity:0}to{opacity:1}}
@keyframes tmd-strike{from{transform:scaleX(0)}to{transform:scaleX(1)}}
@keyframes tmd-recdot{0%,100%{opacity:1}50%{opacity:0.25}}
@media (prefers-reduced-motion: reduce){.tmd-hero *{animation:none!important}}
`;

/* ------------------------------------------------------------------ */
/* CSS-string → React style object (keeps the markup 1:1 with the      */
/* original inline styles; custom props like --pk pass through).        */
/* ------------------------------------------------------------------ */

function sx(decls: string): React.CSSProperties {
  const out: Record<string, string> = {};
  for (const part of decls.split(';')) {
    const idx = part.indexOf(':');
    if (idx === -1) continue;
    const rawKey = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (!rawKey || !val) continue;
    const key = rawKey.startsWith('--')
      ? rawKey
      : rawKey.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
    out[key] = val;
  }
  return out as React.CSSProperties;
}

/* ------------------------------------------------------------------ */
/* Waveform bar definitions (speech-like envelope, jittered)           */
/* ------------------------------------------------------------------ */

interface BarDef { pk: string; dur: string; delay: string; dim: boolean; }

function buildBars(): BarDef[] {
  const bars: BarDef[] = [];
  const NB = 46;
  for (let i = 0; i < NB; i++) {
    const t = i / (NB - 1);
    const env =
      0.30 +
      0.34 * Math.abs(Math.sin(t * Math.PI * 3.1 + 0.5)) +
      0.20 * Math.abs(Math.sin(t * Math.PI * 7.9 + 1.4));
    const jitter = 0.82 + Math.random() * 0.32;
    bars.push({
      pk: Math.min(1, env * jitter).toFixed(2),
      dur: (0.42 + Math.random() * 0.5).toFixed(2),
      delay: (-Math.random() * 1.4).toFixed(2),
      dim: i > 38,
    });
  }
  return bars;
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export interface TuberMedHeroLoopProps {
  className?: string;
  style?: React.CSSProperties;
}

interface State {
  idx: number;
  sec: number;
  confirmed: boolean;
  dip: boolean;
  reduced: boolean;
  scale: number;
  procStage: number;
}

export default class TuberMedHeroLoop extends React.Component<TuberMedHeroLoopProps, State> {
  private timers: ReturnType<typeof setTimeout>[] = [];
  private tick: ReturnType<typeof setInterval> | null = null;
  private wrapEl: HTMLDivElement | null = null;
  private ro: ResizeObserver | null = null;
  private bars: BarDef[] = buildBars();

  state: State = {
    idx: 0,
    sec: 0,
    confirmed: false,
    dip: false,
    reduced: false,
    scale: 1,
    procStage: 0,
  };

  componentDidMount() {
    if (typeof window === 'undefined') return;
    this.measure();
    if (typeof ResizeObserver !== 'undefined' && this.wrapEl) {
      this.ro = new ResizeObserver(() => this.measure());
      this.ro.observe(this.wrapEl);
    }
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (mq.matches) {
      this.setState({ reduced: true, confirmed: true });
      return;
    }
    this.play();
  }

  componentWillUnmount() {
    this.clearAll();
    if (this.ro) { this.ro.disconnect(); this.ro = null; }
  }

  private measure = () => {
    if (!this.wrapEl) return;
    const w = this.wrapEl.clientWidth;
    if (w > 0) this.setState({ scale: w / STAGE_W });
  };

  private clearAll() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
    if (this.tick) { clearInterval(this.tick); this.tick = null; }
  }

  private play = () => {
    this.clearAll();
    this.setState({ idx: 0, sec: 0, confirmed: false });
    this.enter(0);
    let t = 0;
    for (let i = 1; i < PHASES.length; i++) {
      t += PHASES[i - 1].dur;
      this.timers.push(setTimeout(() => this.enter(i), t));
    }
    this.timers.push(setTimeout(this.play, TOTAL));
  };

  private enter(i: number) {
    const p = PHASES[i];
    this.setState({ idx: i });
    if (this.tick) { clearInterval(this.tick); this.tick = null; }
    if (p.id === 'listening') {
      this.setState({ sec: 0 });
      this.tick = setInterval(() => this.setState((s) => ({ sec: s.sec + 1 })), 1000);
    }
    this.scheduleClick(p);
  }

  // fire the click on cursor ARRIVAL: cursor dip + button depress, then ease back
  private scheduleClick(p: Phase) {
    this.setState({ dip: false });
    if (!p.click) return;
    this.timers.push(setTimeout(() => this.setState({ dip: true }), CURSOR_TRAVEL));
    this.timers.push(setTimeout(() => this.setState({ dip: false }), CURSOR_TRAVEL + 150));
  }

  private fmt(s: number): string {
    const m = Math.floor(s / 60);
    const ss = s % 60;
    return (m < 10 ? '0' : '') + m + ':' + (ss < 10 ? '0' : '') + ss;
  }

  render() {
    const { reduced, idx, dip, scale, procStage } = this.state;
    const p = PHASES[idx];

    /* ----- resolve the view model (real-time phase OR static reduced) ----- */
    let camTransform: string;
    let camTransition: string;
    let appOpacity: string;
    let crumb: string;
    let opNew: string, opRec: string, opProc: string, opResult: string;
    let showStepper: boolean;
    let recLive: boolean, recIdle: boolean, recScreen: boolean;
    let timer: string, timerColor: string, recBtnBg: string, recBtnShadow: string;
    let noteOp: string, noteTf: string, docFocus: string;
    let alert: boolean, confirmed: boolean;
    let hookMounted: boolean, hookOpacity: string, overlayPayoff: boolean;
    let showCursor: boolean;
    let cursorX = 0, cursorY = 0, cursorScale = 1;
    let pressedTarget: string | null = null;
    const screen = p.screen;
    const id = p.id;

    if (reduced) {
      camTransform = 'translate(0px,0px) scale(1)';
      camTransition = 'none';
      appOpacity = '1';
      crumb = 'Преглед › Амбулаторен лист (чернова)';
      opNew = '0'; opRec = '0'; opProc = '0'; opResult = '1';
      showStepper = false;
      recLive = false; recIdle = false; recScreen = false;
      timer = '00:00'; timerColor = '#C2CAD4'; recBtnBg = '#274C77'; recBtnShadow = 'rgba(39,76,119,.5)';
      noteOp = '1'; noteTf = 'none'; docFocus = 'none';
      alert = true; confirmed = true;
      hookMounted = false; hookOpacity = '0'; overlayPayoff = false;
      showCursor = false;
    } else {
      const z = p.zoom;
      const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
      const fx = clamp(p.fx, CAM_CX / z, 2 * CAM_CX - CAM_CX / z);
      const fy = clamp(p.fy, CAM_CY / z, 2 * CAM_CY - CAM_CY / z);
      camTransform = `translate(${(CAM_CX - z * fx).toFixed(1)}px, ${(CAM_CY - z * fy).toFixed(1)}px) scale(${z})`;
      camTransition = `transform ${p.camDur}ms ${p.ease}, opacity .35s ease`;

      const onResult = screen === 'result';
      const overlayActive = id === 'hook' || id === 'payoff';
      recLive = id === 'listening';
      recIdle = id === 'rec_press';
      recScreen = screen === 'rec';
      alert = id === 'climax';
      confirmed = this.state.confirmed;

      appOpacity = overlayActive ? '0' : '1';
      crumb =
        screen === 'newvisit' ? 'Нов преглед › Данни на пациента'
        : onResult ? 'Преглед › Амбулаторен лист (чернова)'
        : screen === 'proc' ? 'Нов преглед › AI обработка'
        : 'Нов преглед › Запис на консултацията';
      opNew = screen === 'newvisit' ? '1' : '0';
      opRec = screen === 'rec' ? '1' : '0';
      opProc = screen === 'proc' ? '1' : '0';
      opResult = onResult ? '1' : '0';
      showStepper = screen !== 'result';
      timer = this.fmt(recLive ? this.state.sec : 0);
      timerColor = recLive ? '#274C77' : '#C2CAD4';
      recBtnBg = recLive ? '#C0392B' : '#274C77';
      recBtnShadow = recLive ? 'rgba(192,57,43,.5)' : 'rgba(39,76,119,.5)';
      noteOp = onResult ? '1' : '0';
      noteTf = onResult ? 'none' : 'translateY(10px)';
      docFocus = id === 'climax' ? 'blur(2.5px) opacity(0.5)' : 'none';
      hookMounted = id === 'hook' || id === 'patient_cta';
      hookOpacity = id === 'hook' ? '1' : '0';
      overlayPayoff = id === 'payoff';

      showCursor = !overlayActive;
      cursorX = p.cursor.x; cursorY = p.cursor.y;
      cursorScale = dip ? 0.8 : 1;
      pressedTarget = dip && p.click ? id : null;
    }

    const notConfirmed = !confirmed;

    /* ----- stepper ----- */
    const stepCur = screen === 'newvisit' ? 0 : screen === 'rec' ? 1 : screen === 'proc' ? 2 : 3;
    const stepDefs = ['Вход · Пациент', 'Запис · Консултация', 'Обработка · AI анализ', 'Резултат · Документ'];
    const steps = stepDefs.map((label, k) => {
      const past = k < stepCur;
      const on = k === stepCur;
      const active = past || on;
      return {
        label, num: k + 1, showLine: k < 3, showCheck: past, showNum: !past,
        circleStyle:
          'width:22px;height:22px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex:none;' +
          (active ? 'background:#274C77;color:#fff;' : 'background:#E7ECF2;color:#8893A1;'),
        labelStyle:
          `font-size:12px;font-weight:${on ? '600' : '500'};color:${on ? '#274C77' : past ? '#33414F' : '#8893A1'};white-space:nowrap;`,
      };
    });

    /* ----- processing pipeline (kept for fidelity; never visible in the loop) ----- */
    const procLabels = ['Транскрибиране…', 'Структуриране…', 'Проверка за безопасност…'];
    const procSteps = procLabels.map((label, k) => ({
      label,
      rowStyle:
        `display:flex;align-items:center;gap:11px;font-size:14px;font-family:var(--font-inter,'Inter'),sans-serif;transition:opacity .3s ease;` +
        (k <= procStage ? 'opacity:1;' : 'opacity:0.4;') +
        (k === procStage ? 'color:#274C77;font-weight:600;' : k < procStage ? 'color:#33414F;font-weight:500;' : 'color:#8893A1;font-weight:500;'),
      showDone: k < procStage,
      showSpin: k === procStage,
      showWait: k > procStage,
    }));

    /* ----- waveform ----- */
    const wave = this.bars.map((b, k) => (
      <span
        key={k}
        style={
          recLive
            ? ({
                width: '4px', height: '100%', borderRadius: '2px', flex: 'none',
                background: '#4F8FBF', transformOrigin: 'center',
                '--pk': b.pk, transform: `scaleY(${b.pk})`,
                animation: `tmdwave ${b.dur}s ease-in-out ${b.delay}s infinite`,
                opacity: b.dim ? 0.4 : 1,
              } as React.CSSProperties)
            : {
                width: '4px', height: '100%', borderRadius: '2px', flex: 'none',
                background: '#C2CAD4', transformOrigin: 'center',
                transform: 'scaleY(0.1)', opacity: 0.7,
              }
        }
      />
    ));

    /* ----- cursor ----- */
    const cursorEl = showCursor ? (
      <div
        style={{
          position: 'absolute', left: cursorX + 'px', top: cursorY + 'px',
          opacity: 1,
          transform: `translate(-3px,-2px) scale(${cursorScale})`,
          transition: 'left .82s cubic-bezier(.34,0,.26,1), top .96s cubic-bezier(.5,0,.22,1), opacity .45s ease, transform .14s ease',
          zIndex: 30, pointerEvents: 'none',
        }}
      >
        <svg viewBox="0 0 24 24" width={22} height={22}>
          <path d="M4 2 L4 20 L9 15 L12.5 22 L15.5 20.5 L12 13.5 L19 13 Z" fill="#0c2138" stroke="#fff" strokeWidth={1.4} strokeLinejoin="round" />
        </svg>
      </div>
    ) : null;

    const ctaPress = pressedTarget === 'patient_cta' ? 'transform:scale(0.95);filter:brightness(0.9);' : '';
    const recPress = pressedTarget === 'rec_press' ? 'transform:scale(0.95);filter:brightness(0.9);' : '';

    /* ================================================================ */
    /* Render                                                           */
    /* ================================================================ */
    return (
      <div
        ref={(el) => { this.wrapEl = el; }}
        className={`tmd-hero${this.props.className ? ' ' + this.props.className : ''}`}
        style={{
          position: 'relative',
          width: '100%',
          aspectRatio: `${STAGE_W} / ${STAGE_H}`,
          overflow: 'hidden',
          background: '#EEF1F5',
          ...(this.props.style || {}),
        }}
      >
        <style dangerouslySetInnerHTML={{ __html: HERO_LOOP_CSS }} />

        {/* fixed-size stage, scaled to fill the container width */}
        <div
          style={{
            position: 'absolute', top: 0, left: 0,
            width: STAGE_W, height: STAGE_H,
            transformOrigin: 'top left',
            transform: `scale(${scale})`,
            fontFamily: "'Inter', sans-serif",
          }}
        >
          {/* browser frame */}
          <div style={sx('position:absolute;left:0px;top:0px;width:920px;height:648px;background:#fff;border-radius:0;overflow:hidden;')}>

            {/* chrome: Google Chrome on Windows */}
            <div style={sx('flex:none;')}>
              {/* tab strip + window controls */}
              <div style={sx('height:36px;background:#DEE1E6;display:flex;align-items:flex-end;padding-left:9px;')}>
                <div style={sx('display:flex;align-items:center;gap:9px;height:30px;background:#fff;border-radius:9px 9px 0 0;padding:0 11px;width:226px;flex:none;')}>
                  <svg width="15" height="15" viewBox="0 0 56 56" fill="none" style={sx('flex:none;')}>
                    <defs><linearGradient id="ftg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#2E5A8F" /><stop offset="1" stopColor="#1D3B5C" /></linearGradient></defs>
                    <rect x="4" y="4" width="48" height="48" rx="14" fill="url(#ftg)" />
                    <g transform="translate(4 4)"><g stroke="#fff" strokeWidth="7" strokeLinecap="round"><path d="M12 16 H36" /><path d="M24 16 V36" /></g><path d="M12 26 H22" stroke="#8FC0E8" strokeWidth="7" strokeLinecap="round" /></g>
                  </svg>
                  <span style={sx('flex:1;font-size:12px;color:#3c4043;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;')}>TuberMed — медицински скрайб</span>
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="#5f6368" strokeWidth="2" strokeLinecap="round" style={sx('flex:none;')}><path d="M6 6l12 12M18 6L6 18" /></svg>
                </div>
                <div style={sx('display:flex;align-items:center;justify-content:center;width:26px;height:26px;margin:0 0 3px 7px;border-radius:50%;flex:none;')}>
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#5f6368" strokeWidth="2" strokeLinecap="round"><path d="M5 12h14" /><path d="M12 5v14" /></svg>
                </div>
                <div style={sx('flex:1;')} />
                <div style={sx('display:flex;align-items:stretch;height:36px;flex:none;')}>
                  <div style={sx('width:46px;display:flex;align-items:center;justify-content:center;')}><svg width="11" height="11" viewBox="0 0 11 11" stroke="#3c4043" strokeWidth="1"><line x1="1" y1="6" x2="10" y2="6" /></svg></div>
                  <div style={sx('width:46px;display:flex;align-items:center;justify-content:center;')}><svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="#3c4043" strokeWidth="1"><rect x="1.5" y="1.5" width="8" height="8" /></svg></div>
                  <div style={sx('width:46px;display:flex;align-items:center;justify-content:center;')}><svg width="11" height="11" viewBox="0 0 11 11" stroke="#3c4043" strokeWidth="1.1" strokeLinecap="round"><line x1="1.5" y1="1.5" x2="9.5" y2="9.5" /><line x1="9.5" y1="1.5" x2="1.5" y2="9.5" /></svg></div>
                </div>
              </div>
              {/* toolbar */}
              <div style={sx('height:28px;background:#fff;border-bottom:1px solid #DCE1E8;display:flex;align-items:center;gap:8px;padding:0 11px;')}>
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#5f6368" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={sx('flex:none;')}><path d="M19 12H5" /><path d="m12 19-7-7 7-7" /></svg>
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#c4c8cd" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={sx('flex:none;')}><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></svg>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#5f6368" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={sx('flex:none;')}><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" /></svg>
                <div style={sx("flex:1;display:flex;align-items:center;gap:8px;height:20px;background:#F1F3F4;border-radius:11px;padding:0 12px;font-size:11.5px;color:#3c4043;font-family:var(--font-jetbrains,'JetBrains Mono'),monospace;")}>
                  <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="#5f6368" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={sx('flex:none;')}><rect width="18" height="11" x="3" y="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                  app.tubermed.com
                </div>
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#5f6368" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" style={sx('flex:none;')}><circle cx="12" cy="12" r="1" /><circle cx="12" cy="5" r="1" /><circle cx="12" cy="19" r="1" /></svg>
              </div>
            </div>

            {/* camera viewport */}
            <div style={sx('position:relative;width:920px;height:584px;overflow:hidden;background:#F3F5F8;')}>
              <div style={sx(`position:absolute;top:0;left:0;width:920px;height:584px;will-change:transform;transform:${camTransform};opacity:${appOpacity};transition:${camTransition};`)}>

                {/* ============ APP (920 x 584) ============ */}
                <div style={sx('position:absolute;inset:0;display:flex;')}>

                  {/* sidebar */}
                  <aside style={sx('width:184px;flex:none;background:#16273F;display:flex;flex-direction:column;padding:16px 12px;color:#AAB6C6;')}>
                    <div style={sx('display:flex;align-items:center;gap:9px;padding:2px 4px 16px;')}>
                      <svg width="26" height="26" viewBox="0 0 56 56" fill="none">
                        <defs><linearGradient id="tg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#2E5A8F" /><stop offset="1" stopColor="#1D3B5C" /></linearGradient></defs>
                        <rect x="4" y="4" width="48" height="48" rx="13" fill="url(#tg)" />
                        <g transform="translate(4 4)"><g stroke="#fff" strokeWidth="6" strokeLinecap="round"><path d="M12 16 H36" /><path d="M24 16 V36" /></g><path d="M12 26 H22" stroke="#8FC0E8" strokeWidth="6" strokeLinecap="round" /></g>
                      </svg>
                      <div style={sx('line-height:1.05;')}>
                        <div style={sx("font-family:var(--font-inter-tight,'Inter Tight'),sans-serif;font-weight:700;font-size:16px;letter-spacing:-0.03em;")}><span style={sx('color:#fff;')}>Tuber</span><span style={sx('color:#8FC0E8;')}>Med</span></div>
                        <div style={sx('font-size:9.5px;color:#7E8DA3;letter-spacing:0.04em;margin-top:1px;')}>медицински скрайб</div>
                      </div>
                    </div>
                    <div style={sx('display:flex;align-items:center;gap:9px;background:#274C77;color:#fff;font-weight:600;font-size:13px;border-radius:9px;padding:10px 11px;margin-bottom:5px;')}>
                      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M5 12h14" /><path d="M12 5v14" /></svg> Нов преглед
                    </div>
                    <div style={sx('display:flex;align-items:center;gap:9px;font-size:13px;padding:9px 11px;color:#AAB6C6;')}>
                      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg> Пациенти
                    </div>
                    <div style={sx('display:flex;align-items:center;gap:9px;font-size:13px;padding:9px 11px;color:#AAB6C6;')}>
                      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></svg> Транскрипти
                    </div>
                    <div style={sx('display:flex;align-items:center;gap:9px;font-size:13px;padding:9px 11px;color:#AAB6C6;')}>
                      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg> Настройки
                    </div>
                    <div style={sx('flex:1;')} />
                    <div style={sx('display:flex;align-items:center;gap:9px;padding:9px 8px;border-top:1px solid #243954;')}>
                      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#8FC0E8" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" /></svg>
                      <div style={sx('line-height:1.15;')}>
                        <div style={sx('font-size:11px;font-weight:600;color:#D7E0EC;')}>Обработка в ЕС</div>
                        <div style={sx('font-size:9.5px;color:#7E8DA3;')}>Frankfurt · GDPR</div>
                      </div>
                    </div>
                  </aside>

                  {/* main */}
                  <main style={sx('flex:1;display:flex;flex-direction:column;min-width:0;background:#F3F5F8;')}>
                    {/* header */}
                    <div style={sx('height:46px;flex:none;display:flex;align-items:center;justify-content:space-between;padding:0 22px;background:#fff;border-bottom:1px solid #E7ECF2;')}>
                      <div style={sx('font-size:13px;color:#586472;')}>{crumb}</div>
                      <div style={sx('display:flex;align-items:center;gap:7px;font-size:12.5px;color:#33414F;font-weight:500;')}>
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#586472" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg> Д-р Иванова
                      </div>
                    </div>

                    {/* stepper */}
                    {showStepper && (
                      <div style={sx('height:50px;flex:none;display:flex;align-items:center;gap:10px;padding:0 22px;background:#fff;border-bottom:1px solid #E7ECF2;')}>
                        {steps.map((st, k) => (
                          <React.Fragment key={k}>
                            <div style={sx('display:flex;align-items:center;gap:8px;')}>
                              <span style={sx(st.circleStyle)}>
                                {st.showCheck && (<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>)}
                                {st.showNum && st.num}
                              </span>
                              <span style={sx(st.labelStyle)}>{st.label}</span>
                            </div>
                            {st.showLine && (<span style={sx('width:34px;height:1px;background:#DCE1E8;')} />)}
                          </React.Fragment>
                        ))}
                      </div>
                    )}

                    {/* content stack */}
                    <div style={sx('position:relative;flex:1;min-height:0;')}>

                      {/* ============ NEW VISIT ============ */}
                      <div style={sx(`position:absolute;inset:0;opacity:${opNew};transition:opacity .55s ease;pointer-events:none;overflow:hidden;`)}>
                        <div style={sx('display:flex;flex-direction:column;gap:16px;padding:34px 34px;height:100%;max-width:600px;')}>
                          <div style={sx('background:#fff;border:1px solid #E7ECF2;border-radius:14px;padding:22px 24px;box-shadow:0 1px 2px rgba(20,39,64,.04);')}>
                            <div style={sx('font-size:11px;font-weight:700;letter-spacing:0.08em;color:#274C77;text-transform:uppercase;margin-bottom:14px;')}>Пациент</div>
                            <div style={sx("font-size:23px;font-weight:700;color:#142740;font-family:var(--font-inter-tight,'Inter Tight'),sans-serif;letter-spacing:-0.015em;line-height:1.1;")}>Мария Петрова</div>
                            <div style={sx('font-size:13.5px;color:#586472;margin-top:4px;')}>жена · 67 г.</div>
                            <div style={sx('display:flex;align-items:center;gap:10px;margin-top:18px;')}>
                              <span style={sx('font-size:10.5px;font-weight:700;letter-spacing:0.06em;color:#8893A1;text-transform:uppercase;')}>Хронична терапия</span>
                              <span style={sx('display:inline-flex;align-items:center;gap:7px;color:#B7791F;font-weight:700;font-size:14.5px;background:#F7EDDA;padding:6px 14px;border-radius:9px;')}><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#B7791F" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z" /><path d="m8.5 8.5 7 7" /></svg> Варфарин</span>
                            </div>
                          </div>
                          <div style={sx("margin-top:2px;align-self:flex-start;white-space:nowrap;display:flex;align-items:center;gap:10px;background:#274C77;color:#fff;font-size:15.5px;font-weight:600;border-radius:11px;padding:15px 28px;box-shadow:0 6px 16px -6px rgba(39,76,119,.5);transition:transform .14s cubic-bezier(.3,0,.3,1),filter .14s ease;" + ctaPress)}>
                            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" x2="12" y1="19" y2="22" /></svg>
                            Започни запис
                          </div>
                        </div>
                      </div>

                      {/* ============ RECORDING ============ */}
                      <div style={sx(`position:absolute;inset:0;opacity:${opRec};transition:opacity .55s ease;pointer-events:none;display:flex;align-items:flex-start;justify-content:center;padding:26px 22px;overflow:hidden;`)}>
                        <div style={sx('width:520px;max-width:100%;background:#fff;border:1px solid #E7ECF2;border-radius:16px;padding:26px 26px 30px;box-shadow:0 1px 2px rgba(20,39,64,.04),0 10px 30px -16px rgba(20,39,64,.18);text-align:center;')}>
                          <div style={sx("font-size:19px;font-weight:700;color:#274C77;font-family:var(--font-inter-tight,'Inter Tight'),sans-serif;letter-spacing:-0.01em;")}>Запис на консултацията</div>
                          <div style={sx('position:relative;width:118px;height:118px;margin:30px auto 0;display:flex;align-items:center;justify-content:center;')}>
                            {recLive && (
                              <>
                                <span style={sx('position:absolute;inset:0;border-radius:50%;background:#C0392B;opacity:0.18;animation:tmd-ring 1.8s ease-out infinite;')} />
                                <span style={sx('position:absolute;inset:0;border-radius:50%;background:#C0392B;opacity:0.18;animation:tmd-ring 1.8s ease-out 0.9s infinite;')} />
                              </>
                            )}
                            <div style={sx(`position:relative;width:84px;height:84px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:${recBtnBg};box-shadow:0 8px 22px -8px ${recBtnShadow};transition:transform .14s cubic-bezier(.3,0,.3,1),filter .14s ease;` + recPress)}>
                              {recLive && (<svg viewBox="0 0 24 24" width="26" height="26" fill="#fff"><rect x="7" y="7" width="10" height="10" rx="2" /></svg>)}
                              {recIdle && (<svg viewBox="0 0 24 24" width="30" height="30" fill="#fff"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11Z" /></svg>)}
                            </div>
                          </div>
                          <div style={sx(`font-family:var(--font-jetbrains,'JetBrains Mono'),monospace;font-variant-numeric:tabular-nums;font-size:34px;font-weight:700;color:${timerColor};margin-top:16px;letter-spacing:0.04em;`)}>{timer}</div>
                          {recLive && (
                            <div style={sx('display:inline-flex;align-items:center;gap:7px;margin-top:8px;font-size:12.5px;font-weight:600;color:#1B6B46;background:#E3F0EA;border-radius:999px;padding:5px 14px;')}><span style={sx('width:8px;height:8px;border-radius:50%;background:#2E7D5B;animation:tmd-recdot 1.2s ease-in-out infinite;')} /> На запис · AI слуша</div>
                          )}
                          {recIdle && (<div style={sx('margin-top:8px;font-size:12.5px;color:#8893A1;')}>Натиснете за запис</div>)}
                          {recScreen && (
                            <div style={sx('display:flex;align-items:flex-end;justify-content:center;gap:3px;height:56px;margin-top:22px;')}>{wave}</div>
                          )}
                        </div>
                      </div>

                      {/* ============ PROCESSING (cut from the loop; opacity 0) ============ */}
                      <div style={sx(`position:absolute;inset:0;opacity:${opProc};transition:opacity .55s ease;pointer-events:none;display:flex;align-items:flex-start;justify-content:center;padding:60px 22px;overflow:hidden;`)}>
                        <div style={sx('width:460px;background:#fff;border:1px solid #E7ECF2;border-radius:16px;padding:34px 38px;box-shadow:0 1px 2px rgba(20,39,64,.04),0 10px 30px -16px rgba(20,39,64,.18);')}>
                          <div style={sx('display:flex;align-items:center;gap:10px;')}>
                            <span style={sx('display:inline-block;width:9px;height:9px;border-radius:50%;background:#274C77;animation:tmd-recdot 1.4s ease-in-out infinite;')} />
                            <div style={sx("font-size:17px;font-weight:700;color:#274C77;font-family:var(--font-inter-tight,'Inter Tight'),sans-serif;")}>AI обработва консултацията</div>
                          </div>
                          <div style={sx('display:flex;flex-direction:column;gap:15px;margin-top:24px;')}>
                            {procSteps.map((ps, k) => (
                              <div key={k} style={sx(ps.rowStyle)}>
                                <span style={sx('width:22px;height:22px;flex:none;display:inline-flex;align-items:center;justify-content:center;')}>
                                  {ps.showDone && (<span style={sx('width:22px;height:22px;border-radius:50%;background:#E3F0EA;color:#1B6B46;display:inline-flex;align-items:center;justify-content:center;')}><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg></span>)}
                                  {ps.showSpin && (<span style={sx('width:18px;height:18px;border-radius:50%;border:2.4px solid #D5E0EF;border-top-color:#274C77;animation:tmd-spin .75s linear infinite;')} />)}
                                  {ps.showWait && (<span style={sx('width:7px;height:7px;border-radius:50%;background:#C2CAD4;')} />)}
                                </span>
                                {ps.label}
                              </div>
                            ))}
                          </div>
                          <div style={sx("margin-top:26px;padding-top:16px;border-top:1px solid #EEF2F7;font-size:12px;color:#8893A1;font-family:var(--font-inter,'Inter'),sans-serif;")}>Обикновено ~15–30 сек · данните не напускат ЕС</div>
                        </div>
                      </div>

                      {/* ============ RESULT ============ */}
                      <div style={sx(`position:absolute;inset:0;opacity:${opResult};transition:opacity .55s ease;pointer-events:none;overflow:hidden;display:flex;flex-direction:column;`)}>
                        {/* banner */}
                        <div style={sx(`flex:none;padding:12px 22px 0;filter:${docFocus};transition:filter .55s ease;`)}>
                          {notConfirmed && (
                            <div style={sx('display:flex;align-items:center;justify-content:space-between;gap:14px;background:#F7EDDA;border:1px solid #E8D6AE;border-radius:10px;padding:10px 14px;')}>
                              <div style={sx('display:flex;align-items:center;gap:10px;min-width:0;')}>
                                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#B7791F" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" style={sx('flex:none;')}><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" /><path d="M12 9v4" /><path d="M12 17h.01" /></svg>
                                <div style={sx('line-height:1.25;min-width:0;')}><div style={sx('font-size:12.5px;font-weight:700;color:#8A5A12;')}>AI чернова — прегледайте преди подпис.</div><div style={sx('font-size:11px;color:#A07B3A;')}>Лекарят остава авторът.</div></div>
                              </div>
                              <div style={sx('display:flex;align-items:center;gap:7px;flex:none;')}>
                                <span style={sx('display:flex;align-items:center;gap:5px;font-size:11.5px;color:#9aa7b4;border:1px solid #DCE1E8;border-radius:7px;padding:6px 10px;background:#fff;')}><svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect width="18" height="11" x="3" y="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg> PDF</span>
                                <span style={sx('display:flex;align-items:center;gap:5px;font-size:11.5px;color:#9aa7b4;border:1px solid #DCE1E8;border-radius:7px;padding:6px 10px;background:#fff;')}><svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect width="18" height="11" x="3" y="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg> Печат</span>
                                <span style={sx('display:flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600;color:#fff;background:#2E7D5B;border-radius:8px;padding:7px 16px;box-shadow:0 4px 12px -5px rgba(46,125,91,.6);transition:transform .14s cubic-bezier(.3,0,.3,1),filter .14s ease;')}><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg> Потвърди</span>
                              </div>
                            </div>
                          )}
                          {confirmed && (
                            <div style={sx('display:flex;align-items:center;justify-content:space-between;gap:14px;background:#E3F0EA;border:1px solid #BFE0CD;border-radius:10px;padding:10px 14px;animation:tmd-srcin .4s ease;')}>
                              <div style={sx('display:flex;align-items:center;gap:10px;')}>
                                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#1B6B46" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={sx('flex:none;')}><path d="M20 6 9 17l-5-5" /></svg>
                                <div style={sx('font-size:12.5px;font-weight:700;color:#1B6B46;')}>Потвърдено от лекар · готово за износ</div>
                              </div>
                              <div style={sx('display:flex;align-items:center;gap:7px;')}>
                                <span style={sx('display:flex;align-items:center;gap:5px;font-size:11.5px;color:#274C77;font-weight:600;border:1px solid #C7D7E8;border-radius:7px;padding:6px 10px;background:#fff;')}><svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" x2="12" y1="15" y2="3" /></svg> PDF</span>
                                <span style={sx('font-size:11.5px;font-weight:700;color:#274C77;background:#EAF1F8;border-radius:7px;padding:6px 11px;')}>→ НЗИС · в практиката</span>
                              </div>
                            </div>
                          )}
                        </div>

                        {/* 3-col */}
                        <div style={sx('flex:1;min-height:0;display:flex;gap:16px;padding:14px 22px 18px;')}>
                          {/* section nav */}
                          <div style={sx(`width:148px;flex:none;filter:${docFocus};transition:filter .55s ease;`)}>
                            <div style={sx('font-size:10px;font-weight:700;letter-spacing:0.08em;color:#8893A1;text-transform:uppercase;margin-bottom:9px;padding-left:2px;')}>Раздели</div>
                            <div style={sx('font-size:12.5px;color:#274C77;font-weight:600;border-left:2px solid #274C77;padding:5px 0 5px 10px;margin-bottom:1px;')}>Диагнози · МКБ-10</div>
                            <div style={sx('font-size:12.5px;color:#586472;padding:5px 0 5px 12px;')}>Анамнеза</div>
                            <div style={sx('font-size:12.5px;color:#586472;padding:5px 0 5px 12px;')}>Обективен статус</div>
                            <div style={sx('font-size:12.5px;color:#586472;padding:5px 0 5px 12px;')}>Терапия</div>
                            <div style={sx('font-size:12.5px;color:#586472;padding:5px 0 5px 12px;')}>Изследвания</div>
                          </div>

                          {/* document */}
                          <div style={sx(`flex:1;min-width:0;background:#fff;border:1px solid #E7ECF2;border-radius:14px;padding:20px 24px;box-shadow:0 1px 2px rgba(20,39,64,.04);overflow:hidden;filter:${docFocus};transition:filter .55s ease;`)}>
                            <div style={sx('display:flex;align-items:baseline;justify-content:space-between;margin-bottom:4px;')}>
                              <div style={sx("font-size:27px;font-weight:700;color:#142740;font-family:var(--font-inter-tight,'Inter Tight'),sans-serif;letter-spacing:-0.015em;line-height:1.1;")}>Амбулаторен лист</div>
                              <div style={sx("font-size:12px;color:#8893A1;font-family:var(--font-jetbrains,'JetBrains Mono'),monospace;")}>21.06.2026</div>
                            </div>
                            <div style={sx('font-size:12px;color:#8893A1;margin-bottom:18px;')}>Пациент · жена · 67 г. · НРД Приложение №3</div>

                            {/* ДИАГНОЗИ */}
                            <div style={sx(`opacity:${noteOp};transform:${noteTf};transition:opacity .5s ease,transform .5s ease;transition-delay:0ms;margin-bottom:16px;`)}>
                              <div style={sx('display:flex;align-items:center;gap:8px;')}><span style={sx('width:3px;height:15px;border-radius:99px;background:#274C77;')} /><span style={sx('color:#274C77;display:inline-flex;')}><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect width="8" height="4" x="8" y="2" rx="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /></svg></span><span style={sx('font-size:13px;font-weight:700;letter-spacing:0.07em;color:#274C77;text-transform:uppercase;')}>Диагнози · МКБ-10</span></div>
                              <div style={sx('border-bottom:1px solid #E7ECF2;margin:8px 0 10px;')} />
                              <div style={sx('font-size:10.5px;font-weight:600;letter-spacing:0.04em;color:#8893A1;text-transform:uppercase;margin-bottom:6px;')}>Основна диагноза</div>
                              <div style={sx('display:flex;align-items:center;justify-content:space-between;gap:12px;')}><span style={sx('display:flex;align-items:center;gap:8px;font-size:14px;color:#1C2733;')}><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#2E7D5B" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg> Предсърдно мъждене</span><span style={sx("font-family:var(--font-jetbrains,'JetBrains Mono'),monospace;font-size:12px;font-weight:600;color:#fff;background:#274C77;border-radius:6px;padding:3px 10px;")}>I48.0</span></div>
                            </div>

                            {/* АНАМНЕЗА */}
                            <div style={sx(`opacity:${noteOp};transform:${noteTf};transition:opacity .5s ease,transform .5s ease;transition-delay:170ms;margin-bottom:16px;`)}>
                              <div style={sx('display:flex;align-items:center;gap:8px;')}><span style={sx('width:3px;height:15px;border-radius:99px;background:#274C77;')} /><span style={sx('color:#274C77;display:inline-flex;')}><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /><path d="M16 13H8" /><path d="M16 17H8" /></svg></span><span style={sx('font-size:13px;font-weight:700;letter-spacing:0.07em;color:#274C77;text-transform:uppercase;')}>Анамнеза</span></div>
                              <div style={sx('border-bottom:1px solid #E7ECF2;margin:8px 0 10px;')} />
                              <div style={sx('display:flex;flex-direction:column;gap:8px;')}><span style={sx('height:8px;width:97%;border-radius:4px;background:#E4E9F0;')} /><span style={sx('height:8px;width:71%;border-radius:4px;background:#E4E9F0;')} /></div>
                            </div>

                            {/* ОБЕКТИВЕН СТАТУС */}
                            <div style={sx(`opacity:${noteOp};transform:${noteTf};transition:opacity .5s ease,transform .5s ease;transition-delay:340ms;margin-bottom:16px;`)}>
                              <div style={sx('display:flex;align-items:center;gap:8px;')}><span style={sx('width:3px;height:15px;border-radius:99px;background:#274C77;')} /><span style={sx('color:#274C77;display:inline-flex;')}><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4.8 2.3A.3.3 0 1 0 5 2H4a2 2 0 0 0-2 2v5a6 6 0 0 0 12 0V4a2 2 0 0 0-2-2h-1a.2.2 0 1 0 .3.3" /><path d="M8 15v1a6 6 0 0 0 12 0v-4" /><circle cx="20" cy="10" r="2" /></svg></span><span style={sx('font-size:13px;font-weight:700;letter-spacing:0.07em;color:#274C77;text-transform:uppercase;')}>Обективен статус</span></div>
                              <div style={sx('border-bottom:1px solid #E7ECF2;margin:8px 0 10px;')} />
                              <div style={sx('display:flex;flex-direction:column;gap:8px;')}><span style={sx('height:8px;width:85%;border-radius:4px;background:#E4E9F0;')} /></div>
                            </div>

                            {/* ТЕРАПИЯ */}
                            <div style={sx(`opacity:${noteOp};transform:${noteTf};transition:opacity .5s ease,transform .5s ease;transition-delay:510ms;`)}>
                              <div style={sx('display:flex;align-items:center;gap:8px;')}><span style={sx('width:3px;height:15px;border-radius:99px;background:#274C77;')} /><span style={sx('color:#274C77;display:inline-flex;')}><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z" /><path d="m8.5 8.5 7 7" /></svg></span><span style={sx('font-size:13px;font-weight:700;letter-spacing:0.07em;color:#274C77;text-transform:uppercase;')}>Терапия</span></div>
                              <div style={sx('border-bottom:1px solid #E7ECF2;margin:8px 0 10px;')} />
                              <div style={sx('display:flex;align-items:center;gap:14px;font-size:13.5px;color:#1C2733;padding:2px 0;')}><span style={sx('min-width:96px;font-weight:500;')}>Варфарин</span><span style={sx("font-family:var(--font-jetbrains,'JetBrains Mono'),monospace;font-weight:600;min-width:48px;")}>5 mg</span><span style={sx('color:#586472;')}>1×/дн вечер</span></div>
                              <div style={sx('display:flex;align-items:center;gap:14px;font-size:13.5px;color:#1C2733;padding:2px 0;')}><span style={sx('min-width:96px;font-weight:500;')}>Бисопролол</span><span style={sx("font-family:var(--font-jetbrains,'JetBrains Mono'),monospace;font-weight:600;min-width:48px;")}>2.5 mg</span><span style={sx('color:#586472;')}>1×/дн сутрин</span></div>
                            </div>
                          </div>

                          {/* meds + safety rail */}
                          <div style={sx('width:208px;flex:none;background:#fff;border:1px solid #E7ECF2;border-radius:14px;padding:14px;box-shadow:0 1px 2px rgba(20,39,64,.04);align-self:flex-start;')}>
                            <div style={sx('display:flex;align-items:center;gap:7px;font-size:12px;font-weight:700;color:#274C77;')}><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" /></svg> Медикаментозна безопасност</div>
                            <div style={sx('font-size:10.5px;color:#8893A1;margin:3px 0 12px;')}>Втора проверка</div>
                            {alert && (
                              <div style={sx('background:#F6E4E1;border:1px solid #E3B4AC;border-radius:11px;padding:11px;margin-bottom:11px;animation:tmd-slam .6s cubic-bezier(.4,0,.2,1);')}>
                                <div style={sx('display:flex;align-items:center;gap:6px;margin-bottom:6px;')}><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#C0392B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={sx('flex:none;')}><polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86" /><line x1="12" x2="12" y1="8" y2="12" /><line x1="12" x2="12.01" y1="16" y2="16" /></svg><span style={sx('font-size:11px;font-weight:800;letter-spacing:0.04em;color:#C0392B;text-transform:uppercase;')}>Критично · взаимодействие</span></div>
                                <div style={sx('font-size:13px;color:#1C2733;line-height:1.4;')}><b style={sx('color:#C0392B;')}>Варфарин × НСПВС</b> — повишен риск от кървене.</div>
                                <div style={sx('display:flex;align-items:center;gap:4px;font-size:10.5px;font-weight:600;color:#9a3636;margin-top:7px;')}><svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg> виж източника</div>
                              </div>
                            )}
                            <div style={sx('display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-top:1px solid #F1F4F8;')}><span style={sx('font-size:12.5px;color:#1C2733;font-weight:500;')}>Бисопролол 2.5 mg</span><span style={sx('font-size:10px;font-weight:700;color:#1B6B46;background:#E3F0EA;border-radius:5px;padding:2px 7px;')}>Rx</span></div>
                          </div>
                        </div>
                      </div>

                    </div>{/* /content stack */}
                  </main>
                </div>{/* /app */}

                {/* cursor (inside camera space) */}
                {cursorEl}

              </div>{/* /camera surface */}

              {/* ============ OVERLAYS (above app, under chrome) ============ */}
              {/* HOOK */}
              {hookMounted && (
                <div style={sx(`position:absolute;inset:0;z-index:40;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;background:radial-gradient(120% 120% at 50% 30%, #FBFCFE 0%, #EEF3F9 100%);opacity:${hookOpacity};transition:opacity .6s ease;transform:translateZ(0);font-family:var(--font-inter-tight,'Inter Tight'),sans-serif;`)}>
                  <div style={sx('display:flex;align-items:center;gap:8px;opacity:0;animation:tmd-kin .6s ease .05s forwards;')}>
                    <svg width="22" height="22" viewBox="0 0 56 56" fill="none"><rect x="4" y="4" width="48" height="48" rx="13" fill="#1D3B5C" /><g transform="translate(4 4)"><g stroke="#fff" strokeWidth="6" strokeLinecap="round"><path d="M12 16 H36" /><path d="M24 16 V36" /></g><path d="M12 26 H22" stroke="#8FC0E8" strokeWidth="6" strokeLinecap="round" /></g></svg>
                    <span style={sx('font-weight:700;font-size:17px;letter-spacing:-0.03em;')}><span style={sx('color:#142740;')}>Tuber</span><span style={sx('color:#4F8FBF;')}>Med</span></span>
                  </div>
                  <div style={sx('position:relative;font-size:40px;font-weight:600;color:#8893A1;margin-top:26px;opacity:0;animation:tmd-kinblur .6s ease .35s forwards;')}>
                    15 минути писане
                    <span style={sx('position:absolute;left:-4px;right:-4px;top:52%;height:4px;border-radius:2px;background:#C0392B;transform-origin:left;transform:scaleX(0);animation:tmd-strike .5s cubic-bezier(.65,0,.2,1) 1.1s forwards;')} />
                  </div>
                  <div style={sx('margin-top:14px;opacity:0;animation:tmd-kin .5s ease 1.35s forwards;')}><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="#8FC0E8" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg></div>
                  <div style={sx('font-size:58px;font-weight:800;color:#274C77;letter-spacing:-0.03em;line-height:1.04;margin-top:10px;white-space:nowrap;opacity:0;animation:tmd-kinblur .7s cubic-bezier(.2,.7,.2,1) 1.55s forwards;')}>30 секунди преглед</div>
                  <div style={sx("font-family:var(--font-inter,'Inter'),sans-serif;font-size:16px;color:#5C6B7A;margin-top:22px;opacity:0;animation:tmd-kin .6s ease 2.0s forwards;")}>Говорите. AI пише амбулаторния лист.</div>
                </div>
              )}

              {/* PAYOFF */}
              {overlayPayoff && (
                <div style={sx(`position:absolute;inset:0;z-index:40;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;background:radial-gradient(120% 120% at 50% 20%, #1D3B5C 0%, #15293F 70%, #0F2032 100%);opacity:0;animation:tmd-bgfade .55s ease forwards;transform:translateZ(0);font-family:var(--font-inter-tight,'Inter Tight'),sans-serif;`)}>
                  <div style={sx('display:flex;align-items:center;gap:11px;opacity:0;animation:tmd-kinblur .7s ease .1s forwards;')}>
                    <svg width="46" height="46" viewBox="0 0 56 56" fill="none"><defs><linearGradient id="pg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#2E5A8F" /><stop offset="1" stopColor="#1D3B5C" /></linearGradient></defs><rect x="4" y="4" width="48" height="48" rx="13" fill="url(#pg)" stroke="#3A618F" strokeWidth="1" /><g transform="translate(4 4)"><g stroke="#fff" strokeWidth="6" strokeLinecap="round"><path d="M12 16 H36" /><path d="M24 16 V36" /></g><path d="M12 26 H22" stroke="#8FC0E8" strokeWidth="6" strokeLinecap="round" /></g></svg>
                    <span style={sx('font-weight:700;font-size:40px;letter-spacing:-0.04em;')}><span style={sx('color:#fff;')}>Tuber</span><span style={sx('color:#8FC0E8;')}>Med</span></span>
                  </div>
                  <div style={sx('font-size:30px;font-weight:600;color:#EAF1F8;letter-spacing:-0.02em;margin-top:26px;max-width:680px;line-height:1.18;opacity:0;animation:tmd-kin .6s ease .5s forwards;')}>От разговор до амбулаторен лист за секунди.</div>
                  <div style={sx("font-family:var(--font-jetbrains,'JetBrains Mono'),monospace;font-size:14px;color:#8FC0E8;margin-top:20px;letter-spacing:0.02em;opacity:0;animation:tmd-kin .6s ease .85s forwards;")}>app.tubermed.com</div>
                  <div style={sx("font-family:var(--font-inter,'Inter'),sans-serif;font-size:12.5px;color:#A9BBD0;margin-top:26px;opacity:0;animation:tmd-kin .6s ease 1.1s forwards;")}>GDPR · Обработка в ЕС · Лекарят остава авторът</div>
                </div>
              )}

            </div>{/* /viewport */}
          </div>{/* /frame */}
        </div>{/* /stage */}
      </div>
    );
  }
}
