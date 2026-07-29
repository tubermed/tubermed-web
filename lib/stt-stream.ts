// ─────────────────────────────────────────────────────────────────────────────
// Soniox realtime (stt-rt-v5) live transcription — browser side.
// ─────────────────────────────────────────────────────────────────────────────
// Wraps ONE websocket to Soniox for ONE visit. It accumulates final tokens,
// pushes live text to the UI, and — the part that actually matters — fails in a
// way that can never cost the visit.
//
// THE SAFETY MODEL
//
// The recorder keeps its local MediaRecorder buffer for the WHOLE visit, in
// parallel with streaming. This controller therefore never has to be reliable;
// it only has to be HONEST about having failed, promptly, so the caller can
// fall back to the async upload path with a complete recording.
//
// A drop is TERMINAL: `degraded` is a one-way latch and there is no mid-visit
// resume. That is deliberate. Reconnecting would mean either a hole in the
// transcript (whatever the doctor said while the socket was down) or a
// duplicated boundary — and a silent hole in a medical note is far worse than
// losing the latency win on a single visit. Because the local buffer is
// complete, degrading costs only speed, never content.
//
// Every failure mode converges on the same observable: `isDegraded === true`
// and `onDegraded(reason)` fired exactly once. The caller needs no per-reason
// handling — the reason exists for telemetry, not control flow.
//
// The raw websocket is used rather than @soniox/speech-to-text-web: the SDK
// owns microphone capture and its own MediaRecorder, which would give us two
// independent captures of the same visit and no guarantee the buffered blob
// matches what was streamed. The fallback blob has to be the same audio, so the
// recorder stays ours and only the transport is Soniox's. The wire protocol is
// three messages wide (config, binary audio, empty-string flush), which is not
// enough surface to justify the loss of control.

/** The slice of the browser WebSocket API this controller uses. Shaped so the
 *  real `WebSocket` can be handed over unchanged, and tests can inject a fake. */
export interface LiveSocket {
  readyState: number;
  send(data: string | ArrayBufferLike | Blob): void;
  close(): void;
  onopen: ((ev?: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev?: unknown) => void) | null;
  onclose: ((ev?: { code?: number }) => void) | null;
}

export type DegradeReason =
  | 'connect_error'     // killed BEFORE open — the CSP-block / DNS / TLS / firewall class
  | 'connect_closed'    // closed BEFORE open without an error event
  | 'open_timeout'      // the socket never opened and never errored
  | 'socket_error'      // transport error mid-visit (socket had opened)
  | 'socket_closed'     // closed under us mid-visit (socket had opened)
  | 'server_error'      // Soniox sent an error frame
  | 'finalize_timeout'; // flushed at the end, `finished` never arrived
// The connect_* / socket_* split exists for telemetry, not control flow: a
// stream that dies before open on EVERY visit is an environment blocking the
// connection (a CSP tightening, a clinic firewall), not a flaky line — and
// that diagnosis must be readable from analytics, because the failure only
// reproduces in a live browser (2026-07-29: a missing CSP connect-src origin
// degraded every prod visit while every offline gate stayed green).

export type FinalizeResult =
  | { ok: true;  transcript: string }
  | { ok: false; reason: DegradeReason };

export interface LiveStreamCallbacks {
  /** Fires whenever the display changes — a batch of FINAL tokens landed, the
   *  non-final hypothesis moved, or both. DISPLAY ONLY, both arguments.
   *
   *  `tailText` is the last LIVE_TAIL_CHARS of the finalized transcript. The
   *  live panel shows a handful of lines, so handing it the full transcript
   *  per batch was O(n²) over a long visit (join + re-render of an
   *  ever-growing string). The full transcript — the submission contract —
   *  stays on `.text` and in finalize()'s result.
   *
   *  `pendingText` is Soniox's current NON-FINAL hypothesis — the sub-second
   *  "it is hearing me" text the panel renders muted. Soniox re-sends the
   *  whole hypothesis on every frame until it finalizes, so this is replaced
   *  wholesale per frame, never accumulated. It NEVER reaches `finals`.
   *  The render bound covers the two TOGETHER:
   *  tailText.length + pendingText.length <= LIVE_TAIL_CHARS. */
  onText?: (tailText: string, pendingText: string) => void;
  /** Fires exactly once, the first time the stream fails. */
  onDegraded?: (reason: DegradeReason) => void;
}

export interface SonioxLiveStreamOptions {
  wsUrl: string;
  apiKey: string;
  /** Server-authored session config (model, language hints, specialty terms). */
  config: Record<string, unknown>;
  createSocket?: (url: string) => LiveSocket;
  callbacks?: LiveStreamCallbacks;
  openTimeoutMs?: number;
  finalizeTimeoutMs?: number;
}

const SOCKET_OPEN = 1;

/** Render bound for the live panel (see LiveStreamCallbacks.onText) — it
 *  covers the finalized tail and the non-final hypothesis COMBINED. ~3k chars
 *  is dozens of on-screen lines of Bulgarian speech — far more than the box
 *  shows — while keeping the per-batch cost O(tail), not O(visit). The slice
 *  may open mid-word at its leading edge; the panel is bottom-anchored, so
 *  that edge is never the line the doctor is reading. */
export const LIVE_TAIL_CHARS = 3_000;

/** Soniox is generous here in practice (the handshake is sub-second on a healthy
 *  line); this only has to beat the doctor's patience. */
const DEFAULT_OPEN_TIMEOUT_MS = 8_000;

/** Measured finalize tail is ~0.1–0.4s. 15s is ~40× headroom and still far
 *  inside the "note appears right after the visit" promise — past it we stop
 *  waiting and take the complete local recording instead. */
const DEFAULT_FINALIZE_TIMEOUT_MS = 15_000;

interface SonioxToken { text?: string; is_final?: boolean }

export class SonioxLiveStream {
  private readonly opts: SonioxLiveStreamOptions;
  private socket: LiveSocket | null = null;
  private finals: string[] = [];
  /** The last LIVE_TAIL_CHARS of the transcript, maintained incrementally for
   *  the onText callback. NEVER a source for submission — that is `finals`. */
  private liveTail = '';
  /** Soniox's current non-final hypothesis, replaced wholesale on every
   *  tokens frame (the protocol re-sends it until the words finalize).
   *  DISPLAY ONLY — it never touches `finals`, `.text`, or finalize(). */
  private hypothesis = '';
  private degraded = false;
  private configSent = false;
  /** Chunks recorded before the socket finished opening. NOT an optimisation:
   *  the recorder starts the instant the doctor taps record, while the key mint
   *  is still in flight, and the FIRST chunk carries the WebM/EBML header. Drop
   *  it and Soniox receives headerless clusters it cannot decode. Bounded so a
   *  socket that never opens cannot grow this for the length of a visit; the
   *  open deadline (8s ≈ 16 chunks) fires long before the cap is reached. */
  private pending: Array<ArrayBufferLike | Blob> = [];
  private static readonly MAX_PENDING_CHUNKS = 120;

  private openTimer: ReturnType<typeof setTimeout> | null = null;
  private finalizeTimer: ReturnType<typeof setTimeout> | null = null;
  private settleFinalize: ((r: FinalizeResult) => void) | null = null;

  constructor(opts: SonioxLiveStreamOptions) {
    this.opts = opts;
  }

  get isDegraded(): boolean { return this.degraded; }

  /** The transcript so far: FINAL tokens only, joined with nothing.
   *  Byte-identical to what the async leg persists — any separator here would
   *  desynchronise every downstream offset (field_sources, block.source). */
  get text(): string { return this.finals.join(''); }

  start(): void {
    if (this.socket || this.degraded) return;

    const create = this.opts.createSocket ?? ((url: string) => new WebSocket(url) as unknown as LiveSocket);
    let sock: LiveSocket;
    try {
      sock = create(this.opts.wsUrl);
    } catch {
      // Some browsers surface a blocked connection (CSP, malformed URL) as a
      // synchronous constructor throw rather than an error event — same class.
      this.degrade('connect_error');
      return;
    }
    this.socket = sock;

    this.openTimer = setTimeout(() => this.degrade('open_timeout'), this.opts.openTimeoutMs ?? DEFAULT_OPEN_TIMEOUT_MS);

    sock.onopen = () => {
      if (this.degraded || this.configSent) return;
      this.clearOpenTimer();
      this.configSent = true;
      try {
        // The key is merged in only here — it is never stored on the config
        // object the server handed us.
        sock.send(JSON.stringify({ ...this.opts.config, api_key: this.opts.apiKey }));
        // Then the backlog, in order, before any live chunk can overtake it.
        const backlog = this.pending;
        this.pending = [];
        for (const c of backlog) sock.send(c);
      } catch {
        this.degrade('socket_error');
      }
    };

    sock.onmessage = (ev) => this.handleMessage(ev);
    // configSent doubles as "the socket reached open": a failure before it is
    // the connection being refused (connect_*), after it a mid-visit drop
    // (socket_*). The distinction is telemetry-only — every path degrades the
    // same way.
    sock.onerror   = () => this.degrade(this.configSent ? 'socket_error' : 'connect_error');
    sock.onclose   = () => this.degrade(this.configSent ? 'socket_closed' : 'connect_closed');
  }

  /** Push one recorder chunk. Inert once degraded or before the socket opens —
   *  this runs inside MediaRecorder.ondataavailable, where a throw would take
   *  the recording down with it. */
  sendAudio(data: ArrayBufferLike | Blob): void {
    if (this.degraded) return;

    const sock = this.socket;
    if (!this.configSent || !sock || sock.readyState !== SOCKET_OPEN) {
      // Still connecting — hold it, header and all. Past the cap we stop
      // growing rather than consume the tab's memory; the open deadline will
      // degrade this stream to the async path shortly anyway.
      if (this.pending.length < SonioxLiveStream.MAX_PENDING_CHUNKS) this.pending.push(data);
      return;
    }
    try {
      sock.send(data);
    } catch {
      this.degrade('socket_error');
    }
  }

  /** Flush and wait for Soniox's `finished`. Resolves {ok:false} rather than
   *  rejecting — the caller's next step is the same either way (fall back), and
   *  a rejected promise in a stop handler is one more way to strand a visit. */
  finalize(): Promise<FinalizeResult> {
    if (this.degraded) {
      return Promise.resolve({ ok: false, reason: this.lastReason ?? 'socket_closed' });
    }
    const sock = this.socket;
    if (!sock || sock.readyState !== SOCKET_OPEN) {
      return Promise.resolve({ ok: false, reason: 'socket_closed' });
    }

    return new Promise<FinalizeResult>((resolve) => {
      this.settleFinalize = resolve;
      this.finalizeTimer = setTimeout(
        () => this.degrade('finalize_timeout'),
        this.opts.finalizeTimeoutMs ?? DEFAULT_FINALIZE_TIMEOUT_MS,
      );
      try {
        sock.send(''); // Soniox's end-of-audio marker
      } catch {
        this.degrade('socket_error');
      }
    });
  }

  /** Deliberate teardown (the doctor cancelled). Not a failure — no degrade. */
  abort(): void {
    this.clearOpenTimer();
    this.clearFinalizeTimer();
    const sock = this.socket;
    this.socket = null;
    if (sock) {
      sock.onopen = sock.onmessage = sock.onerror = sock.onclose = null;
      try { sock.close(); } catch { /* already gone */ }
    }
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private lastReason: DegradeReason | null = null;

  private handleMessage(ev: { data: unknown }): void {
    // A late frame on a dead stream is exactly what "no resume" must refuse:
    // splicing it in would join text across an audio gap. degrade() already
    // detaches every handler, so this is the second of two independent guards,
    // not the primary one — it covers a caller holding its own socket reference.
    // (Verified by mutation: removing either alone keeps the behaviour;
    // removing both fails the "can NEVER recover" test.)
    if (this.degraded) return;

    let msg: { tokens?: SonioxToken[]; finished?: boolean; error_code?: string; error_message?: string };
    try {
      msg = JSON.parse(String(ev.data));
    } catch {
      return; // junk frame — ignore, never fatal
    }
    if (!msg || typeof msg !== 'object') return;

    if (msg.error_code || msg.error_message) {
      this.degrade('server_error');
      return;
    }

    if (Array.isArray(msg.tokens)) {
      let appended = false;
      // Rebuilt from THIS frame alone: Soniox re-sends the entire outstanding
      // hypothesis every frame, so an empty frame legitimately means "nothing
      // pending" (it just finalized, or there is silence).
      let hyp = '';
      for (const t of msg.tokens) {
        if (!t || typeof t.text !== 'string') continue;
        if (t.is_final) {
          this.finals.push(t.text);
          this.liveTail = (this.liveTail + t.text).slice(-LIVE_TAIL_CHARS);
          appended = true;
        } else {
          hyp += t.text;
        }
      }
      const hypothesisMoved = hyp !== this.hypothesis;
      this.hypothesis = hyp;
      if (appended || hypothesisMoved) this.emitDisplay();
    }

    if (msg.finished) {
      this.clearFinalizeTimer();
      const settle = this.settleFinalize;
      this.settleFinalize = null;
      settle?.({ ok: true, transcript: this.text });
      this.abort();
    }
  }

  /** Hand the panel its two display halves under ONE combined bound: the
   *  hypothesis (which the doctor is watching form) keeps its full clamped
   *  length, and the finalized tail yields whatever room is left, so
   *  tail + pending is always exactly the last LIVE_TAIL_CHARS of
   *  (transcript + hypothesis). */
  private emitDisplay(): void {
    const cb = this.opts.callbacks?.onText;
    if (!cb) return;
    const pending = this.hypothesis.length > LIVE_TAIL_CHARS
      ? this.hypothesis.slice(-LIVE_TAIL_CHARS)
      : this.hypothesis;
    const room = LIVE_TAIL_CHARS - pending.length;
    const tail = this.liveTail.length > room ? this.liveTail.slice(this.liveTail.length - room) : this.liveTail;
    cb(tail, pending);
  }

  /** One-way latch. Every failure path lands here; it fires the callback at
   *  most once, settles a pending finalize, and tears the socket down. */
  private degrade(reason: DegradeReason): void {
    if (this.degraded) return;
    this.degraded = true;
    this.lastReason = reason;
    this.pending = [];   // the local buffer is the fallback; this copy is dead weight

    this.clearOpenTimer();
    this.clearFinalizeTimer();

    const settle = this.settleFinalize;
    this.settleFinalize = null;

    // Detach handlers before closing so our own close() cannot re-enter here.
    const sock = this.socket;
    this.socket = null;
    if (sock) {
      sock.onopen = sock.onmessage = sock.onerror = sock.onclose = null;
      try { sock.close(); } catch { /* already gone */ }
    }

    settle?.({ ok: false, reason });
    this.opts.callbacks?.onDegraded?.(reason);
  }

  private clearOpenTimer(): void {
    if (this.openTimer) { clearTimeout(this.openTimer); this.openTimer = null; }
  }
  private clearFinalizeTimer(): void {
    if (this.finalizeTimer) { clearTimeout(this.finalizeTimer); this.finalizeTimer = null; }
  }
}
