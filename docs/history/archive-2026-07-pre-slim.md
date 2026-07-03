# Archive — pre-slim AGENTS.md evergreen detail (moved verbatim 2026-07-03)

Verbatim pre-slim versions of the ЕГН-workflow and Known-issues sections that AGENTS.md now states in condensed form. Dated session write-ups live in 2026-06.md / 2026-07.md.

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
   a loaded patient with **no unsaved edits** never fires the guard — instead, once the ID
   stops being **valid for its `national_id_type`** (P1-02, 2026-06-18 — ALL id types, not
   just ЕГН: egn = 10 digits + DOB + checksum, lnch = 10 digits, foreign = non-empty, none =
   n/a; via `shouldDropLoadedPatient` in `lib/national-id.ts`), `handleFormChange` **DROPS**
   the patient (clears the loaded identity AND the visit context, keeping only the in-progress
   ID so re-typing a valid one re-loads — ЕГН auto-loads). A save-time last4 guard in
   `handleSaveDraft`/`handleStartVisit` is the backstop for a valid-but-different id. (Derived
   fields are still PATCHed by `persistPatient`; their exclusion from `changedEditableLabels`
   only affects edit-tracking.)

5. **DEFERRED — not built:** visit/edit *migration* on patient switch ("move edits between
   patients" / "revert wrong-patient edits"). Considered and deliberately not built — it's a
   speculative data-migration UI for a case no doctor has reported. Revisit only if pilot
   doctors ask for it.


# Known issues / gotchas

- **Break-it audit (2026-06-13) — `AUDIT-FINDINGS-2026-06-13.md` (repo root, web
  commit `2420030`).** Findings-only whole-codebase safety / security audit (1 P0,
  9 P1, 10 P2, 7 P3; byte-identical report in both repos; no code changed).
  Web-relevant items still open — full repro / detail in the report (do NOT copy
  it here):
  - **[P1-01] ЕГН decodes to an impossible age (226 / 127).** `lib/egn.ts`
    `dobFromEgn` maps months 21–32 to the 1800s and there is NO plausibility bound
    front or back — a one-digit month typo silently flips the century 100 years.
    The checksum fix (above) killed the "invalid-shown-as-valid" half; this
    implausible-age sibling survives (correctable via PATCH → P1, not data-loss).
    Fix = a `validateEgnPlausibleAge` bound on `canSubmit` (and backend). **Backend
    half DONE (2026-06-18 — hard 400 on POST + PATCH, ЕГН + `birth_date`; see the
    "Backend safety gates this session" section + tubermed-backend P1-01). The
    `canSubmit` mirror is the remaining WEB TODO** — `dobFromEgn` still returns a
    valid date for a pre-1900 decode, so the client doesn't block it.
  - **[P1-03] ✅ RESOLVED backend-side (2026-06-18) — stale patient-summary cache.**
    Was: backend `POST /:id/edit` never NULLed `patient_summary`, so reopening
    `PatientSummaryModal` (`load(false)`) served the PRE-edit summary → wrong-dose
    take-home. Backend now NULLs the cache on `/edit` AND `/retry-extraction` (both
    `extracted_fields` writers — see the "Backend safety gates this session" section
    + tubermed-backend P1-03), so `load(false)` reopen REGENERATES fresh; the modal
    needs NO web change. Web-side hazard closed.
  - **[P1-02] ✅ RESOLVED (2026-06-18) — stale-loaded-patient drop now covers ALL
    id types** (was ЕГН-only → a mismatched ЛНЧ/foreign id left the loaded patient
    pinned = wrong-patient-filing hazard). `handleFormChange` drops via
    `shouldDropLoadedPatient(type, id)` (`lib/national-id.ts` `isValidIdForType`,
    mirroring the backend per-type rules) + a save-time last4 mismatch guard. See
    the resolved known-issue below.

- **Patient-summary 429s are surfaced in the UI (done — `89f6f70`, `f970cd6`).** `lib/api.ts`
  `patientSummaryLimitFromError(err)` classifies a 429 `ApiError` whose body `code` is
  `patient_summary_daily_limit` or `patient_summary_regen_cooldown` (else `null` → generic
  error). `PatientSummaryModal` renders the backend's Bulgarian message as a CALM notice
  (`--color-accent-soft` / `--color-ink`, `role="status"` — not the red error block): a
  `phase:'notice'` block on first-open daily-limit, or an inline banner on a regenerate-429 that
  **preserves the on-screen summary + unsaved edits** (the `catch` returns without touching
  `phase`/`draft`). A `regen_cooldown` also disables „Регенерирай" for `retry_after_seconds`
  (clamped ≤120 s, default 60 s; timer cleared on close + unmount). Wording is single-sourced
  from the server `error`. Success / cache-hit path unchanged. Backend contract:
  `tubermed-backend/CLAUDE.md` (2026-06-15, B5).

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

- **`uncertain_spans` ARE NOW surfaced on the result page (A2, 2026-06-18 — see that
  dated section above; the earlier "no visible UI indicator" gap is CLOSED).** They
  render inline as amber dotted `uncertain-mark` highlights and fold into the unified
  review counter (`lib/uncertain-spans.ts` `resolveUncertainSpans` + `EditableField`'s
  `ai-uncertain` kind). ADVISORY — no new approval gate. Still THREE separate systems,
  do not conflate: red/gold **vital-range** warnings (`lib/vital-rules.ts`,
  out-of-range vital VALUES), the new amber **AI-uncertainty** spans, and **source
  traceability** („виж източника", objective transcript grounding). The
  `osnovna_diagnoza` uncertain-span (P0-01b) is de-duped against the `mkb_review`
  banner rather than rendered (no `EditableField` surface for the diagnosis); any future
  span surface for `osnovna_diagnoza` / meds / comorbidities should align its copy with
  `mkbReviewCopy`. Full detail: tubermed-backend/CLAUDE.md (backend validators) + the A2
  dated section above.

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

- **✅ RESOLVED (P1-02, 2026-06-18) — stale-loaded-patient drop is now ALL id types.**
  Was: the `handleFormChange` drop (rule 4) only fired when an **ЕГН** stopped being a
  valid 10-digit identity; a loaded **ЛНЧ / foreign** patient whose ID was edited to an
  invalid/mismatched value fell through to a straight apply — name + bubble pinned next
  to the wrong ID (a wrong-patient-filing hazard). **Fix:** new pure `lib/national-id.ts`
  `isValidIdForType(type,id)` / `shouldDropLoadedPatient(type,id)` mirroring the backend
  per-type rules (egn = format + derivable DOB + checksum [the strict client gate];
  lnch = `/^\d{10}$/`; foreign = non-empty; none = never drops on this basis — same
  cross-repo parity as `lib/egn.ts` ↔ `national-id.js`). The drop predicate is now
  type-agnostic; the HOLD branch (unsaved-edits guard) was already type-agnostic, so
  ЛНЧ/foreign get the same hold-then-drop as ЕГН (egn behaviour byte-preserved — the egn
  case of `isValidIdForType` === the old `egnStillValid` check). **Belt-and-suspenders:**
  `handleSaveDraft` / `handleStartVisit` refuse to save when the form id's last4 no longer
  matches the loaded `selected.national_id_last4` (`idLast4` mirrors backend `last4`) —
  catches a valid-but-DIFFERENT ЛНЧ/foreign id (those don't auto-load); only a NON-EMPTY
  mismatch blocks, so the post-load/post-save (fromPatient-blanked) id field isn't a false
  positive. Test `scripts/national-id.ts` (28); tsc + build clean.

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

