/**
 * lib/upload-retry.ts — what the upload-retry panel is allowed to promise (F-05)
 *
 * The bug this closes was a SENTENCE, not a status code. When the pipeline
 * failed before Soniox produced a transcript, the scribe showed a panel opening
 * with „Звукът ви е запазен. Можете да опитате повторно извличане" — and the
 * doctor discovered it was false by clicking and collecting a 409. A false
 * reassurance followed by a dead end, with a patient in the room.
 *
 * So the copy is derived, never fixed. Two facts decide it, and both are checked
 * at the moment of rendering rather than assumed:
 *
 *   blobAvailable — is the recording ACTUALLY still in browser memory? The
 *     promise „Звукът ви е запазен" is true only while pcBlobRef holds it. It is
 *     released after a confirmed submit, and a page refresh drops it with the
 *     rest of the tab's memory. Without this check the panel would offer a retry
 *     button whose handler begins `if (!blob) return;` — a button that silently
 *     does nothing, which is the same defect wearing different clothes.
 *
 *   attempt — how many times the SERVICE has already failed on this visit
 *     (consultations.transcription_attempts, reported by the backend). If Soniox
 *     is down, "try again" is advice that cannot work, and repeating it while the
 *     doctor retries is just the original lie on a loop.
 *
 * ⚠ NOTHING HERE MAY REASSURE BY DEFAULT. When a fact is unknown the copy must
 * get MORE careful, not less: a null attempt means the count is unavailable (the
 * server is a migration behind), and the caller substitutes its own in-session
 * count rather than treating unknown as "fine, keep going".
 */

/**
 * Failed service attempts to tolerate before the copy stops saying "try again".
 * Three is a judgement, not a measurement: enough to ride out a blip, few enough
 * that a doctor is not still clicking during a real outage. The message changes
 * on attempt N+1 — the fourth failure is the one that says the service is down.
 */
export const MAX_TRANSCRIPTION_RETRIES = 3;

export type UploadRetryCopy = {
  /** Panel headline. */
  title: string;
  /** Body text. Must never claim more than the two facts support. */
  body: string;
  /** Whether to render the retry action at all. */
  canRetry: boolean;
  /** Discriminator, for tests and for telemetry that must stay content-free. */
  state: 'retryable' | 'service-down' | 'buffer-gone';
};

/**
 * The recording is gone and cannot be re-sent. Deliberately blunt: this is the
 * state where the previous version comforted the doctor and cost them the visit,
 * so it names the consequence and the only remaining action, and offers nothing
 * else. No „за съжаление", no apology softening the instruction.
 */
const BUFFER_GONE =
  'Записът вече не е в паметта на браузъра и не може да бъде изпратен отново. ' +
  'Прегледът трябва да бъде записан наново.';

/**
 * The service has failed repeatedly. The audio IS still in memory, so the first
 * thing to say is "do not close this page" — closing it is what turns a
 * recoverable outage into a lost visit. Then the honest options, in order.
 */
const SERVICE_DOWN =
  `Услугата за транскрипция не отговаря след ${MAX_TRANSCRIPTION_RETRIES} опита. ` +
  'Звукът ви е все още в браузъра — не затваряйте страницата. ' +
  'Опитайте пак след няколко минути; ако проблемът продължи, документирайте прегледа ръчно.';

/** The audio is in memory and it is worth another try. */
const RETRYABLE = 'Звукът ви е запазен. Опитайте отново.';

/**
 * uploadRetryCopy(blobAvailable, attempt, reason?) → what the panel may say.
 *
 * `attempt` is the server's count of failed service attempts for this visit, or
 * null when unavailable (migration 026 pending) — the caller passes its own
 * in-session count in that case.
 *
 * `reason` is the caller's own description of THIS failure, used as the body in
 * the plainly-retryable state. It exists because the panel has two callers: the
 * B4 network-drop path has its own wording („Връзката прекъсна…", Dimitar's),
 * and replacing it wholesale would be a silent copy change nobody asked for.
 *
 * ⚠ THE REASON IS DROPPED IN EVERY OTHER STATE, deliberately. Both callers'
 * reasons imply the audio can be re-sent — „натиснете, за да изпратите пак" says
 * so outright. Carried into the buffer-gone state, that is a fresh instance of
 * the exact bug being fixed: a sentence that was true when it was written and is
 * false when it is shown.
 */
export function uploadRetryCopy(
  blobAvailable: boolean,
  attempt: number | null,
  reason?: string,
): UploadRetryCopy {
  // Buffer first: with nothing to send, no message about the service is
  // actionable, and the retry button would be inert.
  if (!blobAvailable) {
    return {
      title: 'Записът не е наличен',
      body: BUFFER_GONE,
      canRetry: false,
      state: 'buffer-gone',
    };
  }

  if (typeof attempt === 'number' && attempt > MAX_TRANSCRIPTION_RETRIES) {
    return {
      title: 'Услугата не отговаря',
      body: SERVICE_DOWN,
      // The button STAYS. The service may recover, the audio is still here, and
      // removing the only path forward would strand a doctor who just needs to
      // wait two minutes. What changes is the promise, not the affordance.
      canRetry: true,
      state: 'service-down',
    };
  }

  return {
    title: 'Изпращането не бе успешно',
    // The caller's own reason when it has one — it is more specific than the
    // generic promise, and it is already the wording Dimitar approved for the
    // network-drop case.
    body: reason && reason.trim() ? reason.trim() : RETRYABLE,
    canRetry: true,
    state: 'retryable',
  };
}
