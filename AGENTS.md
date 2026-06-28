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

# Git workflow — work on `master`, no feature branches

All work lands directly on **`master`**, one commit per change; Dimitar reviews the
diff and **pushes** (never push yourself, never `--force`). If a task prompt says to
create or branch off a feature branch, **ignore that and work on `master`** — it's the
standing repo convention, not a per-task choice. Stage only the files you changed
(`git add <file>`, never `-A`).

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

# A2 follow-up — editable patient after-visit summary (2026-06-01)

`components/PatientSummaryModal.tsx`. The generated summary body is now an
editable `<textarea>`; the doctor can fix wording / add / remove text before
copy / print. The mandatory disclaimer is SPLIT OFF (`splitSummary`, keyed on
the marker `не замества медицинска консултация`) and rendered as a FIXED,
non-editable footer that `composeFinal` always re-appends to the copied /
printed text — a free edit can never drop it, preserving the same
code-controlled-invariant guarantee the backend enforces
(`tubermed-backend/lib/patient-summary.js`). `DISCLAIMER_FALLBACK` mirrors the
backend string and is used ONLY if a loaded summary somehow carries no
disclaimer.

- Edits are SESSION-LOCAL: they shape the copy / print / PDF output but are NOT
  persisted to the server. "Регенерирай" (confirm-guarded when edited) and
  closing+reopening the modal both restore the generated text from the cached
  server copy (`consultations.patient_summary`). Persisting edits would need a
  new PATCH endpoint — deliberately out of scope; revisit if pilots ask for it.
- Copy / print are disabled on an empty body. Additive, frontend-only; tsc clean.

# Bug 3 — negation-aware drug-safety matching (2026-06-02)

`lib/drug-safety.ts`. The `drug-diag` rules (NSAID→PPI, beta-blocker→asthma, …)
and the allergy rules previously matched conditions with a raw
`text.includes(term)`, which is **negation-blind**: a diagnosis/allergy token
fired even when the doctor explicitly RULED IT OUT — the canonical failure was
the NSAID→PPI warning firing on `"няма оплаквания за гастрит"`. Matching now goes
through an **`assertedIncludes(text, term)`** helper: a token counts only when it
is ASSERTED — i.e. NOT preceded, *within its own clause*, by a Bulgarian negation
cue (`няма`, `без`, `не `, `не е`, `отрича`, `отсъствие на`, `липсва`,
`изключен`, `не се установяв`, `не съобщава за`, …).

- **Clause-scoped:** a negation in a PRIOR clause must not suppress a later
  asserted mention (the probe only looks back to the start of the current
  clause/sentence). The `не ` cue is space-anchored so a `-не` suffix (e.g.
  `оплакване`) can't masquerade as the negation `не`.
- **Conservative:** only the disease/allergen token is gated, so an asserted
  condition (`"пациент с гастрит"`, an MKB code like `K25`, `"алергия към
  пеницилин"`) still fires; a prescription is never negated. Applied to BOTH the
  drug-diag path and the allergy path (`"няма алергия към пеницилин"` no longer
  fires). `text`/`term` are pre-lowercased by the `build*` helpers.
- **Regression:** `scripts/drug-safety-negation.ts`, run via
  `npx tsx scripts/drug-safety-negation.ts`. The web repo still has **no
  unit-test runner**, so drug-safety logic regressions live as standalone
  `npx tsx` scripts.

# Bug 1 — МКБ-10 diagnosis UX (result page) (2026-06-03)

`app/app/scribe/result/page.tsx` (`DiagnosesSection`) + `components/MkbTypeahead.tsx`
+ `lib/diagnosis.ts` + `lib/mkb10.ts`. Backend contract: `tubermed-backend/CLAUDE.md`
("МКБ-10 code-validity gate").

- **Recorded/displayed diagnosis = the official МКБ term** for a valid code
  (doctor says "първична хипертония" → model emits `I10` → the note shows
  **"Есенциална [първична] хипертония"**), via `filedMainTerm` / `filedComorbidityTerm`
  in `lib/diagnosis.ts` (`osnovna_mkb_term` / comorbidity `mkb_term` wins, spoken
  fallback). The old **"ПО МКБ-10: …" line is removed** — the term IS the displayed
  value; a parent-accepted code shows a subtle "категория по МКБ-10" hint.
- **"доктор каза: …" cue.** Subtle grey line under the main diagnosis, shown **only
  when** the doctor's spoken wording (the immutable `original` blob's
  `osnovna_diagnoza`) meaningfully diverges from the official term.
  `spokenDivergesFromOfficial` treats a contained rewording ("първична хипертония"
  ⊂ "Есенциална [първична] хипертония") as a match (no cue) and a genuine mismatch
  ("навехнат глезен" vs "Контузия на глезена") as a divergence (cue — the wrong-code
  catch). `divergence_advisory` is **never surfaced**.
- **Inline МКБ typeahead (`MkbTypeahead`).** Client-side search over the loaded
  `public/mkb10.json` — matches on **term OR code**, no API / backend round-trip;
  picking sets code + official term together (so a filed diagnosis can't be
  free-text hallucination). Used for the **main diagnosis** and for **changing an
  existing comorbidity**; the 🔍 still opens the full `MkbPicker` modal for
  chapter/pinned browse.
- **"+ Добави" opens the `MkbPicker` modal directly** (target `{ kind: 'co-add' }`
  → `applyMkbPick` → `addComorbidity`), NOT an inline row. Cancel/close adds **no
  empty row**. **Max 4 comorbidities** — "+ Добави" greys out at 4 (matches the
  backend STEP 2 contract + the `/edit` server clamp).
- **Main-diagnosis code copy** button (bare code, e.g. `I10`) reuses the per-section
  `CopyButton` "copied ✓" pattern, gated on `isLocked` like the other copies
  (enabled after approval). Comorbidity-code copy deferred.
- **Pre-approval editing is ALWAYS enabled.** `isLocked` (`= reviewStatus !== 'confirmed'`)
  gates ONLY copy / export / approve — **never editing**. The typeahead, "+ Добави",
  change/remove, and the text/meds fields are all editable before approval; an
  invalid/missing code blocks ONLY approve + export, and the doctor clears it by
  picking a valid code (re-validates server-side via `/edit`). **Do NOT re-gate
  diagnosis editing on `isLocked`** — that was the reconcile DEADLOCK (could neither
  edit the code nor approve).
- **Deterministic, no API.** Exporters (`lib/exporters.ts` via `lib/diagnosis.ts`)
  file the official term; client validity/parity (`resolveMkb` / `isValidMkb` in
  `lib/mkb10.ts`, mirroring the backend parent-accept rule) is pure over the loaded
  nomenclature. Logic regressions: `npx tsx scripts/diagnosis-term.ts` +
  `scripts/mkb-validity.ts`.

# Public marketing landing (2026-06-04)

The public landing was rebuilt and given an "alive & smooth" motion pass. It is
**landing-only** — none of it touches the workspace/clinical app. Source of
truth: `app/page.tsx`.

- **Structure.** `app/page.tsx` (server component) composes `components/landing/*`
  in order: `Header` → `Hero` → `TrustStrip` → `Problem` → `Calculator` →
  `HowItWorks` → `WhyTuberMed` → `Comparison` → `Marquee` → `AuthorTrust` →
  `Security` → `Pricing` → `Faq` → `FinalCta` → `Footer`. Motion primitives:
  `Reveal` (framer-motion `whileInView`, once), `AmbientOrbs`, `MagneticCta`,
  `Parallax`, `ScrollProgress`, `LenisProvider`; the hero is
  `TuberMedHeroDesktop`; shared bits in `brand.tsx` / `ui.tsx`. Second landing
  route: `app/privacy/page.tsx`.
- **Deps (landing-only).** `framer-motion` + `lenis` — used ONLY in landing
  client islands. Deliberate, scoped exception to the earlier "CSS-first, no
  Framer Motion" stance; do NOT pull either into the workspace app.
- **⚠ Landing tokens (`--lp-*`) and workspace tokens (`--color-*`) are SEPARATE
  SETS.** `app/globals.css` defines a landing-only `--lp-*` Navy token set
  (`#274C77` / `#1D3B5C` / `#4F8FBF` / `#8FC0E8`) scoped under the `.lp` wrapper
  on the landing root. As of 2026-06-13 the workspace `--color-*` VALUES were
  shifted into the same brand-navy family (`#274C77` kit — accent/brand
  `#274C77`, ink/brand-dark `#142740`, navy rail `#1B2D49`) so the app reads
  on-brand with the landing. But the two token SETS stay deliberately distinct:
  `--lp-*` is landing-only, `--color-*` is the app's. **Do NOT "unify" the two
  sets / merge the variable names** — aligning their VALUES to the brand is
  intentional; collapsing `--lp-*` and `--color-*` into one set is not.
- **Fonts (landing-only).** Inter Tight (display/wordmark) + self-hosted Golos
  Text (hero in-mock body) via `next/font` (`lib/landing-fonts.ts`), applied only
  on the landing — the workspace font payload is unchanged. A Google-Fonts
  `@import` in the hero component was REMOVED on purpose: it fetched from
  fonts.googleapis.com at runtime, leaking the visitor IP to the US and
  contradicting the page's own EU / no-US-transfer claim. Keep fonts self-hosted.
- **⚠ Lenis is mounted ONLY on the landing routes.** `LenisProvider` runs in
  `app/page.tsx` + `app/privacy/page.tsx`, NEVER the root layout — so the
  logged-in workspace app's scrolling is unaffected (it tears down on nav away).
  Do NOT move it to the root layout.
- **Motion guardrails (conventions).** `prefers-reduced-motion` HARD-STOPS
  everything: Lenis off, hero shows a static end-frame, and orbs / marquee /
  reveals / parallax / count-up all disabled. Motion also pauses when off-screen
  (IntersectionObserver) and when the tab is hidden (`visibilitychange`). No
  scroll-jacking (Lenis smooths native scroll; anchors + keyboard still work).
  **The hero waveform is driven by `requestAnimationFrame` writing
  `transform:scaleY` to bar refs — NOT React state per tick** (the per-tick
  `setState` re-rendered the whole hero mock and caused top-of-page jank; do NOT
  reintroduce it). `AmbientOrbs` use a baked radial-gradient on their own
  composited layer — NO animated `filter:blur()` (it re-rasterizes every frame).
- **Hero fidelity.** `TuberMedHeroDesktop` mirrors the real product: the
  recording screen matches `/app/scribe` PcMode (label → waveform → 80px mic
  button → mono timer → status), and the result screen + the section-7
  `AuthorTrust` note follow the real `/app/scribe/result` order (its `NAV_ITEMS`)
  — **diagnosis first**. Loops continuously; mobile / reduced-motion render a
  static readable end-frame. There is a marked swap-in point for a real
  anonymized `<video>`.
- **Lead form.** `AccessForm` POSTs to the backend directly —
  `fetch(`${NEXT_PUBLIC_BACKEND_URL}/api/pilot-leads`)`, a plain fetch, NOT the
  authed `lib/api.ts` wrapper (the endpoint is public). Honeypot field + required
  consent checkbox; field values are kept on error.
- **`/privacy`.** Placeholder structure only, `robots: { index: false }`; flagged
  TODO for the real legal copy — do NOT auto-generate legal text.

# A4 — self-serve signup + email login (2026-06-11)

Invite-gated self-serve registration next to the untouched org/PIN flow.
Backend contract: `tubermed-backend/CLAUDE.md` (routes/auth.js row + migration
014). **Migration 014 must be applied and `SIGNUP_INVITE_CODE` set on the
backend before the happy path works** — until then both new paths surface a
clean Bulgarian 503 in the UI (verified live in dev).

- **`app/signup/page.tsx`** (route `/signup`, top-level — outside the
  `(workspace)` auth gate, like `/app/login`). Bulgarian form: Име / Имейл /
  Парола (≥10 знака, client-checked before POST) / Име на практиката (по
  избор) / Код за достъп. Mirrors the login page exactly: same workspace
  `--color-*` tokens + local Field/Input/Wordmark helpers (deliberately
  duplicated — login keeps its own private copies), `setSession` storage,
  `router.push('/app/new-visit')`. NO landing `--lp-*` tokens / framer-motion /
  Lenis. Backend errors surface honestly; the 503 body literal
  `signup_disabled` is translated to Bulgarian in the page, everything else
  (403 wrong code, 409 duplicate email) is already user-facing Bulgarian.
- **`app/app/login/page.tsx`** — segmented Имейл / Клиника + ПИН switch.
  "Имейл" is the DEFAULT tab (self-serve is the forward path); the ПИН tab
  keeps the original three fields and submit payload untouched, one click
  away. Errors clear on mode switch. Cross-links: login "Нямате акаунт?
  Регистрация" → `/signup`; signup "Вече имате акаунт? Вход" → `/app/login`.
- **`lib/api.ts`** — `api.signup(SignupPayload)`; `api.login()` widened to
  `LoginPayload | EmailLoginPayload` (additive). Both return `LoginResponse` —
  the backend responds with the byte-identical shape on all three auth calls,
  so session handling is one code path.
- **Dev gotcha:** the backend's dev CORS allowlist is `http://localhost:3000`
  ONLY — run the web dev server on :3000 (and the backend on :4000 per
  `.env.local`), or every API call fails preflight with a network-level error.

Auth UX polish (2026-06-11, follow-up session — frontend-only):

- **`components/PasswordInput.tsx`** — shared hold-to-reveal password field
  (signup password + confirm, login email-mode password; the 6-digit PIN field
  deliberately keeps the plain masked Input). Pointer press-and-hold reveals
  (mousedown/touchstart `preventDefault` so the button never steals focus from
  the input); Space/Enter TOGGLES for keyboard users; `aria-pressed` +
  `aria-label="Покажи паролата"`; `type="button"`. Styling mirrors the pages'
  local Input helper byte-for-byte.
- **Confirm-password (signup only).** "Повтори паролата" errors
  ("Паролите не съвпадат") on confirm-BLUR and on submit (blocking it) — never
  while typing; the change handlers only CLEAR a shown error once values match.
  The confirm value is client-side only — the signup request body is unchanged
  (verified by fetch interception: keys are exactly invite_code/name/email/
  password [+org_name when filled]).
- **"Запомни ме" (login both modes + signup, `components/RememberMe.tsx`).**
  `setSession(s, remember = true)` in lib/api.ts: checked (default — the prior
  behavior) → localStorage; unchecked → sessionStorage (dies with the browser
  session). Each write clears the OTHER location; `getSession` reads both;
  `clearSession` (logout) wipes both. Token access is fully centralized in
  these three helpers — keep it that way (no direct `tuber_auth` reads
  anywhere else). The JWT + its 30-day expiry are untouched.

# Login/signup auto-forward (2026-06-11, follow-up session)

An already-authenticated doctor opening `/app/login` or `/signup` is forwarded
into the workspace instead of seeing the form. On mount both pages read the
token via `getToken()` (covers both Запомни ме storage modes) through a
hydration-safe `useSyncExternalStore` (server snapshot `false` — the
logged-out static prerender stays byte-identical), then VALIDATE with
`GET /api/auth/me` before forwarding: 200 → `router.replace('/app/new-visit')`
behind a neutral background (no form flash); 401 → `clearSession()` + form
(dead token can't shadow the next login); network/5xx → form, session KEPT
(never block login on a failed probe). Loop-free with the workspace guard.
Related fix: `lib/use-cold-start-recovery.ts` carves 401 out of its
catch-all — `clearSession()` + `/app/login` (other failures keep the
new-visit + notice behavior). All invalid-token bounces now clear storage
(scribe `me()` probe, PcMode `onAuthError`, recovery hook, logout).

# A4 onboarding — first-run wizard + spotlight tour (2026-06-11)

A new self-serve doctor lands in the workspace and gets a once-ever, fully
skippable first-run flow. Backend contract: `tubermed-backend/CLAUDE.md`
(migration 015 + the `/me` endpoints). **Needs migration 015 applied** —
until then nothing shows anywhere (see the trigger contract below).

- **Trigger (`app/(workspace)/app/new-visit/page.tsx`):** the page fetches
  `/me` once on mount and opens `components/OnboardingWizard.tsx` ONLY when
  `onboarding_completed_at === null` EXPLICITLY. An ABSENT key (backend
  migration 015 unapplied — the degraded `GET /me` OMITS the onboarding keys
  rather than nulling them) or a failed fetch means "unknown" → nothing
  renders. This is load-bearing: null-on-degradation would nag every existing
  doctor with a wizard whose close-PATCH can't persist. Existing doctors are
  also backfilled as onboarded by the migration itself.
- **⚠ The wizard has NO backdrop click-to-close — deliberate bug fix
  (2026-06-11, observed live by Dimitar).** Mechanism: browsers fire `click`
  on the nearest COMMON ANCESTOR of the mousedown and mouseup targets, so
  selecting/clearing text in a wizard input with a mouse drag that releases
  outside the card landed a `click` whose target was the backdrop — the old
  `onClick={() => finish(false)}` then closed the wizard AND permanently
  marked onboarding complete (finish() PATCHes by design — the doctor could
  never see the wizard again). The wizard closes ONLY via its explicit
  controls (Пропусни / Не сега / Esc / Започни). Do NOT reintroduce a
  backdrop close here; any modal WITH text inputs needs mousedown+mouseup
  both-on-backdrop tracking if it ever wants one. (PatientLoadConfirmModal
  keeps its backdrop close — no text inputs, the latent drag case is
  irrelevant there.)
- **Wizard (3 steps):** welcome → optional profile (Специалност via
  `SpecialtyTypeahead`, Място на работа prefilled with `organizationName`,
  three-band 'Среден брой прегледи на месец' segmented control — backend
  migration 016, `consultations_band` ∈ under_100/100_200/over_200,
  tap-again-to-deselect; "Продължи" PATCHes only what was filled; step-2
  "Пропусни" skips the save but still offers the tour) → tour offer.
- **Welcome visual (polish session):** step 1 carries a navy-gradient band
  with the white mark from `/public/brand` + a pure-SVG waveform — local
  assets only, zero third-party origins (verified). The `welcomeMedia` prop
  on OnboardingWizard is the marked slot for the real photo/video Dimitar
  will supply (replaces the default band wholesale, same 152px frame).
- **⚠ Esc handling gotcha (Next App Router specific, found live):** React
  hydrates the WHOLE document here, so React's delegated listeners sit ON
  `document` — the same node as any manual `document.addEventListener`. A
  React handler's `stopPropagation()` therefore can NEVER shield a manual
  document-level listener (same-node listeners always run; only further
  nodes are stoppable). Convention: a component that consumes a key calls
  `preventDefault()`, and document-level handlers skip
  `e.defaultPrevented` events — that's how closing the SpecialtyTypeahead
  dropdown with Esc stopped also closing the wizard. EVERY exit path (Пропусни step 1,
  Esc, backdrop click, Не сега, Започни) fires
  `PATCH /api/auth/me { onboarding_completed: true }` exactly once —
  server-side first-write-wins makes it once-ever even across devices.
  "Започни" fires the PATCH BEFORE starting the tour: the tour is purely
  visual, closing it calls nothing.
- **Spotlight tour (`components/SpotlightTour.tsx`):** in-repo, NO new deps
  (no react-joyride; framer-motion stays landing-only). The spotlight is a
  positioned rounded div whose oversized `box-shadow: 0 0 0 9999px` dims
  around the target's `getBoundingClientRect()`; anchors are `data-tour`
  attributes ("egn" on the Идентификация SectionCard via its new optional
  `dataTour` prop, "visit-context" on a layout-neutral wrapper around
  VisitType+ChiefComplaint, "start" on the Започни запис button, "today" on
  the rail div in the page). Напред/Пропусни + dots; Esc + overlay-click
  close; resize/scroll re-measure; a missing anchor skips its step. All
  measurement runs inside rAF/event callbacks — the react-compiler
  `set-state-in-effect` rule forbids synchronous setState in effect bodies,
  and render-time ref writes are banned too (`react-hooks/refs`).
- **Signup slimmed:** the "Име на практиката" field is gone from `/signup`
  (backend falls back to the doctor's name; the wizard's Място на работа is
  where the practice gets named via `PATCH /me org_name`).
- **lib/api.ts:** `MeResponse` (onboarding keys OPTIONAL — see trigger
  contract), typed `api.me()`, new `api.updateMe()`.

# Canonical app domain (2026-06-11)

ONE Vercel project answers on THREE hosts: `www.tubermed.com` + apex
`tubermed.com` (marketing) and `app.tubermed.com` (the product). The backend
CORS allowlist trusts ONLY `https://app.tubermed.com`, and sessions live in
per-origin storage — so an app page opened on www RENDERS but every API fetch
dies in preflight (observed live 2026-06-11: doctor lands on www, clicks
Вход, product looks broken), and allowing both origins instead would split
logins. **Decision: `app.tubermed.com` is the one canonical app origin. Do NOT
"fix" www breakage by adding www to the backend CORS allowlist.**

- **Where the redirects live:** `next.config.ts` `redirects()` —
  host-matched (`has: [{ type: 'host', … }]`, one entry per marketing host;
  Next host matchers take a single value, not alternation) permanent 308s for
  `APP_PATHS` (`/signup`, `/app/:path*`) to `https://app.tubermed.com` with
  path + query preserved. Landing routes (`/`, `/privacy`, `#anchors`) stay on
  www/apex; the host matcher keeps `app.tubermed.com` itself redirect-free.
- **RULE: a NEW app/auth route OUTSIDE `/app/*` must be added to `APP_PATHS`**
  (for both hosts automatically — the list is host×path flatMapped). Routes
  under `/app/*` are already covered. `/mobile` is deliberately absent — the
  QR phone page is served by the BACKEND (Railway `routes/sessions.js`), it is
  not a route in this app.
- Landing links to the app may stay same-origin relative (`/app/login` in
  Header/Footer) — the redirect catches them on www. Audited 2026-06-11: no
  absolute-www or protocol-relative links exist; the only absolute URLs are
  the `app/layout.tsx` metadata already pointing at the app origin.
- Verified via `next build` + `next start` with spoofed `Host:` headers (308 +
  exact Location on www/apex incl. `?visit=` passthrough; 200 no-redirect on
  app host / localhost / landing paths). Real-DNS behavior needs a post-deploy
  check on the live domains.
- **For Dimitar (out of scope here):** long-term cleanup is making www serve
  ONLY the landing — a Vercel project/domain config decision, not code.

# Branded auth panel — shared AuthBrandPanel (2026-06-12)

The dark-navy left panel on `/app/login` and `/signup` (previously duplicated
plain-text markup in each page) is now ONE shared component,
`components/AuthBrandPanel.tsx` — both pages render it identically; edit it
there, never re-fork per-page copies. Composition: quiet navy gradient
(anchored on `--color-nav-bg`, shading toward the wizard WelcomeBand's family
navies) + monogram tile + live-text "TuberMed" lockup + tagline + the static
waveform motif + the GDPR line with an inline shield glyph. Static — no
animation, so nothing to gate on `prefers-reduced-motion`; zero network
fetches (verified: only origin loaded on either page is the app's own).

- **`AuthTileMark` is a deliberate workspace-local COPY of the landing
  `TileMark`** (`components/landing/brand.tsx`) — auth must not import landing
  code. Gradient id renamed `lpTileGrad` → `authTileGrad` so both tiles can
  coexist in one document. If the mark changes, update BOTH copies. The lockup
  follows the brand.tsx approach (tile inline SVG + live wordmark text — the
  `/public/brand` lockup SVGs use `<text>` in Inter Tight, which falls back to
  a generic font via `<img>`); the workspace has no Inter Tight, so the
  wordmark uses `--font-ui`.
- The pages' local `Field`/`Input`/`Wordmark` helpers and the mobile header
  are untouched (the panel stays `hidden md:flex` — mobile keeps the compact
  logo header). Forms/flows byte-identical; verified live: PIN tab
  click-through, signup render, both pages serve a byte-identical `<aside>`.

# Caret fix on password reveal + wizard no-show diagnosis (2026-06-12)

- **`components/PasswordInput.tsx` — caret/selection preserved across the
  reveal type swap.** Swapping `<input type>` between `password`/`text`
  RESETS the selection in some browsers (Firefox collapses it to 0 — observed
  live: pressing the eye mid-word moved the caret to the FRONT and continued
  typing inserted at the start). Pattern: every toggle path (mousedown
  reveal, mouseup/leave/touchend hide, keyboard Space/Enter toggle) goes
  through `setRevealedPreservingCaret`, which captures
  `selectionStart/End/Direction` BEFORE the state change; a `useLayoutEffect`
  keyed on `revealed` restores them via `setSelectionRange` AFTER the
  re-rendered type swap commits, before paint. `setSelectionRange` does not
  move focus, so the keyboard path (focus on the button) is safe. The reset
  did NOT reproduce in headless Chromium (it preserves selection natively —
  the restore is a no-op there); verified post-fix in the harness: caret
  holds through hold-type-release-type, a shift+arrows selection survives
  both swap directions, keyboard toggle keeps the input caret.

- **Wizard no-show (fresh account, 2026-06-12) — trigger logic verified
  CORRECT; cause is the migration-015 backfill timing.** The show-trigger in
  `app/(workspace)/app/new-visit/page.tsx` depends ONLY on
  `onboarding_completed_at === null`; regression-tested live against a
  mocked `/me` serving the exact shape deployed during the report (pre-016
  backend + 015 applied: `onboarding_completed_at: null` +
  `avg_monthly_consultations`, `consultations_band` ABSENT) — the wizard
  OPENS; a timestamp or an absent key correctly shows nothing. An account
  created after migration 014 but BEFORE the 015 apply counts as "existing"
  and gets STAMPED onboarded by 015's backfill — that is the likely no-show
  cause. Reset a test doctor with
  `UPDATE doctors SET onboarding_completed_at = NULL WHERE email = '...';`.
  The deployed pre-016 `PATCH /me` IGNORED unknown fields (no 400) — the
  wizard's `consultations_band` was silently dropped, not rejected; resolved
  by the 016 + backend-push alignment (2026-06-12).

- **Wizard step-2 profile PATCH failures are now surfaced** (were silently
  swallowed and the wizard advanced as if saved): an inline Bulgarian
  `role="alert"` line shows under the fields, the wizard STAYS on step 2 so
  Продължи retries, and Пропусни still skips the save. The completion PATCH
  (`onboarding_completed: true`) stays best-effort/silent by design.

# SpotlightTour — input lockdown + conditional auto-scroll (2026-06-12)

`components/SpotlightTour.tsx`, two refinements; look and step content
unchanged. While the tour is open the ONLY interactive things are the
tooltip's controls and Esc.

- **Clicks:** the full-viewport catcher now SWALLOWS every click — including
  inside the spotlight cutout (the box-shadow spotlight div is
  pointer-events:none, so the catcher is what any click lands on). It
  previously ADVANCED on any click; do not reintroduce that. Its mousedown is
  preventDefault'ed so a stray click can't pull focus out of the tooltip.
- **Scroll lock:** the workspace scrolls the DOCUMENT (AppShell is
  min-h-screen flex — no inner overflow container), so the lock is
  `overflow:hidden` on `<html>`, restored exactly on close (inline value +
  scroll-position belt). Wheel/touchmove are blocked via NATIVE non-passive
  listeners on the overlay root — **React root wheel/touch listeners are
  passive; a React onWheel preventDefault is silently ignored** (same class
  of gotcha as the Esc handshake). Scroll keys are swallowed at document
  level when focus is outside the tooltip.
- **Focus trap:** focus moves to the primary button ONCE PER STEP (guarded by
  a ref — rect re-measures on scroll/resize must not re-steal focus) and Tab
  cycles within the tooltip's buttons. The overlay root stays MOUNTED between
  steps (rect=null only hides spotlight+tooltip) so the lockdown never blinks.
- **Esc:** adopts the `!e.defaultPrevented` handshake (the OnboardingWizard
  convention). Wizard untouched; the Esc-in-SpecialtyTypeahead regression
  (dropdown closes, wizard stays, second Esc closes wizard) re-verified live.
- **Conditional auto-scroll:** a step scrolls its target into view ONLY when
  the target is closer than VIEW_MARGIN (16px) to any viewport edge —
  `scrollIntoView({ block:'center', behavior:'auto' })`, instant on purpose
  so the second rAF measures a settled position (smooth would need
  scrollend/rect-polling). **The lock does not block this**: overflow:hidden
  kills only USER scrolling; hidden boxes stay programmatically scrollable
  (verified live at 1280×600 — no unlock→scroll→re-lock dance needed). The
  today-rail anchor stretches taller than a short viewport, so "fully in
  view" is impossible there — centered is the designed outcome.

# Настройки (settings) v1 + sidebar trim + gear (2026-06-13)

The dead grey "Настройки" sidebar item became a real settings page, the sidebar
was trimmed, and the top-bar gear was wired. Backend contract:
`tubermed-backend/CLAUDE.md` (migration 017 + `/me` practice fields +
`POST /api/auth/change-password`). Workspace `--color-*` tokens only (no landing
`--lp-*`, no framer-motion/Lenis).

- **Sidebar trim (`f442e3e`).** `components/AppShell.tsx` `NAV_ITEMS` dropped
  "AI записи" + "График" (both disabled `скоро` placeholders) and their now-
  orphaned local icon components (`SparkleIcon` / `CalendarIcon`). Sidebar is now
  **Нов преглед · Пациенти · Шаблони · Настройки** (Шаблони still disabled).
  Rationale: scheduling lives in the doctor's PMS; the AI-records item was
  dropped. ⚠ Do NOT touch `components/TodayConsultations.tsx` — its "График" is
  the "Днешен ден" right-rail header, a separate thing.

- **Настройки v1 (`fc10ab1`, `0546bdb`, `7f11bbc`).** New
  `app/(workspace)/app/settings/page.tsx` (route `/app/settings`, inside the
  `(workspace)` group → auth gate + AppShell from the layout). Four sections:
  **Профил** (Име · Специалност via `SpecialtyTypeahead` · Място на работа = the
  org name) · **Практика и документ** (Адрес · Рег.№ РЗИ · Договор с НЗОК № ·
  Телефон · УИН) · **Сигурност** (Смяна на парола via `PasswordInput` · Изход) ·
  **За приложението** (claim-free: app name + version + a support-email
  placeholder — NO data-retention/residency/processor wording, pre-attorney).
  Loads via `api.me()`, saves via `api.updateMe()` (DIFF-based — only non-empty
  CHANGED fields are sent; empty never blanks per the backend contract; an
  unchanged `org_name` is skipped to avoid needless org-slug regeneration).
  Password change via `api.changePassword`; the 400 `password_change_unavailable`
  (PIN-only акаунт) surfaces as a Bulgarian line. Local `Card`/`Field`/`TextInput`
  helpers — there is NO shared `SectionCard` export (that one is private to
  `PatientForm.tsx`). AppShell flips Настройки to `href: '/app/settings'`.
  - **`lib/api.ts` widened:** `MeResponse` + `UpdateMePayload` gained OPTIONAL
    `uin` + the four practice fields (+ `name` on the payload); new
    `api.changePassword({ current_password, new_password })` →
    `POST /api/auth/change-password`. The new `MeResponse` keys are
    `?: string | null` (undefined while migration 017 is unapplied — the same
    absent-key contract as the onboarding keys).
  - **Export header (`lib/exporters.ts`):** `generatePdfHtml` / `generateWordHtml`
    take an OPTIONAL 3rd `ExportIdentity` param (`{ practiceName, address,
    rziNumber, nzokContract, phone, doctorName, specialty, uin }`). With content
    it renders a practice/doctor header block ABOVE "Амбулаторен лист" + a
    "Подпис и печат" line near the bottom. **An empty/missing identity renders the
    document BYTE-IDENTICAL to before** (the interpolations collapse to `''` —
    verified). The result page fetches identity via `api.me()` best-effort and
    NEVER blocks export on a failed `/me`.

- **Настройки restructure + gear (`9957f8c`, `dff7636`).** The page was
  reorganized from one long scroll into a **left sub-nav + one pane per section**
  (local `useState<PaneKey>('profile')` — deliberately NO routing/query-param
  panes; deep-linking is a future nice-to-have). Active sub-nav item:
  `--color-accent-soft` bg + `--color-ink` text + medium weight + full radius;
  responsive (vertical column ≥640px, a wrapping row below). **Mount flicker fix
  ("fields pop-in"):** the form is SEEDED synchronously from `getSession()` in the
  `useState` initializer (Име / Специалност / Място на работа paint correct on
  first render); the me()-only practice fields render skeleton bars
  (`--color-bg-subtle`, input height) until `api.me()` resolves — never an empty
  input that then fills; a `userEditedRef` guards the me() reconcile from
  clobbering an in-progress edit; a failed `me()` keeps the seeded values + an
  inline error. Top-bar gear (`components/WorkspaceTopBar.tsx`) is now a real
  `<Link href="/app/settings" aria-label="Настройки">` with a live hover
  (`--color-ink` on `--color-accent-soft`), pulled OUT of the `aria-hidden`
  placeholder cluster (a focusable element can't live under `aria-hidden`); the
  bell + avatar remain non-functional placeholders. The top bar renders on
  `/app/new-visit` (NOT on `/app/settings`, which has no top bar) — that's where
  the gear is reached.

- **`DoctorInfo` corrected to the runtime shape (`8614b25`).** `lib/api.ts`
  `DoctorInfo` previously mis-declared `clinic` / `org_slug` (never sent by the
  backend) and OMITTED `organizationName` (which the login/signup response
  actually nests on `doctor`). It is now `{ id; name; specialty?;
  organizationName?: string | null }` — so `getSession().doctor.organizationName`
  is typed (the settings seed reads it directly, no cast) and `ClinicSidebar` now
  shows the real clinic name instead of always falling back to its default.

# New-visit visual redesign + the shared UI system (2026-06-13)

The `/app/new-visit` flow (`app/(workspace)/app/new-visit/page.tsx` +
`components/PatientForm.tsx`) was rebuilt onto an elevated, **light-surface**
brand-navy design, and the primitives it introduced were lifted into a shared
module that Настройки + Пациенти now also consume (see the restyle section
below). Commits `1a92258`, `757663c`, `2da71d9`, `16321c0`, `ac19413`,
`82010f1`. Workspace `--color-*` tokens only (no landing `--lp-*`, no
framer-motion / Lenis).

- **New design tokens (`app/globals.css @theme`, `1a92258` / `757663c`).**
  `--color-heading` (#274C77 — headings are now navy, distinct from the
  near-black `--color-ink` text token), `--color-input-border` (#2B5489) /
  `--color-input-border-hover` (#274C77), `--color-focus-ring`
  (rgba(39,76,119,.18)), `--color-surface-tint` (#F6F9FC), `--shadow-raised`
  (hairline + soft-drop elevation), and `--control-h` (42px — the SHARED
  input + skeleton height, so a field and its loading skeleton match and nothing
  reflows on load). ADDITIVE new tokens — separate from the earlier `--color-*`
  VALUE repaletting already documented under "Public marketing landing".
- **⚠ `color-scheme: light` on `:root` (globals.css) — the fix for the
  dark/black-background bug.** The workspace page + top bar rendered with dark
  backgrounds under OS / UA dark mode; `color-scheme: light` opts the product out
  of forced dark rendering. **Gotcha: workspace surfaces are ALWAYS light — the
  only dark surface is the navy sidebar rail. Do NOT reintroduce dark backgrounds
  / a dark-mode variant** (the landing keeps its own `--lp-*` world).
- **Shared UI primitives now live in `components/ui/`** — `Card.tsx`
  (`Card` / `SectionHeader` / `SectionCard`), `Field.tsx`
  (`FieldLabel` / `Field` / `TextInput`), `Button.tsx` (`Button`) — plus
  `components/SkeletonInput.tsx` and the shared `components/Stepper.tsx`, and the
  global `.nv-field` / `.nv-skeleton` / `.nv-card-enter` classes in globals.css.
  **New-visit, Настройки, and Пациенти all consume this ONE source — edit the
  shared module, not per-page copies.** (This SUPERSEDES the earlier "SectionCard
  is private to `PatientForm.tsx`" note in the Настройки v1 section — `7d09552`
  lifted those primitives out of `PatientForm.tsx` into `components/ui/Card.tsx`,
  ~85 lines trimmed from the form.)
- **The look:** navy-outlined fields (`.nv-field`, 1.5px `--color-input-border`,
  navy focus ring via `--color-focus-ring`; `757663c`); size-matched loading
  skeletons (`SkeletonInput` at `--control-h` → no load-time reflow); a prominent
  multi-step `Stepper` on a light surface with a completed-step check + active-step
  `aria-current` (`16321c0`); the elevated "Днешен ден" rail (`ac19413`); and a
  reduced-motion-safe card entrance (`.nv-card-enter`, `82010f1`) —
  `@media (prefers-reduced-motion: reduce)` HARD-STOPS the entrance + the field
  transitions.

# Client-side ЕГН checksum (2026-06-13)

Commits `0d863d3`, `deec3a5`. `lib/egn.ts` `isValidEgnChecksum()` is a
behavioural MIRROR of backend `lib/national-id.js validateEgnChecksum` — weights
`[2,4,8,5,10,9,7,3,6]`, `sum % 11`, `>= 10 → 0`, compared to the 10th digit (same
cross-repo-parity convention as `translit.ts ↔ translit.js`; a divergence means
the client shows a false "valid" while the server only records a soft
`validation_warning`).

- **The green ✓ and the rule-2B instant ЕГН auto-load now require a valid
  checksum.** In `PatientForm.tsx`, `egnValid` (the ✓ / auto-load gate) is
  `isEgn && 10 digits && derivedDob !== null && checksumOk`.
- **A bad checksum is a SOFT, non-blocking amber warning** with the backend's
  exact wording `Невалидна контролна сума на ЕГН` (`checksumInvalid`). It is
  deliberately **NOT** folded into the hard `egnInvalid` / `canSubmit` gate —
  mirroring the backend's soft posture (ЕГН **format** = hard 400; **checksum** =
  `validation_warning` only). Format stays the only fatal client gate.
- **`deec3a5`:** the `handleFormChange` drop-on-ЕГН-invalidation predicate
  (`egnStillValid`, rule 4) now ALSO keys off `isValidEgnChecksum`, so a
  transposed / typo'd ЕГН that still decodes to a real date no longer leaves the
  loaded patient's name + DOB/age pinned next to a checksum-invalid ЕГН — the drop
  now fires consistently with the green ✓ disappearing.

# Настройки + Пациенти elevated onto the shared UI system (2026-06-13)

Commits `7ff7451` (the `git add -A` sweep that actually LANDED
`components/ui/{Card,Field,Button}.tsx` — its commit message "egn fix" is
mislabeled and carries no egn change), `7d09552` (lift `PatientForm` primitives
into the shared module), `3ba6671` (Настройки), `6ac7c7e` (Пациенти).

- **Настройки (`3ba6671`):** the four panes now use the shared
  `Card` / `Field` / `TextInput` + `SkeletonInput` + `Button` (−107 / +19 in
  `settings/page.tsx` — local helpers replaced by the shared module).
  `PasswordInput` / `SpecialtyTypeahead` (shared auth components) deliberately
  KEEP their lighter grey-field look and coexist with `.nv-field` on the page.
- **Пациенти (`6ac7c7e`):** elevated surfaces (raised shadow + hairline), navy
  headings (`--color-heading`), visit-row hover, size-matched skeleton rows, a
  real empty-state, the shared `Button`; `PatientSearch.tsx` gained the navy field
  + focus ring (visual only — search / dropdown behaviour unchanged). **⚠ The
  patients page applies the shared *tokens inline* on its card `<div>`s (+ the
  shared `Button`), NOT the `<Card>` component** — a deliberate boundary to avoid
  re-touching the file's documented `applyPage` / `loadPatient` ESLint baseline
  (see Known issues). **`RevealEgnButton` / masked-last-4 / 30s auto-hide
  untouched** (GDPR).

# Schedule rail → patient-history deep-link + birth-date label trim (2026-06-13)

Commits `ac3d496`, `6f86f31`.

- **Deep-link (`6f86f31`).** `components/TodayConsultations.tsx` rows that HAVE a
  patient now render a `<Link href="/app/patients?patient=<id>&visit=<consultationId>">`
  (CSS hover + `focus-visible` ring, `aria-label="Отвори историята на <name>"`); a
  `Без пациент` row stays a plain non-interactive cell. The patients page
  (`app/(workspace)/app/patients/page.tsx`) reads `?patient=&visit=` via
  `useSearchParams` — **wrapped in a `<Suspense>` boundary (Next 16 requirement;
  keeps `/app/patients` static-prerendered)** — and a ref-guarded one-shot effect
  drives the EXISTING `loadPatient` → `openVisit` path (no parallel mechanism),
  once per unique `patient|visit`. The manual search→select flow (which never
  touches the URL) is unaffected. A pending / started visit (no filed note)
  degrades to the honest "Няма попълнен лист" empty state + a highlighted row — it
  does not force note content. Backend `GET /api/consultations/today` already
  carries `patient.id`.
- **Label trim (`ac3d496`).** The `Дата на раждане` field label dropped its
  `(опционално — се запълва автоматично от ЕГН)` parenthetical — now just
  `Дата на раждане`.

# Workspace dates & figures — `lib/date.ts`, tabular-nums, hairline dividers (2026-06-14)

- **`lib/date.ts` is the single source of truth** for date display + DOB validation:
  `formatDateBg` (ISO `YYYY-MM-DD` → `ДД.ММ.ГГГГ`), `formatDateTimeBg` (`created_at`
  timestamps, Europe/Sofia), `todaySofiaIso` (Europe/Sofia via
  `Intl.DateTimeFormat('en-CA', …)` — the SAME "today" convention `dobFromEgn` uses),
  `isRealIsoDate`, `isFutureIsoDate`, `dobError`, `isoToBgInput` (= `formatDateBg`) and
  `bgInputToIso`. The older `formatVisitDate` (patients page) and `formatBgDate`
  (`TodayConsultations`) now **delegate** to it — don't re-add a third formatter.
  **Convention: every displayed date is `ДД.ММ.ГГГГ`** — no raw ISO and **no `р.` prefix**
  (the old `р. <ISO>` birth-date renders are gone from `PatientResultRow` /
  `PatientLoadConfirmModal` / `DedupModal`).
- **Data figures use `--font-ui` (Inter) + `tabular-nums`, NOT mono.** Workspace ЕГН /
  dates / age / counts dropped `--font-jetbrains` for the UI font + `tabular-nums` (digits
  column-align, read as clinical UI). Mono is **reserved** for code-like tokens (МКБ-10
  codes, `MedsPicker` INN/dose) and the scribe recording timer — **do NOT reintroduce mono
  on data figures**. (Landing `components/landing/*` keeps its own mono/tabular — untouched.)
- **Patient meta lines: hairline divider, not a middot.** `PatientHeaderStrip` row 1 and
  the shared match-row (`PatientResultRow`, plus the identical line in
  `PatientLoadConfirmModal` / `DedupModal`) separate items with an `aria-hidden` `w-px`
  divider (`--color-border`), **not** a `·` — the masked `····last4` ЕГН already uses dots,
  so a `·` separator beside it read as dot-on-dot noise.

# DOB field — masked input + calendar (`components/ui/DateInputBg.tsx`) (2026-06-14)

The native `<input type="date">` is **retired — do not reintroduce it.** The
`Дата на раждане` control is a **masked typed input** (`ДД.ММ.ГГГГ`, `inputMode="numeric"`,
`tabular-nums`) with an added **calendar popover**; it is self-contained — `PatientForm`
only passes `value` / `onChange(iso)` / `aria-invalid`.

- **ISO contract (invariant).** `state.birth_date` is ALWAYS `YYYY-MM-DD` or `''`. Typing
  AND a calendar pick both flow through the **same `onChange(iso)`**, so age derivation,
  `dobError`, the red border and the ЕГН auto-fill stay decoupled from the input UI. The
  external value-sync (ЕГН auto-fill / × Изчисти repaint the masked text) is a **render-phase
  "adjust-state-on-prop-change"** idiom — deliberately **not** a `useEffect` (react-compiler
  forbids setState in effects) and **not** a render-time ref write.
- **Validation = `dobError` only.** A future OR not-a-real-calendar date drives a **single**
  message „Невалидна дата на раждане.", the **red invalid border**
  (`.nv-field[aria-invalid="true"]` in `globals.css` — already present, and it applies to the
  ЕГН field too: one invalid-field convention), and **blanks Възраст**. Empty is allowed (DOB
  is optional); `canSubmit` gates on `!birthError`.
- **`bgInputToIso` is format-only (deliberate).** A complete 8-digit entry emits its ISO even
  if the day is impossible (`31.02.2000`); `dobError` is the **sole** validator. Returning
  `''` for an impossible date would let a typo register as **empty** — silent DOB loss in a
  clinical record. The non-real-but-well-formed ISO is transient and can never be saved (submit
  is blocked). Incomplete (<8 digits) still emits `''` so age / validation don't flicker.

**Calendar — react-day-picker `@10` + date-fns `@4`** (the first date lib in the workspace;
pure client-side, no network / no GDPR-EU-flow implication). Brand-themed; future dates
disabled (`disabled={{ after: today }}`); `bg` locale, Monday start; `captionLayout="dropdown"`
with `startMonth` 1900 → `endMonth` today gives the instant **year-dropdown** jump. Two gotchas:
- **⚠ Unlayered CSS.** rdp's `style.css` imports **unlayered**, so it out-prioritizes
  Tailwind's `@layer` rules. The theme is an **unlayered `.dob-cal` block at the END of
  `globals.css`** (NOT inside `@layer components`, or it loses the cascade) + inline `--rdp-*`
  vars on `<DayPicker>`. **Do not move it into a layer.**
- **⚠ Portal / stacking context.** Each `.nv-card-enter` `SectionCard` forms its own stacking
  context (the entrance `transform`), so an `absolute` popover inside one card is **painted
  over by a later sibling card** — `z-index` can't cross sibling stacking contexts. The popover
  is therefore **portaled to `document.body`** (positioned in document coords, anchored to the
  field), and the outside-click guard checks **both** the field wrapper and the portaled
  popover. Rule for any future popover that must escape these cards: `SectionCard` keeping
  `overflow: visible` is enough for an in-card dropdown (e.g. `MkbTypeahead`), but **NOT**
  across the animated sibling cards — portal out.

# Source traceability — "виж източника" per field (2026-06-15)
Pushed: `16c0eca` matcher+test · `15a0ed0` UI · `b713480` A1+A2 recall fix · `50263af` A4.

- **What it is.** Every free-text field on the result page (`app/app/scribe/result/page.tsx`)
  has a small `виж източника` affordance (`SourceButton`); clicking opens the "Транскрипт на
  консултацията" `<details>` and highlights the utterance the field most likely came from, so the
  doctor verifies wrong/misheard words against what was actually said. The trust layer is
  OBJECTIVE source grounding — NOT the model's self-reported confidence (`uncertain_spans` /
  `[[…]]` are sparse/unreliable and are not the basis here). Wired on the main diagnosis,
  anamneza, obektivno, izsledvania, terapia, napravlenia, naznacheni; meds + comorbidities deferred.
- **Matcher** — `lib/source-grounding.ts`: `findSourceSpan(fieldKey, fieldValue, transcript)
  → SourceSpan | null`, `SourceSpan { start, end, tokens: {start,end}[] }`. Pure, deterministic,
  no network, no React. Precision-favoring (a confident span or `null` — showing the wrong source
  is worse than none). Cyrillic-aware tokenization (`\p{L}`/`\p{N}`, not ASCII `\b`); content
  tokens = ≥4 letters minus a small stopword set; numbers are never needles. Hits are clustered by
  CHARACTER distance (`CHAR_GAP=30`) so dose/number runs ("400 мг три") don't fragment a therapy
  match (A1). Fuzzy + Bulgarian-inflection token matching bridges gazetteer-normalized drug names
  vs the raw Soniox spelling (нитрофурантоин↔нитрофурантуин, амоксицилин↔амоксициклин) (A2).
  **Diagnosis matches the SPOKEN term, never the МКБ code** — a trailing `— I10`/`(I10)` is
  stripped, gated to diagnosis fields only; the displayed official МКБ term diverges from the
  utterance by design and is NOT the match target.
- **⚠ Fuzzy/inflection are deliberately TIGHT** (single edit on words ≥8 chars; inflection base
  ≥6 chars). A 51-case adversarial review (2026-06-15) showed the looser backend-gazetteer
  threshold `min(floor(len/5),2)` collapsed clinically OPPOSITE terms (хипертония↔хипотония,
  хипергликемия↔хипогликемия) and distinct drugs (азитромицин↔еритромицин). Do NOT loosen back
  toward the gazetteer rule — gazetteer is for single-winner CORRECTION with ambiguity guards;
  matching has none.
- **A4 — highlight only matched tokens** (`50263af`): `SourceSpan.tokens` carries the individual
  matched-needle ranges; `TranscriptBody` lights ONLY those (adjacent ones merged across whitespace
  into phrase-boxes) and greys the rest. A partial match reads as partial, and ungrounded/fabricated
  content stays dark (a hallucinated „парауретрално изтичане" never lights) — no false-green
  reassurance.
- **States.** Empty `original.transcript` (recovery/reload) → button disabled, „Източникът не е
  наличен". No confident match → toast „Не открихме ясен източник — проверете ръчно." Button +
  highlight are `no-print` (never in the exported document).
- **Data flow / scope.** Frontend-only. Uses the in-memory transcript from the `/api/transcribe`
  response (`original.transcript`); NO new backend endpoint. `GET /api/consultations/:id` still
  does NOT return the transcript, so source-view is unavailable after a hard reload / cold-start
  recovery — exposing it there (Phase 1b) is a deferred, GDPR-weighted decision.
- **Tests.** `scripts/source-grounding.ts` (unit) + `scripts/source-grounding-cases.ts` (real-case
  recall + adversarial-precision harness): `npx tsx scripts/source-grounding.ts`. Independent of
  `lib/vital-rules.ts findHighlights` (vital-range highlights) and the review-counter/acknowledge
  system.
- **Phase 2 (deferred).** Actively FLAG clinical field content that does NOT ground in the
  transcript (the real hallucination catch); the matcher's residual misses (negation-blindness,
  exact homographs like „става" joint↔gets-up, scattered-but-present words) are its target. Staged
  AFTER the recall fix so low recall doesn't drive alarm-fatigue false flags.

# Изследвания layout — ordered tests consolidated (2026-06-15, #16)
Commits `0da20a5` (result page), `b0af051` (`lib/exporters.ts`), `20f1442`
(patient-history). „Изследвания" is now a PARENT with two conditional subsections —
**„Резултати от изследвания"** (`izsledvania`, results/past exams: EKG, рентген, CT,
labs) + **„Назначени изследвания"** (`naznacheni`, ordered tests), the latter **moved up
from „Издадени документи"**. „Издадени документи" now holds only **„Направления"**
(`napravlenia`) (+ болнични etc.) and its heading is keyed on `napravlenia` ALONE (the
`|| naznacheni` was dropped).

- Applied on three surfaces: the result page (`app/app/scribe/result/page.tsx` — TOC
  re-nest, `visibleSections`, render; new `sec-rezultati` scroll id), the read-only
  patient-history view (`app/(workspace)/app/patients/page.tsx`), and all three export
  formats in `lib/exporters.ts` (clipboard, PDF, Word).
- Subsections render ONLY when their field has content; empty-both keeps the „Не е
  споменато" (screen) / section-omitted (export) fallback.
- **Display-only** — extraction, field keys, and semantics are unchanged
  (`izsledvania` = results, `naznacheni` = ordered). Per-field behaviors preserved on the
  result page (the „виж източника" source button, `EditableField` editing,
  `acknowledgeSpan`).
- Note: `izsledvania` lost its section-level `CopyButton` (it's now a subsection, matching
  the „Издадени документи" pattern); whole-note Копирай + export still include it.

# P0-01b — grounding-flag UI copy + client-clear guard (2026-06-17)

Frontend follow-up to backend P0-01 (`tubermed-backend/CLAUDE.md`). The backend
grounding pass now emits `mkb_review.reason === 'diagnosis_text_not_grounded'`
when the MAIN diagnosis text isn't supported by the transcript (the E00.2
incident) — the code is VALID, only the diagnosis is unsupported. The 409 gate
already blocks approve/export on `needs_review === true`, so safety held; this
task fixes the doctor being MISLED by the flag. All in
`app/app/scribe/result/page.tsx` + a new `lib/mkb-review.ts`.

- **Single source of truth for the reason→copy mapping — `lib/mkb-review.ts`
  `mkbReviewCopy(review, osnovnaMkb?) → { bannerTitle, bannerDetail, blockMessage }`.**
  Pure (no React), so `scripts/mkb-review-message.ts` asserts it directly
  (`npx tsx`). The three call sites now read from this ONE place: the approve
  toast + the 409 backstop (`mkbBlockMessage` is a thin delegate to
  `.blockMessage`) and the `DiagnosesSection` inline ⚠ banner
  (`.bannerTitle`/`.bannerDetail`). `missing_code` / `invalid_code` copy is
  byte-identical to before (asserted). `MkbReview.reason` (`lib/types.ts`) was
  widened to include the new reason.
- **Grounding copy points at the DIAGNOSIS, not the code.** Banner title
  „Диагнозата не е открита в разговора"; the detail states the code IS valid and
  is not the problem; `blockMessage` is byte-identical to the backend
  `mkbReviewBlock()` string so the toast and the 409 backstop read identically.
  Do NOT route a grounding flag through the „невалиден код" wording.
- **Client must DEFER to the server for grounding — `applyMkbPick`.** The client
  cannot re-evaluate grounding (no transcript). `applyMkbPick` (the ONLY
  `clientMkbReview` caller) no longer clears a `diagnosis_text_not_grounded` flag
  when the doctor picks a VALID code (which doesn't ground the diagnosis); a
  code-level problem (missing/invalid) still shows immediately. The flag is
  cleared authoritatively by the server's `/edit` response — never by a
  client-side code pick. (Backend `/edit`-clears-grounding stickiness is a
  SEPARATE backend task; the client deferral here is forward-compatible with it.)
- **`osnovna_diagnoza` uncertain-span = graceful-ignore (NO UI change).** The
  backend also injects an `uncertain_spans` entry with `field:'osnovna_diagnoza'`.
  The app has NO `uncertain_spans` rendering path (the ONLY reference is the type
  declaration in `lib/types.ts` — see the known-issue below), so the span rides in
  `fields` and round-trips through `/edit` but is never read/rendered — no crash,
  no acknowledge-state interaction, no duplicate banner. Surfacing it would mean
  building a span-rendering surface for one field — out of scope (deferred with the
  broader `uncertain_spans`-surfacing decision). If that surface is ever built,
  align its copy with `mkbReviewCopy`.
- **Verification.** `npx tsx scripts/mkb-review-message.ts` (12/12) +
  `scripts/mkb-validity.ts` (11/11, client/backend gate parity intact) +
  `npx tsc --noEmit` + `npm run build` — all clean.

# Backend safety gates this session — what the web now sees (2026-06-18)

Three deterministic backend P1s landed (`tubermed-backend` `main`, pushed; detail
in its CLAUDE.md P1-01/P1-03/P1-07). They change responses the web consumes — no
web code shipped in that session, so the matching web work is tracked here.

- **409 `consultation_retrying` is a NEW response on `/approve` `/export` `/edit`
  `/patient-summary`** (P1-07 — a row stuck mid-retry-extraction is now gated). The
  result page only special-cases the 409 `mkb_review_required` code (`confirmReview`
  catch in `app/app/scribe/result/page.tsx` ~848); a `consultation_retrying` 409
  falls through to the GENERIC red error toast (`'Грешка при потвърждаване: ' +
  message`) — the backend's Bulgarian message („Консултацията се обработва в момента
  — опитайте отново след малко.") IS shown and the action IS blocked (degrades
  safely), but as a red error, not the calm-notice treatment. **WEB TODO (polish,
  not a broken state):** classify `body.code === 'consultation_retrying'` and render
  the calm „обработва се, опитайте отново" notice (same family as the
  `PatientSummaryModal` 429 calm-notice), across the approve/export/patient-summary
  call sites.
- **ЕГН / `birth_date` with an implausible (pre-1900) age now gets a hard 400** from
  the backend (P1-01). `lib/egn.ts` `dobFromEgn` has only a FUTURE-date guard, no
  lower bound — a 1899/1800 decode is a valid past date, so `canSubmit` does NOT
  block it client-side and the doctor only learns at submit. **WEB TODO:** mirror the
  floor — a `validateEgnPlausibleAge`-style bound on `canSubmit` (earlier feedback
  only; the backend is the authoritative gate). This is the deferred frontend age
  mirror tracked under Known-issue [P1-01]; still-open sibling [P1-02] (lnch/foreign
  stale-identity drop) is a separate web session.
- **Patient-summary cache is now invalidated server-side** on `/edit` AND
  `/retry-extraction` (P1-03 — both writers of `extracted_fields`). So
  `PatientSummaryModal` `load(false)` reopen now finds a null cache and REGENERATES
  from the current note — the wrong-dose take-home hazard is closed with NO web
  change (the modal already re-fetches; the backend null-cache makes the reopen
  fresh). Verified by code-read; tracked under the now-resolved Known-issue [P1-03].

# B2 — "% of notes TuberMed wrote" value card (2026-06-18)

A compact card at the TOP of `/app/new-visit` (the post-login surface,
`app/app/login/page.tsx` → `/app/new-visit`): "TuberMed написа ~92% от
документацията за 18 прегледа тази седмица." The willingness-to-pay anchor — a
**MEASURED** number (the share of AI-generated note text the doctor filed
unchanged), **NOT** a minutes / time-saved estimate. Backend contract:
`tubermed-backend/CLAUDE.md` (B2 — `authoredFraction` + `GET /api/auth/me/value-stats`).

- **`lib/api.ts`** — `ValueStats` / `ValueStatsWindow` types + `api.valueStats()` →
  `GET /api/auth/me/value-stats` (mirrors `api.me()`; aggregate numbers only, no PII).
  Shape: `{ thisWeek: { notes, avgAuthoredPct }, today: { … } }`; `avgAuthoredPct` is
  a whole percent or `null`.
- **`components/ValueStatsCard.tsx`** — brand-navy compact card (`--color-accent-soft`
  bg / `--color-heading` / `--color-ink`). The subtext labels it as measured from the
  doctor's OWN edits (generated text kept unchanged) and explicitly **not a time
  estimate**. Singular/plural `преглед`/`прегледа` handled.
- **Honesty guardrails (load-bearing):** `stats === null` (loading OR error) → the card
  renders **nothing** — it can NEVER break the new-visit page. **Empty/low-sample
  threshold:** `thisWeek.notes < 3` (the `MIN_NOTES` const) OR `avgAuthoredPct == null`
  → a neutral encouraging line ("Одобрете няколко прегледа и тук ще видите…"), never a
  percentage — one heavily-edited first note must never render a discouraging "40%".
- **`app/(workspace)/app/new-visit/page.tsx`** — a best-effort `api.valueStats()` fetch
  in its OWN effect (independent of the `/me` onboarding fetch; on any error it just
  leaves the card hidden), with the card rendered above `<PatientForm>` in the left
  grid column.
- Verify: `npx tsc --noEmit` + `npm run build` — clean. Walkthrough: endpoint →
  `api.valueStats()` → `valueStats` state → `<ValueStatsCard>`; below 3 notes the
  neutral state shows; on error/loading nothing shows.

# A2 — surface the AI's uncertainty (uncertain_spans now rendered) (2026-06-18)

The documented "uncertain_spans are not surfaced" gap is CLOSED. The backend
already computes `fields.uncertain_spans` (gazetteer drug-name borderlines,
missing/mismatched vitals, allergy-stem flags, ungrounded denials); the result
page (`app/app/scribe/result/page.tsx`) now renders them inline as a second
highlight kind and folds them into the EXISTING review counter. **Advisory only
— NOT a new approval gate** (the main diagnosis is already hard-blocked via
`mkb_review`; these are review markers the doctor steps through + acknowledges).

- **Pure core — `lib/uncertain-spans.ts` `resolveUncertainSpans(fields,
  acknowledged) → ResolvedUncertainSpan[]`.** Groups `uncertain_spans` by field
  and for each: re-locates `original` in the CURRENT `fields[field]` text via
  `indexOf` (the backend `start`/`end` is loose / may be stale after edits — NEVER
  trusted), dropping the span if `original` is gone (doctor edited it out →
  self-clearing, exactly like a vital); drops acknowledged spans; de-dups the main
  diagnosis (below). Sorted by start within each field. Pure (no React) — asserted
  by `scripts/uncertain-spans.ts` (`npx tsx`, 19/19). `UNCERTAIN_FIELDS` (the 6
  EditableField fields) + `uncertainAckKey` are exported here.
- **Field coverage — a SUPERSET of the 4 vital-scanned fields:** `anamneza`,
  `obektivno`, `izsledvania`, `terapia`, **`napravlenia`**, **`naznacheni`**. The
  last two had no review wiring before — they now pass `fieldKey` + `uncertainSpans`
  + `highlightVitals={false}` (uncertainty marks but NOT vital-range scanning — they
  were never in the vital counter). `osnovna_diagnoza` is intentionally NOT in the
  set: it renders via `DiagnosesSection` (not `EditableField`) and its ungrounding is
  surfaced by the `mkb_review` banner (see the de-dup).
- **Inline rendering — `EditableField` + `lib/vital-rules.ts`.** `HighlightKind`
  gained `'ai-uncertain'` (distinct from the existing `'uncertain'` for `[[…]]`
  transcription markers) and `HighlightMatch` gained optional `suggestion`.
  EditableField takes `uncertainSpans` + `onAcknowledgeUncertain`, converts the
  resolved spans to `ai-uncertain` HighlightMatches, and merges them with the vital
  matches into ONE by-start-sorted, overlap-safe decoration list. Uncertain marks
  render as `<mark class="uncertain-mark">` (amber DOTTED underline — visually
  distinct from the red/gold vital marks and the wavy transcription mark) with
  `id="uncertain-${fieldKey}-${j}"`; the popover shows `reason` + `suggestion` (when
  present) + ✎ Редактирай / ✓ Потвърди. **The vital path is byte-for-byte unchanged**
  (same `findHighlights` matches, same `vital-${fieldKey}-${i}` ids).
- **Unified review counter.** `reviewItems` now emits BOTH kinds, each tagged
  `reviewKind: 'vital' | 'uncertain'`; the "N за преглед" counter sums them and
  `goToNextReview` scrolls+flashes the right id (`vital-…` / `uncertain-…`). Per-kind
  `localIdx` keeps the counter aligned with EditableField's render order.
- **Acknowledge — distinct key namespace.** Uncertain spans acknowledge into the
  SAME `acknowledged` Set under the `unc::${field}::${original}` prefix (via
  `acknowledgeUncertain`), which can NEVER collide with the vital
  `${fieldKey}::${raw}` keys. Acknowledging clears the mark + decrements the counter;
  editing the token out self-clears it. **Note confirmation / `isLocked` /
  `mkb_review` 409 are NOT affected** — acknowledging is not required to approve.
- **`mkb_review` de-dup.** When the main diagnosis is already surfaced by the
  `mkb_review` banner (`needs_review && reason === 'diagnosis_text_not_grounded'`),
  `resolveUncertainSpans` drops the matching `osnovna_diagnoza` span so the diagnosis
  isn't flagged twice (the realistic P0-01b case — the backend emits both together).
  Conditional on that reason, not a blanket exclusion.
- **CSS (`app/globals.css`).** `.uncertain-mark.flash-review` rides the existing
  `flash-review` keyframes; a `prefers-reduced-motion` guard was added for BOTH flash
  classes (the vital flash had none); `.uncertain-mark` is print-stripped alongside
  `.vital-mark` (review affordance, never in the exported document).
- **Verify:** `npx tsx scripts/uncertain-spans.ts` (19/19) + `scripts/mkb-validity.ts`
  (11/11) + `npx tsc --noEmit` + `npm run build` — all clean.

# Skeleton loaders across waiting surfaces (2026-06-18)

Blank / "Зареждане…" waits were replaced with footprint-matched pulsing
placeholders so the app feels faster and stops layout-shifting on load.
**UI-only, client-side CSS — no new network requests, no server/bandwidth cost,
no loading-decision or `api.*` change anywhere.** Reuses the EXISTING primitive
(`components/SkeletonInput.tsx` → an `aria-hidden` `.nv-skeleton` box; the shimmer
+ its `prefers-reduced-motion` HARD-STOP live in `app/globals.css:356`) — **no new
skeleton system, no new animation/CSS.** Reduced-motion is honored automatically by
anything rendering `.nv-skeleton`. The settings page was the prior lone user; these
surfaces now follow the same `{loading ? <SkeletonInput/> : <real/>}` pattern.

- **Value card (`components/ValueStatsCard.tsx`, `…/new-visit/page.tsx`).** New
  optional `loading` prop: while loading → a card-shaped skeleton (headline + two
  subtext lines) in the real card chrome. **The honesty invariant is preserved —
  settled-with-no-stats (error) still renders `null`; the card can NEVER break
  new-visit.** The parent feeds a `valueStatsLoading` flag (set false in `.finally`);
  the fetch/`.then`/`.catch`/null-on-error behavior is byte-unchanged.
- **Result note (`app/app/scribe/result/page.tsx`).** Highest-impact (post-recording
  wait). A local `NoteSkeleton` mirrors the loaded note: a document-header card then
  section cards in the SAME canonical order (Диагнози [+ comorbidity chip row] →
  Анамнеза → Обективен статус → Изследвания → Терапия), reusing the real card chrome
  (`bg-white rounded-2xl border` / `--color-border`; header `p-8`, sections `p-6`;
  `space-y-4`). Used by BOTH the `Suspense fallback={<BootSplash/>}` AND the inner
  `!doctor || !original` guard (now `return <BootSplash/>` — one source, byte-identical
  waits). `doctor` is null during the wait so AppShell can't mount → centered
  single-column document; the real 3-column `.result-grid` re-mounts once doctor + the
  note resolve (a layout change there is unavoidable, not a skeleton defect). The
  documented edit/flush machinery + every fetch/bootstrap/recovery/reconcile effect are
  untouched.
- **Patients (`app/(workspace)/app/patients/page.tsx`).** `loadingList` → ~6 rows
  mirroring `VisitRow` (date line + status-pill on top, diagnosis-title line). 
  `loadingDetail` → a record skeleton mirroring `ReadOnlyNote` (header card + ~3
  `ReadOnlySection` cards, same `bg-white rounded-xl p-6` / `--color-border-soft` +
  `--shadow-raised` chrome). **Left alone:** the `PatientsBootSplash` Suspense fallback
  (honest first paint is the empty two-panel shell, not loaded content) and the
  `loadingMore` "Зарежда…" button busy-label. The pre-existing `loadPatient`/`applyPage`
  ESLint baseline (~lines 111/120) was NOT disturbed.
- **Today rail (`components/TodayConsultations.tsx`).** The pre-existing 3× solid-44px
  bars were refined to 4 `SkeletonRailRow` placeholders mirroring a real `Row`
  (`pl-3 pr-2 py-2`; time line over name line; status-pill box).
- **Patient-summary modal (`components/PatientSummaryModal.tsx`).** The
  `phase.kind==='loading'` body's centered "Генериране на резюмето…" text → a `gap-3`
  column skeleton mirroring the `ready` body (caption line → 12rem textarea block →
  disclaimer box). The `load()`/regenerate/429-notice/disclaimer-split logic + footer
  busy-labels are untouched.

- **Deliberately LEFT AS-IS (not a follow-up gap):** the scribe record screen
  (`app/app/scribe/page.tsx` `BootSplash` + `!doctor` gate) and the workspace shell boot
  (`app/(workspace)/layout.tsx` `!ready`). Their loaded content is the full AppShell
  chrome (navy sidebar rail + top bar + Stepper + 80px mic/waveform) — NOT a column of
  input-height rows — so a `SkeletonInput` stack can't mirror it and would ITSELF reflow
  the instant AppShell mounts. Both gates also clear in one synchronous client tick
  (`getSession()` then `setReady`/`setDoctor`; no field fetch awaited), so the splash
  barely flashes. If polish is ever wanted there, the right move is a neutral brand
  splash, not a field-stack skeleton. Recovery-gated splashes are untouched.
- **Accessibility:** skeleton boxes are `aria-hidden` (via `SkeletonInput`); where the
  old loading UI announced text, an `sr-only` / `role="status"` equivalent is preserved
  (result page, summary modal). Button busy-states (login "Влизане…", saves) are NOT
  skeletons — left as-is.
- **Verify:** `npx tsc --noEmit` + `npm run build` — clean (no unit runner for pure UI).
  Worth a real visual pass post-deploy on a throttled connection (DevTools → Slow 3G) to
  actually see the skeletons and confirm nothing jumps when data lands.

# Settings save now refreshes the sidebar identity (2026-06-19)

Saving Профил (Име / Специалност / Място на работа) in Настройки used to leave the
dark sidebar STALE — the clinic panel (org name + specialty) and the bottom doctor
name only updated on re-login. Root cause: `app/(workspace)/layout.tsx` reads the
session ONCE on mount (`setDoctor(getSession().doctor)`) and feeds it to
`AppShell` → `ClinicSidebar`; the settings `saveProfile()` updated only its local
`me`/`form`, never the persisted session NOR the layout's `doctor` state. Fixed in
TWO facets so the sidebar updates instantly AND survives a reload — both are
required (either alone regresses the other half):

- **(A) Persisted — `lib/api.ts` `updateSessionDoctor(partial)` (+ pure
  `mergeSessionDoctor`).** Merges the partial onto `session.doctor` and re-persists
  to the SAME storage the token currently lives in — preserving "Запомни ме"
  (localStorage vs sessionStorage), the JWT and its expiry; never flips remember-me;
  no-ops without a session. So a reload (`getSession()`) paints the new identity.
  Pure-merge + storage round-trip tested: `npx tsx scripts/session-doctor.ts` (23).
- **(B) Live — `components/DoctorContext.tsx` (`DoctorProvider` / `useDoctorContext`).**
  The workspace layout now wraps `AppShell` in `DoctorProvider value={{ doctor,
  setDoctor }}`, exposing its `doctor` state setter. `saveProfile()` calls
  `doctorCtx?.setDoctor(d => d ? { ...d, ...partial } : d)` after a successful
  `updateMe`, so the sidebar re-renders WITHOUT a reload. `useDoctorContext()` is
  null-safe (returns null outside the provider — e.g. scribe/result render AppShell
  directly; those pages are untouched).

The doctor partial is built ONLY from non-empty fields on the server truth
(`{ name, specialty, organizationName }` from the `updateMe` response), mirroring
the form's "non-empty" discipline — never blanks specialty/org if the response omits
one. `ClinicSidebar`'s clinic line is `clinicName ?? organizationName`; no caller
passes `clinicName` (it's decorative), so updating `doctor.organizationName` drives
the clinic line. `AppShell`/`ClinicSidebar` are unchanged (they already take `doctor`
as a prop). No backend call, PATCH payload, or "Запазено." flow changed — only the
result is propagated. Verify: `npx tsc --noEmit` + `npm run build` clean.

# Icon system — shared `<Icon/>`, never emoji as UI icons (2026-06-20)

`components/ui/Icon.tsx` is the ONE icon set for the workspace app — a zero-dep
inline-SVG wrapper (lucide-style geometry, `currentColor`, stroke 1.75, default
16px). Use `<Icon name="…" />` for every UI icon; **never an emoji as a
functional icon** (🎙 / 📱 / ⚠ / 🚨 / 🔒 / ⬇ / ⎙ / ⎘ / 📄 / 📋 / 🔬 / ✎ / ✓ / 🔍 /
✕ / ★ / ↻ were all migrated to it). Decorative icons are `aria-hidden` by
default; an icon that REPLACES a text label on an icon-only control passes
`label` (→ `role="img"` + `aria-label`). The set is swappable in this one file
(e.g. to `lucide-react`) since call sites only import `<Icon/>`, never an icon
library directly. **The landing (`components/landing/*`, `app/page.tsx`,
`app/privacy`) is a SEPARATE design world (`--lp-*`) and deliberately does NOT
use `<Icon/>`** — its faux-app mock glyphs stay landing-local (the standing rule:
never import workspace UI into the landing, or vice-versa).

Regression guard: `npx tsx scripts/no-emoji-ui.ts` fails if a pictographic emoji
reappears as a UI icon in `app/`/`components/` (code comments, prose arrows
`→ ← ↔`, and the landing are allowlisted). Run it with the other `scripts/*.ts`
regressions.

# Dialog system — shared `<Dialog/>` (Radix), never hand-roll an overlay (2026-06-20)

`components/ui/Dialog.tsx` is the ONE modal primitive — a thin wrapper over
`@radix-ui/react-dialog` that gives every modal a real focus-trap + focus-RETURN,
body scroll-lock, `role="dialog"` + `aria-modal`, an accessible name, a portal,
and Esc/outside-click handling for free. **Never hand-roll a `fixed inset-0`
backdrop / `document` Escape listener / manual `.focus()` trap again** — use
`<Dialog open onClose title …>`. Styling matches the old hand-rolled modals
(navy scrim `rgba(27,42,65,.55)`, `rounded-2xl shadow-2xl` card, `--color-*`
tokens) so migrations are visually unchanged; a subtle opacity fade on open is
HARD-STOPPED under `prefers-reduced-motion` (globals.css `.dialog-*`).

- **API.** `open`, `onClose` (fires on Esc/backdrop/close-button; wire to the
  modal's cancel handler), `title` (accessible name — Radix Title, **visually
  hidden by default** so the modal keeps its own visible `<h2>`), `description?`,
  `size?` (sm/md/lg/xl → max-w-md/lg/2xl/4xl), `dismissible?` (default true;
  **`false` = hard gate**: Esc + outside-click `preventDefault` and no close X —
  for ConsentModal), `showClose?` (default = dismissible), `initialFocus?` (ref —
  e.g. a picker's search input), `className?` (width/height overrides).
- **Dismissibility is per-modal and MUST be preserved.** Dismissible (Esc +
  backdrop → cancel): Dedup / EgnSwitchGuard / PatientLoadConfirm / MkbPicker /
  MedsPicker / PatientSummary (the last keeps its unsaved-edits confirm guard via
  `onClose={handleClose}`). Hard gate (no Esc/backdrop): **ConsentModal**
  (`dismissible={false}`). Pickers pass `initialFocus={inputRef}` (search input).
- **OnboardingWizard — MIGRATED with a state-gated two-step Esc (P1b).** It can't
  use the default Radix Esc: Radix DismissableLayer's Esc runs in the **CAPTURE
  phase** (`useEscapeKeydown` registers `{capture:true}`) and `preventDefault()`s
  before dismissing — BEFORE the `SpecialtyTypeahead`'s bubble-phase
  `preventDefault`, so a bubble-phase `defaultPrevented` handshake is invisible to
  it (this would close the wizard on Esc-with-dropdown-open and PATCH
  `onboarding_completed` — the 2026-06-11 bug). **FIX:** the typeahead reports its
  dropdown state via `onOpenChange`; the wizard mirrors it in `specialtyOpen` and
  passes `onEscapeKeyDown={(e) => { if (specialtyOpen) e.preventDefault(); }}` (gate
  by its OWN state — capture-safe) + `onInteractOutside={(e) => e.preventDefault()}`
  (no backdrop close). So: dropdown OPEN + Esc → only the dropdown closes, **no
  PATCH**; dropdown CLOSED + Esc → `onClose={() => finish(false)}` closes the wizard
  (PATCH once). The completion PATCH lives in `finish()` and fires ONLY on a real
  exit. Do NOT route the wizard's Esc through plain `dismissible` — the gate is load-bearing.
- **Out of scope (NOT modals):** `SpotlightTour` (anchored coachmark) and
  `components/ui/DateInputBg` (calendar popover) — do NOT force them into Dialog.

# Calm-clinical overhaul + scribe recording UX (2026-06-22)

A multi-step visual + UX pass (P0–P6) settled the workspace on the approved
"calm-clinical" house style, followed by recording-screen polish + error/
empty-speech UX fixes (U1–U5) found by testing the live flow. **P0 (Icon set)
and P1/P1b (shared Radix `<Dialog/>` + the OnboardingWizard two-step Esc) have
their own sections above** — the rest is recorded here.

## Shared UI primitives (P2)
- `components/ui/Segmented.tsx` is the ONE segmented toggle (the new-visit
  visit-type picker, the scribe Микрофон/Телефон tabs). `components/ui/Button.tsx`
  gained a **`toolbar`** variant (small bordered ghost — `px-3 py-1.5`, hover bg)
  that reproduces the old result-page `TopbarBtn` byte-for-byte. **`TabBtn` /
  `TopbarBtn` are DELETED** — every tab / action-bar button is now
  `<Button variant="toolbar">` or `<Segmented>`.

## Calm-clinical note + pages (P3 / P3b / P4)
- `components/ui/NoteSection.tsx` is the note house style: a section reads as a
  section via an accent TICK + optional small navy ICON + ~14px uppercase navy
  LABEL (`NoteSectionHead`) + a HAIRLINE divider + breathing room — **NOT a boxed
  card**. Elevation + saturated red stay RESERVED for the drug-safety rail /
  critical alert, so the note itself stays calm + scannable.
- **Scribe + result (P3/P3b):** the result page is the de-boxed "one-sheet"
  Амбулаторен лист (NoteSection sections on air, not cards) with the safety
  alerts in a dedicated rail; an a11y/contrast sweep moved clinical body text off
  `--color-text-hint` (≈3.1:1, fails AA) onto `--color-text` / `--color-text-muted`;
  waiting surfaces gained skeletons. Scribe record-card subtitle copy fixed to
  "AI слуша и записва. Нищо не напуска ЕС."
- **New-visit / Настройки / Пациенти (P4):** moved onto the same calm-clinical
  system. **`components/ui/Card.tsx` REMOVED.** `--color-text-hint` has NO live
  usages left (only a do-not-use comment in `NoteSection.tsx`); the token stays
  DEFINED in globals.css as a legacy alias so nothing breaks.

## Louder section headers + section icons (P5)
- Section headers were made louder (the title is `text-sm`, not the quieter
  `text-xs`) and gained per-section glyphs; the `<Icon/>` set was extended for
  them. Sections no longer blur into one block.

## Vitals source-grounding (P6)
- `lib/source-grounding.ts` gained vital-aware matching for "Обективен статус":
  a partial vitals match greys the UNsourced clauses, so RR/ЧСС/… values that ARE
  supported by the transcript light up while fabricated/unspoken slots stay dark
  (extends the 2026-06-15 "виж източника" matcher). Covered by
  `scripts/source-grounding*.ts`.

## Scribe recording UX (P9 — U1–U5)
- **U1 — no stray scroll.** The recording surface (mic + phone QR) sat in a
  `flex-1` child whose default `min-height:auto` refused to shrink within `<main>`,
  pushing the page past 100vh (stray scrollbar / sliver of navy sidebar). Fix is
  scribe-scoped (AppShell untouched): `flex-1 min-h-0 overflow-y-auto` + an inner
  `min-h-full flex-col justify-center` so the card centres and reads as a settled
  page.
- **U2 — record button navy idle / red live.** The mic button is navy when idle
  (red is reserved for the safety alert) and red while actively recording; the
  red-tinted concentric rings now breathe with a calm pulse (`.record-ring`,
  globals.css; hard-stopped under `prefers-reduced-motion`). The green
  "На запис · AI слуша" pill + waveform stay as the live cues.
- **U3 — no-speech is not a failure.** When a recording has no transcribable
  speech, the backend signals `no_speech` (PC → 422 `{ code }`; phone → WS error
  `code` + `error_msg` stem) and keeps the visit `'pending'`. The scribe shows a
  calm `NoSpeechPanel` ("Не разпознахме реч в записа" + re-record) instead of the
  red failure / retry-extraction panel — there is nothing to resurrect, and
  re-recording the SAME visit just works. `isNoSpeechApiError` / `isNoSpeechMessage`
  in `lib/api.ts`; `WsMessage` error gained an optional `code`. **Paired backend
  change in tubermed-backend** (process-audio `kind:'no_speech'`, transcribe.js
  422, sessions.js phone path — both revert the row to `'pending'`).
- **U4 — recovery copy matches actions.** `RecoveryPanel` headline/subtext are now
  STATE-DRIVEN off `blocked`: the terminal no-transcript state reads "Записът не
  може да бъде възстановен" / "...започнете нов преглед" instead of falsely
  promising a retry that is gone.
- **U5 — staged processing loader.** `ProcessingView` replaced the bare spinner
  with an INDETERMINATE bar + staged step labels (Транскрибиране… →
  Структуриране… → Проверка за безопасност…) reflecting the real pipeline, plus a
  static "Обикновено отнема ~15–30 сек." hint. **NO fake percentage, NO live
  ETA** (LLM extraction has no reliable %/time; a stalled countdown erodes trust).
  `.proc-track` / `.proc-dot` in globals.css are reduced-motion safe;
  `role="status"`/`aria-live` announces stage changes.

**No safety-gate changes anywhere in this pass** — consent + note-approval gates,
`ai_original_fields` immutability, the transient `'retrying'` status, source-
grounding precision, org-scoping, and EU-only flows are all untouched. Visual /
UX / copy + the no-speech handling only.

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

# Browser error monitoring — Sentry (EU, Replay OFF, PII-scrubbed) (2026-06-28)

Client / server / edge error monitoring via `@sentry/nextjs` (v10), mirroring the backend
(`tubermed-backend/instrument.js`). **No-op until `NEXT_PUBLIC_SENTRY_DSN` is set** (Vercel) — safe
to ship/build before the DSN exists. Backend Sentry is a separate, already-done piece; this is the
browser/Next half.

- **Init sites — MANUAL setup, NOT `@sentry/wizard` (the wizard enables Replay + tracing we
  forbid):** `instrumentation-client.ts` (browser, Next-16-native, runs pre-hydration),
  `sentry.server.config.ts` + `sentry.edge.config.ts` (loaded by `instrumentation.ts` `register()`
  per `process.env.NEXT_RUNTIME`), and `export const onRequestError = Sentry.captureRequestError`
  in `instrumentation.ts`. Each `Sentry.init` is env-guarded: `NEXT_PUBLIC_SENTRY_DSN` (client),
  `SENTRY_DSN || NEXT_PUBLIC_SENTRY_DSN` (server/edge).
- **HARD CONSTRAINTS (medical product), all by construction:**
  - **NO Session Replay** — no `replayIntegration` (it is opt-in, NOT a default integration in
    @sentry/browser v10); `replaysSessionSampleRate` / `replaysOnErrorSampleRate` = 0. Replay
    records the DOM = patient data.
  - **NO performance tracing / profiling** — `tracesSampleRate: 0`; and because @sentry/nextjs v10
    AUTO-adds `browserTracingIntegration` to the CLIENT default integrations (the `__SENTRY_TRACING__`
    tree-shake that would suppress it is a webpack-only flag → no-ops under Next 16's Turbopack),
    `instrumentation-client.ts` STRIPS it via an `integrations` filter at the init site (runtime,
    bundler-agnostic). Net: no `browserTracingIntegration`, no webVitals, no history/fetch/performance
    patching, no spans.
  - **`sendDefaultPii: false`** + a **shared PII scrub** `lib/sentry-scrub.ts` `scrubEvent` used as
    `beforeSend` at ALL three init sites — deletes `event.request.{data,cookies,headers,
    query_string}` + `event.user` + `event.breadcrumbs` (mirrors the backend EXACTLY; the
    breadcrumb drop stops a stray future `console.log(patient)` from riding into Sentry).
  - **EU region only** — DSN must be a `*.ingest.de.sentry.io` host; the CSP `connect-src` addition
    is EU-guarded (see the CSP section below).
- **Build — `withSentryConfig(nextConfig, { silent: true, telemetry: false, sourcemaps: { disable:
  true } })`** in `next.config.ts`. Wraps the config and PRESERVES `redirects()` / `headers()` /
  the CSP unchanged. **Source-map upload is DISABLED, so the prod build NEVER needs
  `SENTRY_AUTH_TOKEN`** (`org`/`project`/`authToken` are all optional and unset). Readable stack
  traces (source maps) and a Sentry tunnel route are deferred follow-ups.
- **Tests (no runner in this repo — `npx tsx`):** `scripts/sentry-scrub.ts` (scrub strips every PII
  channel, keeps `exception`); `scripts/sentry-csp.ts` (EU DSN → ingest origin; unset / non-EU →
  none). Verified with `npx tsc --noEmit` + `npm run build` both with the DSN unset (dormant; no
  sentry origin in the built CSP) and set to an EU DSN (sentry origin present; no replay bundle).

# Content-Security-Policy + security headers (2026-06-23)

Baseline CSP + the standard companion headers, set in **`next.config.ts` `headers()`** (no
middleware, no nonce). Shipped Report-Only first, then flipped to enforcing.

- **The policy** (one source of truth — `contentSecurityPolicy()` in `next.config.ts`):
  `default-src 'self'`; `script-src 'self' 'unsafe-inline'`; `style-src 'self' 'unsafe-inline'`;
  `img-src 'self' data: blob:`; `font-src 'self'`; `connect-src 'self' <backend-https>
  <backend-wss> [<sentry-eu-ingest>]`; `media-src 'self' blob:`; `frame-ancestors 'none'`; `base-uri 'self'`;
  `form-action 'self'`; `object-src 'none'`; `upgrade-insecure-requests`.
- **Companion headers:** `X-Content-Type-Options: nosniff`, `Referrer-Policy:
  strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, `Permissions-Policy:
  microphone=(self), camera=(), geolocation=()` (**microphone is MANDATORY — the scribe
  records; do NOT drop it**), `Strict-Transport-Security: max-age=63072000; includeSubDomains;
  preload`.
- **`connect-src` is DERIVED, never hardcoded** — `backendConnectOrigins()` reads the SAME
  `process.env.NEXT_PUBLIC_BACKEND_URL` that `lib/api.ts` fetches with, and turns it into its
  origin + the `wss://`/`ws://` form (mirrors `wsUrl()`). Build-time inlined, so it self-adjusts
  per env (localhost in dev, Railway EU on Vercel; preview inherits the env value). If the backend
  ever moves, the CSP follows automatically.
- **Sentry EU ingest is the SECOND (and only other) cross-origin `connect-src` destination
  (2026-06-28).** `sentryConnectOrigins()` (`lib/sentry-csp.ts`) derives the origin from
  `process.env.NEXT_PUBLIC_SENTRY_DSN` the same DSN-derived / never-hardcoded way, and is
  **EU-GUARDED** — it returns an origin ONLY when the DSN host matches `*.ingest.de.sentry.io` (the
  German/EU ingest), so an unset DSN or a non-EU / other-region / self-hosted / malformed DSN adds
  NOTHING. The browser Sentry SDK POSTs error events to this origin, so the enforcing CSP would
  block it otherwise. **EU-only invariant (UPDATED):** the permitted cross-origin destinations are
  the EU backend AND the EU Sentry ingest — **both EU, both DSN/URL-derived; never add a US /
  Google / non-EU origin.** (Browser Sentry setup is in the "Browser error monitoring — Sentry"
  section above: Replay OFF, tracing OFF, PII scrubbed via `lib/sentry-scrub.ts`; source-map upload
  deferred.)
- **Why `'unsafe-inline'` (script + style) in this baseline:** Next App Router streams hydration
  via inline `<script>` with no nonce, and `lib/exporters.ts`' PDF print window injects an inline
  close-`<script>` (the `about:blank` window inherits this CSP). Styles are inline throughout
  (hero style string, `style=` attributes, export HTML). There are **no external script/style
  origins** (verified by grep — the app is fully self-contained; `next/font` self-hosts the woff2
  at build time, so no `fonts.gstatic`/US leak).
- **Production-gated:** `headers()` returns `[]` unless `NODE_ENV === 'production'`, so `next dev`
  HMR (ws:/eval) is untouched. Verify a prod build locally: `next build && next start`, then
  `curl -D - http://localhost:3000/`. Note: Next bakes `headers()` into the build manifest at
  **build time** — a config change needs a **rebuild** to take effect under `next start`.
- **Report-Only → enforce:** `const CSP_REPORT_ONLY` (top of `next.config.ts`). `true` →
  `Content-Security-Policy-Report-Only` (reports, never blocks); `false` → enforcing. Flipping
  back is a one-line change + rebuild.

**Deferred / follow-ups:**
- **Tighten `script-src`/`style-src` via a per-request nonce** (Next middleware that injects a
  nonce into the CSP + lets Next tag its inline scripts) — removes `'unsafe-inline'`. The export
  print window's inline script is a separate case (it lives in a child `about:blank`), so the
  nonce alone won't cover it; consider moving that script to a hashed/`'self'` form.
- **The phone capture page is NOT covered by this CSP.** `/mobile?session=…` (the QR target) is
  server-rendered HTML by the **BACKEND** (`tubermed-backend/routes/sessions.js`, a different
  origin) — this web header never reaches it. The backend should send its own CSP for
  `/mobile-page` (it uses inline `<style>`/`<script>` + getUserMedia, so it needs
  `script-src/style-src 'unsafe-inline'` + `media-src blob:` + `Permissions-Policy
  microphone=(self)` of its own). Tracked as a backend follow-up.
- **HSTS duplicate:** if Vercel is ever configured to also send `Strict-Transport-Security`,
  remove one of the two to avoid a duplicate header.
