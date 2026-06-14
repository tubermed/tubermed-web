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
    Fix = a `validateEgnPlausibleAge` bound on `canSubmit` (and backend).
  - **[P1-03] Stale patient-summary cache survives a note edit.** Backend
    `POST /:id/edit` never NULLs `patient_summary`; reopening `PatientSummaryModal`
    (`load(false)`) serves the PRE-edit summary → a patient can leave with a
    wrong-dose take-home. Fix = invalidate the cache on `/edit` (backend).
  - **[P1-02] Drop-on-invalid-ID fires only for ЕГН, not ЛНЧ / foreign** — the
    already-documented egn-only drop gap below; the audit re-confirms it as a
    wrong-patient-filing hazard for the foreign subset.

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
