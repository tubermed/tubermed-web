// F-05 acceptance cases 3 and 4, client side.
//
// The defect was a comforting sentence that was not true, so these assert what
// the panel is ALLOWED TO SAY — not just which branch runs. Every case checks
// the copy itself, because "the state machine is right" was already true when
// the doctor was being told their audio was safe and it was not.
//
// Run: npm test   (node --test scripts/*.test.ts — no runner, no loader)

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  uploadRetryCopy,
  MAX_TRANSCRIPTION_RETRIES,
} from '../lib/upload-retry.ts';

// The claim that was false. It may appear ONLY when the buffer is really held.
const SAVED_CLAIM = 'Звукът ви е запазен';

test('case 3 — with no blob, the panel does not claim the audio is saved', () => {
  const copy = uploadRetryCopy(false, null);
  assert.equal(copy.state, 'buffer-gone');
  assert.ok(
    !copy.body.includes(SAVED_CLAIM),
    `the "saved" claim must not appear with no buffer — got: ${copy.body}`,
  );
});

test('case 3 — with no blob, no retry is offered', () => {
  // The handler behind the button starts `if (!blob) return;`. Offering it here
  // would be a control that silently does nothing.
  assert.equal(uploadRetryCopy(false, null).canRetry, false);
  assert.equal(uploadRetryCopy(false, 1).canRetry, false);
  assert.equal(uploadRetryCopy(false, 99).canRetry, false);
});

test('case 3 — the no-blob copy says what to do instead', () => {
  const { body } = uploadRetryCopy(false, null);
  assert.ok(body.includes('наново'), `must name the remaining action — got: ${body}`);
});

test('with the blob held, the panel may promise the audio is there', () => {
  const copy = uploadRetryCopy(true, 1);
  assert.equal(copy.state, 'retryable');
  assert.ok(copy.body.includes(SAVED_CLAIM));
  assert.equal(copy.canRetry, true);
});

test(`case 4 — attempts 1..${MAX_TRANSCRIPTION_RETRIES} keep saying "try again"`, () => {
  for (let attempt = 1; attempt <= MAX_TRANSCRIPTION_RETRIES; attempt++) {
    const copy = uploadRetryCopy(true, attempt);
    assert.equal(copy.state, 'retryable', `attempt ${attempt} should still be retryable`);
  }
});

test(`case 4 — attempt ${MAX_TRANSCRIPTION_RETRIES + 1} changes the message`, () => {
  const before = uploadRetryCopy(true, MAX_TRANSCRIPTION_RETRIES);
  const after = uploadRetryCopy(true, MAX_TRANSCRIPTION_RETRIES + 1);

  assert.equal(after.state, 'service-down');
  assert.notEqual(after.body, before.body, 'the message must actually change');
  assert.notEqual(after.title, before.title);
});

test('case 4 — the changed message is honest about the service and points somewhere', () => {
  const { body } = uploadRetryCopy(true, MAX_TRANSCRIPTION_RETRIES + 1);
  assert.ok(body.includes('не отговаря'), `must name the service failing — got: ${body}`);
  assert.ok(
    body.includes('не затваряйте'),
    `must warn against closing the page while the audio is only in memory — got: ${body}`,
  );
  assert.ok(body.includes('ръчно'), `must point at the manual fallback — got: ${body}`);
});

test('case 4 — the retry affordance survives the cap (the service may recover)', () => {
  assert.equal(uploadRetryCopy(true, 99).canRetry, true);
});

test('an unknown attempt count does not silently become "fine"', () => {
  // null = the server could not report a count (migration 026 pending). It must
  // behave as the ordinary retryable state, never as "already past the cap" and
  // never as a reason to suppress the warning path entirely.
  const copy = uploadRetryCopy(true, null);
  assert.equal(copy.state, 'retryable');
  assert.equal(copy.canRetry, true);
});

// The B4 network-drop wording. It promises the audio can be re-sent, so it is
// safe only in the state where that is true.
const B4_REASON =
  'Връзката прекъсна. Не е нужно да записвате отново - натиснете, за да изпратите пак.';

test('a caller-supplied reason is used when the audio really is retryable', () => {
  const copy = uploadRetryCopy(true, 1, B4_REASON);
  assert.equal(copy.state, 'retryable');
  assert.equal(copy.body, B4_REASON, 'the approved network-drop wording must survive');
});

test('a caller-supplied reason is DROPPED when the buffer is gone', () => {
  // „натиснете, за да изпратите пак" with nothing to send is the original bug
  // in a new costume.
  const copy = uploadRetryCopy(false, 1, B4_REASON);
  assert.equal(copy.state, 'buffer-gone');
  assert.ok(
    !copy.body.includes('изпратите пак'),
    `a reason promising a re-send must not survive into buffer-gone — got: ${copy.body}`,
  );
});

test('a caller-supplied reason is DROPPED once the service is down', () => {
  const copy = uploadRetryCopy(true, MAX_TRANSCRIPTION_RETRIES + 1, B4_REASON);
  assert.equal(copy.state, 'service-down');
  assert.ok(!copy.body.includes('изпратите пак'));
  assert.ok(copy.body.includes('не отговаря'));
});

test('a blank reason falls back to the standard promise, never to an empty body', () => {
  for (const blank of ['', '   ', undefined]) {
    const copy = uploadRetryCopy(true, 1, blank);
    assert.equal(copy.body, 'Звукът ви е запазен. Опитайте отново.');
  }
});

test('the "saved" claim appears in exactly one state', () => {
  const states = [
    uploadRetryCopy(true, 1),
    uploadRetryCopy(true, MAX_TRANSCRIPTION_RETRIES + 1),
    uploadRetryCopy(false, 1),
  ];
  const claiming = states.filter((s) => s.body.includes(SAVED_CLAIM));
  assert.equal(claiming.length, 1, 'only the plainly-retryable state may make that promise');
  assert.equal(claiming[0].state, 'retryable');
});
