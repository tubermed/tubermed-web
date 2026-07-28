// ─────────────────────────────────────────────────────────────────────────────
// lib/stt-stream.ts — failure-path first.
// ─────────────────────────────────────────────────────────────────────────────
// Run: npm run test   (node --test, Node 24 strips the types natively — no
// runner, no loader, no new dependency in a repo that has never had one.)
//
// The rule this file exists to enforce, in Dimitar's words: "stuck + no way to
// get the note info back is the biggest possible failure". A websocket that
// dies mid-visit must NEVER cost the visit. So the failure cases come first
// here, and the happy path is the short section at the bottom.
//
// THE DESIGN DECISION THESE TESTS PIN: a dropped stream degrades the visit to
// the async path PERMANENTLY — there is no mid-visit resume. Resuming would
// mean either a hole in the transcript (the audio that played while the socket
// was down) or a duplicated boundary, and a silent hole in a medical note is
// far worse than losing the latency win on one visit. The local MediaRecorder
// buffer keeps running the whole time, so the fallback is lossless. "Once
// degraded, always degraded" is therefore a SAFETY property, and several tests
// below exist only to stop a future change from adding a clever resume.

import { test } from 'node:test';
import assert from 'node:assert';
import { SonioxLiveStream, type LiveSocket, type DegradeReason } from '../lib/stt-stream.ts';

// ── A fake WebSocket shaped exactly like the browser's ──────────────────────
class FakeSocket implements LiveSocket {
  readyState = 0; // CONNECTING
  sent: Array<string | ArrayBufferLike | Blob> = [];
  closed = false;
  onopen: ((ev?: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: ((ev?: unknown) => void) | null = null;
  onclose: ((ev?: { code?: number }) => void) | null = null;

  send(data: string | ArrayBufferLike | Blob) {
    if (this.readyState !== 1) throw new Error('send on a non-open socket');
    this.sent.push(data);
  }
  close() { this.closed = true; this.readyState = 3; }

  // ── test drivers ──
  open()  { this.readyState = 1; this.onopen?.(); }
  tokens(toks: Array<{ text: string; is_final?: boolean }>) {
    this.onmessage?.({ data: JSON.stringify({ tokens: toks }) });
  }
  finished() { this.onmessage?.({ data: JSON.stringify({ tokens: [], finished: true }) }); }
  serverError(code = 'invalid_audio') {
    this.onmessage?.({ data: JSON.stringify({ error_code: code, error_message: 'bad' }) });
  }
  fail()  { this.readyState = 3; this.onerror?.(new Error('boom')); }
  drop(code = 1006) { this.readyState = 3; this.onclose?.({ code }); }
}

function makeStream(over: Partial<{ openTimeoutMs: number; finalizeTimeoutMs: number }> = {}) {
  const sock = new FakeSocket();
  const degradedWith: DegradeReason[] = [];
  const texts: string[] = [];
  const s = new SonioxLiveStream({
    wsUrl: 'wss://stt-rt.eu.soniox.com/transcribe-websocket',
    apiKey: 'tempkey_test',
    config: { model: 'stt-rt-v5', audio_format: 'auto', language_hints: ['bg'] },
    createSocket: () => sock,
    openTimeoutMs: over.openTimeoutMs ?? 10_000,
    finalizeTimeoutMs: over.finalizeTimeoutMs ?? 10_000,
    callbacks: {
      onDegraded: (r) => degradedWith.push(r),
      onText: (t) => texts.push(t),
    },
  });
  return { s, sock, degradedWith, texts };
}

const chunk = () => new Uint8Array([1, 2, 3]).buffer;

// ════════════════════════════════════════════════════════════════════════════
// FAILURE PATHS
// ════════════════════════════════════════════════════════════════════════════

test('a socket error mid-visit degrades the stream, it does not throw', () => {
  const { s, sock, degradedWith } = makeStream();
  s.start();
  sock.open();
  sock.tokens([{ text: 'Добър ден. ', is_final: true }]);

  sock.fail();

  assert.strictEqual(s.isDegraded, true, 'an errored socket must mark the stream degraded');
  assert.deepStrictEqual(degradedWith, ['socket_error']);
  // The text captured before the drop is still readable — it is not the note,
  // but it must not vanish either.
  assert.strictEqual(s.text, 'Добър ден. ');
});

test('an unclean close mid-visit degrades the stream', () => {
  const { s, sock, degradedWith } = makeStream();
  s.start();
  sock.open();
  sock.drop(1006);
  assert.strictEqual(s.isDegraded, true);
  assert.deepStrictEqual(degradedWith, ['socket_closed']);
});

test('a Soniox server-error frame degrades the stream', () => {
  const { s, sock, degradedWith } = makeStream();
  s.start();
  sock.open();
  sock.serverError('unsupported_audio_format');
  assert.strictEqual(s.isDegraded, true);
  assert.deepStrictEqual(degradedWith, ['server_error']);
});

test('after degrading, sendAudio is inert — it never throws and never reaches the socket', () => {
  const { s, sock } = makeStream();
  s.start();
  sock.open();
  const beforeCount = sock.sent.length;
  sock.fail();

  // The recorder keeps producing chunks for the whole visit; the controller has
  // to swallow them quietly rather than throwing into an ondataavailable handler.
  for (let i = 0; i < 20; i++) s.sendAudio(chunk());

  assert.strictEqual(sock.sent.length, beforeCount, 'no audio may be pushed at a dead socket');
});

test('a degraded stream can NEVER recover — no mid-visit resume', () => {
  const { s, sock, degradedWith } = makeStream();
  s.start();
  sock.open();
  sock.fail();

  // Anything a late/reconnected socket might deliver must be ignored outright:
  // accepting it would splice a transcript across an audio gap.
  sock.open();
  sock.tokens([{ text: 'ТЕКСТ СЛЕД ПРЕКЪСВАНЕ', is_final: true }]);
  sock.finished();

  assert.strictEqual(s.isDegraded, true, 'degraded is a terminal state');
  assert.ok(!s.text.includes('СЛЕД ПРЕКЪСВАНЕ'),
    'tokens arriving after a drop must not be spliced into the transcript');
  assert.strictEqual(degradedWith.length, 1, 'onDegraded must fire exactly once');
  // The primary mechanism, pinned explicitly: a dead stream lets go of its
  // socket entirely, so even a caller holding its own reference cannot feed it.
  assert.strictEqual(sock.onmessage, null, 'a degraded stream must detach its handlers');
  assert.strictEqual(sock.closed, true, 'a degraded stream must close its socket');
});

test('an error followed by a close reports degradation exactly once', () => {
  const { s, sock, degradedWith } = makeStream();
  s.start();
  sock.open();
  sock.fail();
  sock.drop(1006);   // browsers fire error THEN close
  assert.deepStrictEqual(degradedWith, ['socket_error'], 'the cascade must not double-report');
});

test('finalize() on an already-degraded stream resolves immediately — it never hangs', async () => {
  const { s, sock } = makeStream({ finalizeTimeoutMs: 60_000 });
  s.start();
  sock.open();
  sock.fail();

  const t0 = Date.now();
  const r = await s.finalize();
  assert.strictEqual(r.ok, false);
  assert.ok(Date.now() - t0 < 1000, 'a degraded finalize must not wait out the timeout');
});

test('finalize() that never gets `finished` gives up and falls back', async () => {
  // The nastiest shape of the failure: the socket looks alive, we ask it to
  // flush, and nothing ever comes back. Without a deadline the doctor waits
  // forever on a spinner with the note trapped in the tab.
  const { s, sock, degradedWith } = makeStream({ finalizeTimeoutMs: 30 });
  s.start();
  sock.open();
  sock.tokens([{ text: 'нещо', is_final: true }]);

  const r = await s.finalize();
  assert.strictEqual(r.ok, false);
  assert.strictEqual((r as { reason: DegradeReason }).reason, 'finalize_timeout');
  assert.deepStrictEqual(degradedWith, ['finalize_timeout']);
});

test('a socket that never opens degrades on the open deadline', async () => {
  const { s, degradedWith } = makeStream({ openTimeoutMs: 30 });
  s.start();
  await new Promise((r) => setTimeout(r, 80));
  assert.strictEqual(s.isDegraded, true);
  assert.deepStrictEqual(degradedWith, ['open_timeout']);
});

test('audio recorded before the socket opens is QUEUED and flushed in order', () => {
  // Not a nicety — a correctness requirement. The recorder starts the instant
  // the doctor taps record, while the key mint is still in flight, so the first
  // chunks land before the socket is up. Chunk 1 carries the WebM/EBML header:
  // drop it and Soniox receives headerless clusters and cannot decode the visit
  // at all. Order matters for the same reason — the stream is one container.
  const a = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]).buffer; // EBML magic
  const b = new Uint8Array([9, 9]).buffer;

  const { s, sock } = makeStream();
  s.start();                      // readyState is still CONNECTING
  s.sendAudio(a);
  s.sendAudio(b);
  assert.strictEqual(sock.sent.length, 0, 'nothing may be sent before open');

  sock.open();                    // config frame, then the backlog
  assert.strictEqual(sock.sent.length, 3, 'config + both queued chunks');
  assert.strictEqual(typeof sock.sent[0], 'string', 'config frame goes first');
  assert.strictEqual(sock.sent[1], a, 'the header chunk must survive');
  assert.strictEqual(sock.sent[2], b, 'queued chunks keep their order');
});

test('the pre-open queue is bounded, and a stream that never opens drops it', async () => {
  // A socket that hangs must not let the queue grow for the length of a visit.
  const { s, sock } = makeStream({ openTimeoutMs: 20 });
  for (let i = 0; i < 5_000; i++) s.sendAudio(chunk());
  s.start();
  for (let i = 0; i < 5_000; i++) s.sendAudio(chunk());
  await new Promise((r) => setTimeout(r, 60));

  assert.strictEqual(s.isDegraded, true, 'the open deadline still fires');
  sock.open();
  assert.strictEqual(sock.sent.length, 0, 'a degraded stream flushes nothing');
});

test('a malformed server frame is ignored, not fatal', () => {
  const { s, sock } = makeStream();
  s.start();
  sock.open();
  sock.onmessage?.({ data: 'not json at all' });
  sock.onmessage?.({ data: JSON.stringify({ unexpected: true }) });
  assert.strictEqual(s.isDegraded, false, 'junk frames must not kill a healthy stream');
});

// ════════════════════════════════════════════════════════════════════════════
// HAPPY PATH
// ════════════════════════════════════════════════════════════════════════════

test('the config frame goes out once on open, with the key merged in', () => {
  const { s, sock } = makeStream();
  s.start();
  sock.open();

  assert.strictEqual(sock.sent.length, 1, 'exactly one config frame');
  const cfg = JSON.parse(sock.sent[0] as string);
  assert.strictEqual(cfg.api_key, 'tempkey_test');
  assert.strictEqual(cfg.model, 'stt-rt-v5');
  assert.strictEqual(cfg.audio_format, 'auto');
  assert.deepStrictEqual(cfg.language_hints, ['bg']);
});

test('only FINAL tokens build the transcript, joined with nothing at all', () => {
  const { s, sock } = makeStream();
  s.start();
  sock.open();

  // Interleaved non-finals are what the live display consumes; they must never
  // reach the submitted transcript.
  sock.tokens([{ text: 'Пациентът ', is_final: true }, { text: 'се', is_final: false }]);
  sock.tokens([{ text: 'се оплаква ', is_final: true }]);
  sock.tokens([{ text: 'от кашлица.', is_final: true }]);

  // BYTE-IDENTITY CONTRACT: the async leg persists tokens.map(t => t.text)
  // .join(''). Any separator here would desynchronise every downstream offset.
  assert.strictEqual(s.text, 'Пациентът се оплаква от кашлица.');
});

test('finalize() flushes and resolves with the final transcript', async () => {
  const { s, sock } = makeStream();
  s.start();
  sock.open();
  sock.tokens([{ text: 'Готово.', is_final: true }]);

  const p = s.finalize();
  // The empty string is Soniox's end-of-audio marker.
  assert.strictEqual(sock.sent[sock.sent.length - 1], '', 'finalize must send the end-of-audio marker');
  sock.tokens([{ text: ' Последна дума.', is_final: true }]);
  sock.finished();

  const r = await p;
  assert.strictEqual(r.ok, true);
  assert.strictEqual((r as { transcript: string }).transcript, 'Готово. Последна дума.',
    'tokens arriving between the flush and `finished` belong in the transcript');
});

test('the live-text callback fires as finals land, for the on-screen transcript', () => {
  const { s, sock, texts } = makeStream();
  s.start();
  sock.open();
  sock.tokens([{ text: 'Едно ', is_final: true }]);
  sock.tokens([{ text: 'две', is_final: false }]);
  sock.tokens([{ text: 'две ', is_final: true }]);
  assert.deepStrictEqual(texts, ['Едно ', 'Едно две '],
    'the display updates on finals only — a non-final must not repaint the transcript');
});

test('abort() closes the socket without degrading (the doctor cancelled)', () => {
  const { s, sock, degradedWith } = makeStream();
  s.start();
  sock.open();
  s.abort();
  assert.strictEqual(sock.closed, true);
  assert.deepStrictEqual(degradedWith, [], 'a deliberate abort is not a failure');
});
