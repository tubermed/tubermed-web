<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Environment hazards

## Never use PowerShell `>` redirection to read/inspect repo files
PowerShell's `>` (and `Out-File`/`Set-Content` without `-Encoding utf8`) silently
re-encodes output to **UTF-16 LE with a BOM**. Piping a UTF-8 source file through
`git cat-file ... > tmp` or `... > out.txt` produces a UTF-16 file, which then reads
back as "binary" — git shows whole-file/binary diffs and ESLint errors with
`File appears to be binary`. This caused a near-miss: `PatientForm.tsx` (UTF-8/LF) was
wrongly "fixed" into UTF-16 based on a corrupted diagnostic, breaking eslint; recovered
via `git checkout -- <file>` then re-applying the edit.

To inspect file bytes/encoding/line-endings, read the file directly (the Read tool) or
use **cmd**/`git` without PowerShell redirection (e.g. `git cat-file blob HEAD:path | od`,
`grep -c $'\r'` via the Bash tool). Repo source is UTF-8 + LF; `core.autocrlf=true`.

# New-visit ЕГН workflow (frontend)

The patient-intake flow lives in `app/(workspace)/app/new-visit/page.tsx` +
`components/PatientForm.tsx`. The ЕГН (national ID) handling has several deliberate,
non-obvious rules — do not "simplify" them:

1. **Submit gate blocks on invalid ЕГН.** `canSubmit` includes `!egnInvalid`
   (`national_id_type==='egn'` && 10 digits && DOB underivable). Previously the red
   "невалидно ЕГН" message was cosmetic-only — the button stayed enabled. Keep the gate.

2. **Lookup lives INSIDE the form — there is no top search bar.** Patient lookup was
   folded into `PatientForm` two ways (the standalone `PatientSearch` in `WorkspaceTopBar`'s
   `searchSlot` was removed; `WorkspaceTopBar` now keeps only breadcrumb + Stepper, and
   `PatientSearch` survives only because the **patients** page still uses it):
   (A) **Name typeahead** — typing any of Име/Презиме/Фамилия debounces a `searchPatients`
       call (backend `q_kind='name'`, trigram fuzzy, transliteration-aware) and shows a
       dropdown of `PatientResultRow`s. Names are NOT unique and the match is fuzzy, so a
       pick is **ambiguous** → clicking a row opens `PatientLoadConfirmModal` (Зареди данни /
       Отказ) rather than loading directly. **[Зареди данни]** loads the full record (incl.
       allergies + chronic_conditions for the drug-safety engine); **[Отказ]** keeps the
       typed name and reopens the dropdown. This is the ONLY path that confirms before load.
   (B) **Full ЕГН → instant auto-load** — typing a complete valid 10-digit ЕГН derives
       DOB/gender/age locally (`dobFromEgn` / `genderFromEgn` / `ageFromBirthDate`, no network)
       AND fires the backend exact-hash lookup. If it resolves to an existing patient the full
       record auto-loads **IMMEDIATELY — no match dropdown, no click** (mirrors standard
       Bulgarian systems: type the 10-digit ЕГН, the patient autofills). No match → new patient
       with that ЕГН (derived fields already shown). The safety backstop is that the loaded
       name (Име/Презиме/Фамилия) appears instantly, so a mistyped ЕГН surfaces the wrong
       patient's name for the doctor to catch before recording. (The name typeahead still
       renders `PatientResultRow`; the ЕГН path no longer renders a row at all.)
   All ЕГН input logic is encapsulated in the `EgnField` sub-component — a single plain
   editable input (no masking / reveal link / "Смени" toggle on new-visit; see rule 3) — keyed
   by the loaded patient's id so its lookup stale-guard resets on a patient switch. The loaded-
   patient **clear control** ("× Изчисти") lives on the form (Идентификация banner) and routes
   to `handleClearSelection` (direct `setForm(EMPTY_FORM)`, NOT through the change interceptor —
   so clearing never trips the ЕГН-switch guard and resets dirty state cleanly).

3. **New-visit shows the full ЕГН plainly; the patients page stays masked.**
   `fromPatient()` blanks `national_id` for **all** callers (GDPR: plaintext is NEVER sourced
   from `getPatient`/search). On the **new-visit** form the ЕГН is then shown as a plain
   editable value, sourced two ways:
   - **ЕГН auto-load path** — the doctor typed the ЕГН this session, so `handleEgnMatchLoad`
     re-applies that typed value (already plaintext in their hands by their own action).
   - **Name-typeahead path** — `handlePickFromName` calls the audit-logged `revealNationalId`
     **once** on confirm-load and shows the returned plaintext in the ЕГН field. The confirm
     is the deliberate, logged action that authorizes it; there is **no 30s auto-hide** here.
     Fetch plaintext ONLY via `revealNationalId`, never via `getPatient`/search.
   There is **no** masked-last-4 display, **no** "показване" reveal link, and **no** "Смени"
   toggle on new-visit (all removed). To switch patient: edit the ЕГН (→ rule 4 guard) or
   "× Изчисти" (clears all). **GDPR scope guardrail — plaintext-on-load is NEW-VISIT ONLY.**
   The patients browsing page (`app/(workspace)/app/patients/page.tsx`) keeps masked last-4 +
   manual `RevealEgnButton` + 30s auto-hide — untouched. `RevealEgnButton` still exists for
   that page; new-visit no longer imports it.

4. **ЕГН-switch guard (`components/EgnSwitchGuardModal.tsx`).** Scenario: an existing
   loaded patient (`selected != null`) has unsaved **patient-record** edits
   (allergies/chronic/name/etc., per `changedEditableLabels`) and the doctor changes the
   ЕГН to switch patients. The change is **held** and a save-or-cancel modal lists the
   changed fields. `[Запази]` PATCHes the current patient then proceeds with the swap;
   `[Отказ]` reverts the ЕГН and keeps the edits. **DECISION (reversed — see ⚠ below):**
   on `[Запази]`, the current patient's record edits are PATCHed first (never lost), then
   the swap proceeds onto an empty form carrying only the new ЕГН + its derived DOB/gender;
   `chief_complaint` and `visit_type` are **CLEARED**, not preserved. Changing the patient =
   a fresh visit, applied **uniformly** on both patient-change paths — this guard-save swap
   AND the no-edits ЕГН-invalidation DROP in `handleFormChange`. **⚠ REVERSAL:** this
   overturns the earlier decision that PRESERVED `chief_complaint` + `visit_type` across the
   swap. Reversed for consistency + to remove a cross-patient contamination risk (one
   patient's complaint pre-filling onto a different patient's form). Do **not** "fix" this
   back to preserve — NO path may carry one patient's visit context onto another patient
   (`fromPatient` and `EMPTY_FORM` both blank these fields, and neither swap path re-applies
   them). (Scope: scenario 1 only — an already-loaded patient. The new-patient-draft case is
   intentionally not guarded.)
   **Fires on the FIRST ЕГН divergence** (first delete/add/change), not the second.
   `changedEditableLabels` deliberately **EXCLUDES `birth_date` / `gender`** — they're DERIVED
   from the ЕГН (never user edits) and are not dirty-tracked. Including them caused an
   off-by-one: dropping a digit clears birth_date+gender, which then read as a "change" vs the
   loaded patient on the NEXT keystroke and fired a spurious guard. With them excluded, a
   loaded patient with **unsaved edits** fires the guard the instant the ЕГН first diverges;
   a loaded patient with **no unsaved edits** never fires the guard — instead, once the ЕГН
   stops being a valid 10-digit identity, `handleFormChange` **DROPS** the patient (clears the
   loaded identity AND the visit context, keeping only the in-progress ЕГН so re-typing a
   valid one re-loads). (Derived fields are still PATCHed by `persistPatient`; their exclusion
   from `changedEditableLabels` only affects edit-tracking.)

5. **DEFERRED — not built:** visit/edit *migration* on patient switch ("move edits between
   patients" / "revert wrong-patient edits"). Considered and deliberately not built — it's a
   speculative data-migration UI for a case no doctor has reported. Revisit only if pilot
   doctors ask for it.

# Scribe cold-start recovery + result-page edit persistence (2026-06-01)

Web commit `df3198d` (backend `GET /:id` widened in `39a5036`). `/app/scribe` and
`/app/scribe/result` no longer bounce to `/app/new-visit` on a hard refresh / new tab /
laptop sleep, and the result page now treats the SERVER as the source of truth for the
filed note.

- **Recovery hook (`lib/use-cold-start-recovery.ts`).** When sessionStorage is present,
  both pages render from it unchanged (happy path). When it's GONE, the shared
  `useColdStartRecovery(visitId, page)` hook reads `?visit=<id>` and rebuilds context
  from `GET /api/consultations/:id` → `getPatient(patient_id)`, assembling a
  `PendingVisit`-shaped object so existing components consume it unchanged. A loop-free
  status→destination matrix decides stay/redirect (generated/exported with a note →
  result stays / scribe → result; pending/started/error → scribe; abandoned / no-note /
  no-`patient_id` / unrecoverable fetch → `/app/new-visit` with a one-shot notice).
  `scribe/page.tsx` `onResult` now pushes `/app/scribe/result?visit=<consultationId>`,
  so the result URL ALWAYS carries `?visit=`.

- **Result-page reconcile (Option A).** When `?visit=` is present, the server's
  `extracted_fields` is the SOURCE OF TRUTH. The `tuber_last_result` sessionStorage blob
  — the original pre-edit AI output, written once and NEVER updated with edits — is
  downgraded to an instant-paint fallback: the page paints it for a fast first render,
  then fetches `GET /:id` and OVERWRITES the render `fields` with the server copy. The
  reconcile touches `fields` ONLY, never `original`, so the `chars_changed` baseline
  stays seeded from the AI original (happy-path edit metric unchanged). Fetch failure /
  null note → keep the blob paint (never blank the screen).

- **PhoneMode untouched.** No changes to PhoneMode mount/lifecycle (consultationId set
  once, never reset to null). Verified live 2026-06-01 that the phone-path survives a
  cold-start recovery and still produces a note.

- **Verification (2026-06-01).** Verified LIVE on the deployed env: direct PC recording
  produces a note; phone-path × cold-start recovery produces a note; recovery rebuilds
  patient context in a fresh tab. Verified LOCALLY only: the silent-edit-loss fix below
  (single + multi-field persist; F5 and edit-then-navigate retain edits).

# A3 — processing-failure recovery ("audio is safe, retry") (2026-06-01)

Web commit `e8e7237` (branch `a3-audio-safe-recovery`). When extraction fails
AFTER Soniox has produced a transcript, the scribe page no longer dead-ends the
doctor into re-recording. The backend already persists the transcript and
exposes `POST /:id/retry-extraction` (re-runs ONLY the Claude stage); the
frontend was never wired to it — now it is.

- **lib/api.ts** — `api.retryExtraction(consultationId)` →
  `POST /api/consultations/:id/retry-extraction`; `RetryExtractionResponse` in
  `lib/types.ts`.
- **scribe/page.tsx** — a new `recoverableVisitId` state swaps the in-flow
  record/processing UI for `<RecoveryPanel>`. Set from TWO paths: (1) the
  cold-start recovery effect when `status==='error'` (replaces the old
  "запишете отново" banner), and (2) `reportProcessingError()`, which the
  PcMode/PhoneMode `onError` props now call — it routes a live failure into the
  panel ONLY when a staged `consultationId` is held, otherwise the plain
  `ErrorBanner` (unchanged). Both error props were `onError={setError}`.
- **RecoveryPanel** — primary action calls `retryExtraction`; the retry call is
  the source of truth for recoverability. **200** → row flips to 'generated' →
  navigate to `/app/scribe/result?visit=<id>` and let the result page re-read
  the server note (reuses the tested cold-start path — no client-side note shape
  is assembled). **409** (no transcript / wrong status) → hide retry, offer a
  fresh visit. **502 / network** → keep retry available ("звукът ви е запазен").
- Additive, frontend-only — no backend or migration change. `tsc` clean; no new
  eslint errors (the pre-existing react-hooks debt is unchanged). Verified the
  panel + the 409 and 502 branches live in dev (1 June). **Still pending:** the
  never-lose-a-recording HARDWARE tests (phone disconnect, WebSocket drop) need
  real-device verification.

# Known issues / gotchas

- **⚠ DO NOT "simplify" the result-page edit flush — silent server-side data-loss lurks
  here (fixed 2026-06-01, web commit `df3198d`).** Named failure mode: **stale-closure
  debounce + commit-on-blur.** `EditableField` buffers keystrokes in internal `local`
  state and calls the parent `onChange` exactly ONCE on blur with the whole value — the
  parent does NOT re-render while the textarea is focused. Pre-fix, the debounced
  `flushEdit` was a `useCallback` closing over `fields`, so the `setTimeout(flushEdit, …)`
  captured a closure over the PRE-edit `fields` and the POST persisted the note WITHOUT
  the edit — while the row's `edit_count` still bumped, masking it as success. Lone edits,
  and the LAST edit of every session, were silently lost server-side (multi-edit sessions
  masked it: each edit carried the prior ones forward, only the final vanished). Real
  production data-loss, EXPOSED (not caused) by the cold-start recovery work — recovery
  was the first thing to read the server copy back into the UI. **Fixes that MUST be
  preserved:** (1) `flushEdit` reads `fieldsRef.current` (a ref mirrored from `fields` via
  an effect), NOT a captured `fields`; (2) a flush-on-unmount in the result-page cleanup
  so an edit immediately followed by "+ Нова консултация" / nav-away WITHIN the 1.5s
  debounce is flushed, not dropped (double-flush-guarded via `pendingEditField.current`).
  This also resolves the previously-noted "edit-then-leave-page within the debounce
  window" gap. Backend side: `POST /:id/edit` now gates `edit_count` on the actual write
  (see tubermed-backend/CLAUDE.md).

- **⚠ DEPLOY HAZARD — local-only cross-repo paths ENOENT in production.** The two repos
  share a parent dir locally, so a `require` / `readFileSync` reaching across
  (`../../../tubermed-web/...` from the backend, or the reverse) works locally but
  `ENOENT`s in prod, where Vercel deploys ONLY `tubermed-web` and Railway ONLY
  `tubermed-backend`. This caused a sev-1 backend outage 2026-06-01 (the gazetteer reading
  `ial-inns.json` from the web repo — every consultation crashed). Fix pattern: a synced
  in-repo MIRROR committed into the repo that reads the file at runtime (the other copy
  stays canonical; both update together). `public/` files (e.g. `ial-inns.json`,
  `mkb10.json`) are canonical here and served by Vercel to the browser — fine for the
  frontend, but must NOT be assumed reachable from the backend's filesystem. Flag any
  cross-repo runtime read in review.

- **`uncertain_spans` have no visible result-page UI indicator (pre-existing, NOT a
  regression — confirmed 2026-06-01).** The yellow highlighting on the result page is
  vital-range warnings (`lib/vital-rules.ts`, out-of-normal-range vital VALUES) — a
  SEPARATE system. `uncertain_spans` (AI-unsure-field markers computed by the backend
  validators and persisted in `extracted_fields`) are NOT surfaced to the doctor.
  Decision pending for a future session (safety affordance, possibly lawyer-relevant);
  do NOT fix unprompted. Full detail in tubermed-backend/CLAUDE.md.

- **`app/(workspace)/app/patients/page.tsx` — two pre-existing ESLint errors at lines
  111 / 120 (NOT yet fixed).** `loadPatient` calls `applyPage(...)` (~line 111) but
  `applyPage` is declared as a `const useCallback` *after* it (~line 120) → React-compiler
  lint reports `Cannot access variable before it is declared` (works at runtime since
  `loadPatient` only runs after mount, but the compiler can't prove it) and the paired
  `Compilation Skipped: Existing memoization could not be preserved` on `applyPage` (plus an
  `exhaustive-deps` warning about a missing `applyPage` dep on line 118). These **pre-date**
  the ЕГН-audit-logging work (the audit task's only edit here was adding the `'history_view'`
  arg to one `getPatient` call) and are **out of scope to fix right now** — logged here so
  they're tracked. Fix = hoist the `applyPage` `useCallback` above `loadPatient` (and add it
  to `loadPatient`'s dep array) so the declaration precedes its use.

- **Drop-on-ЕГН-invalidation is gated to `national_id_type === 'egn'` (lnch/foreign NOT
  covered).** The single-predicate drop in `handleFormChange` (rule 4) only drops a loaded
  patient when an **ЕГН** stops being a valid 10-digit identity. A loaded **lnch / foreign**
  patient whose ID is edited to an incomplete/invalid value falls through to the prior
  straight-through apply — its name + bubble persist next to the now-mismatched ID (the same
  stale-identity shape the ЕГН drop fixes). Known gap, deliberately scoped out for now (only
  ЕГН has an auto-load identity key + `dobFromEgn` validity notion). Fix = generalise the
  drop's validity check per id-type (lnch via `validateLnchFormat`, etc.).

- **Dependabot: `postcss` 8.4.31 XSS (CVE-2026-41305 / GHSA-qx2v-qp2m-jg93, moderate, CVSS
  6.1) — DEFERRED, not reachable.** The flagged copy is the one **Next bundles internally**
  (`node_modules/next/node_modules/postcss`) for its build-time CSS compiler — our **top-level
  `postcss` is already 8.5.14 (patched)** and serves the Tailwind/PostCSS pipeline. The vuln is
  a `</style>`-breakout XSS that only triggers when **untrusted CSS** is run through `postcss`
  and the re-stringified output is embedded in served HTML; **not reachable here** — all CSS is
  author-written Tailwind compiled at build time (exactly the bundler use-case the advisory says
  is *not* the impact target). **DECISION: DEFERRED** — not reachable, not worth Next-16
  build-pipeline risk to chase. Fix options when revisited: **(B, preferred)** npm override
  `{"overrides":{"postcss":">=8.5.10"}}` then `next build` to confirm Next's compiler accepts
  postcss 8.5.x; **(A)** bump `next` to ≥16.3 stable **+ `eslint-config-next` in lockstep**
  (build-touching). **NEVER run `npm audit fix --force`** — it "fixes" by installing `next@9.3.3`,
  a 16→9 major downgrade that destroys the app.
