# TuberMed — "Break-it" QA / Safety / Security Audit

**Scope:** `tubermed-backend` + `tubermed-web` (whole-codebase, both repos).
**Type:** FINDINGS-ONLY. No code was changed, no data mutated, no production touched. All evidence is from code reading + pure-local synthetic computation (e.g. re-deriving ЕГН decoding offline). Any real-looking PII is redacted/synthetic.
**Audit opened:** 2026-06-13 · **Compiled:** 2026-06-14.
**Method:** 9 parallel read-only investigators (one per scope area) → adversarial verification of every P0/P1 candidate by an independent skeptic → lead synthesis + dedupe → manual lead re-verification of the flagship P0 and all severity calls against the project's own rubric. 64 raw candidates → 12 refuted/merged → **27 final findings**. One verifier (auth-surface) died on a transport error mid-run; those findings were re-checked by the lead by hand.

> This single report covers BOTH repos; every finding is tagged with `repo/path:line`. An identical copy lives in each repo root.

---

## Executive summary

| Severity | Count |
|---|---|
| **P0** — patient safety / data-loss / PII-secret leak / authz bypass | **1** |
| **P1** — correctness that erodes trust | **9** |
| **P2** — quality / confusing state | **10** |
| **P3** — polish / hardening | **7** |
| **Total** | **27** |

### Top 5 to fix first
1. **[P0-01]** Fabricated **main** diagnosis (e.g. МКБ `E00.2` thyroid) is ungrounded in extraction and restated verbatim to the patient — the seeded S2 defect, confirmed by hand.
2. **[P1-01]** Valid-checksum ЕГН decodes to an impossible age (226 / 127) — no plausibility bound front or back — the seeded S1 sibling the checksum fix did **not** cover.
3. **[P1-03]** Stale patient-summary cache survives a note edit → patient can leave with a **wrong dose** in the take-home summary.
4. **[P1-04]** A documented allergy can land with **no CRITICAL card-flag** (C2 is prompt-only; no deterministic backstop) — future prescribers get no warning.
5. **[P1-02]** Loaded-patient "drop on invalid ID" fires only for ЕГН, not ЛНЧ/foreign → **wrong-patient filing** hazard.

### Severity calibration (lead notes — read this)
The multi-agent pass proposed 4× P0. I reconciled to **1× P0** against the project's own rubric and verified facts, with full transparency below:
- **Age-226 → P1, not P0.** The rubric lists "wrong DOB/age" as a *P1* example. Post-checksum-fix the ЕГН is genuinely checksum-valid (no longer "invalid shown as valid"); the residual is an *implausible* decoded age. And it is **correctable** — `birth_date` is in `PATCH /api/patients` `PLAIN_FIELDS` (patients.js:424-429), so the synthesis's "immutable/unfixable" justification is factually wrong. Serious and seeded, but P1.
- **ЛНЧ/foreign stale-identity → P1, not P0.** The ЕГН path (≈99% of BG patients) drops correctly; only ЛНЧ/foreign don't — "a gate that mostly works" (P1). It is also a *documented, deliberately-scoped-out* gap (AGENTS.md). P0-adjacent for the foreign-patient subset.
- **JWT-in-localStorage → P2, not P0.** This is a *documented-accepted* threat-model decision and an explicitly *deferred* hardening item ("flag, don't fix"). It is not an active leak (requires XSS/malware/physical access). Worth re-rating *now* only because public self-serve signup widened the attacker pool and there is still no CSP — captured as P2-01.

The **one true P0** is the fabricated-diagnosis-to-patient path: invented clinical data shown to a patient as fact, with a concrete reproducible route and no real-time gate.

### Seeded-defect verdicts
- **S1 — invalid ЕГН "valid" with age 226: CONFIRMED (sibling).** The control-sum was fixed on the frontend (`lib/egn.ts isValidEgnChecksum`), which kills the *"invalid-shown-as-valid"* half. The surviving sibling: a **checksum-valid** ЕГН can still decode to age 226 because months 21–32 map to the 1800s century block and **no plausibility bound exists** anywhere. Worked example (synthetic, re-derived offline): `0021011508` → checksum valid (Σ=52, 52%11=8, control digit 8 ✓) → `dobFromEgn` → `1800-01-01` → age 226. See **P1-01** + siblings P2-02/03/04/05.
- **S2 — fabricated E00.2 thyroid diagnosis to the patient: CONFIRMED.** Hand-verified: the post-extraction validator chain (process-audio.js:486-491) grounds **only** `pridruzhavashti[]` against the transcript (`dropUngroundedComorbidities`, 815-891). The **main** diagnosis (`osnovna_diagnoza`/`osnovna_mkb`) is never grounded — it is even *trusted as a grounding anchor* for comorbidities (line 827). `validateMkbCodes` checks code *validity* (parent-accept), not truthfulness. A register-valid hallucinated code passes `/approve` (format gate only) and `patient-summary.js` restates it to the patient. See **P0-01**. (Note: area investigators 4/5/6/7 reported "not reproduced" because they inspected the comorbidity/summary-prompt layers, which are individually correct; the gap is specifically the unguarded **main** diagnosis.)

---

## P0 — patient safety / data-loss / PII-secret leak / authz bypass

### [P0-01] Fabricated MAIN diagnosis reaches the patient summary — `osnovna_diagnoza` is never grounded against the transcript   (Extraction STEP 2 + Patient summary, tubermed-backend)
- **Location:** `tubermed-backend/lib/process-audio.js:486-491` (validator pipeline order), `:815-891` (`dropUngroundedComorbidities` — only touches `pridruzhavashti`, and *uses* `osnovna_diagnoza` as a grounding source at `:827`), `:906-921` (`validateRequiredDiagnosis` — non-emptiness only), `:1074-1129` (`validateMkbCodes` — code-validity, not truthfulness); `tubermed-backend/lib/patient-summary.js` (`buildSummaryInput` passes the diagnosis verbatim); `tubermed-backend/routes/consultations.js` (`/approve` gate validates МКБ format, the patient-summary route restates).
- **Repro / evidence (lead-verified by reading the code):** The full post-extraction chain is `injectMissingVitalSpans → dropUngroundedComorbidities → correctUsOnlyCodes → validateRequiredDiagnosis → validateMkbCodes → injectGazetteerBorderlineSpans`. **None** of them check whether `osnovna_diagnoza`/`osnovna_mkb` is supported by the transcript. `dropUngroundedComorbidities` filters only `fields.pridruzhavashti` (guard `:816`, filter `:836`, write-back `:890`) and at `:827` it *adds* `osnovna_diagnoza` to the text that grounds comorbidities — so a fabricated main diagnosis both (a) escapes grounding and (b) can validate otherwise-ungrounded comorbidities. So: Claude emits `osnovna_diagnoza="Тиреоидит"`, `osnovna_mkb="E00.2"` on a transcript with zero thyroid mention → `validateMkbCodes` confirms `E00.2` is a register-valid code (it is) → `mkb_review.needs_review` stays false → `/approve` + `/export` pass → `patient-summary.js` restates it ("Диагностицирахме при Вас…"). The STEP-2 anti-fabrication prompt rule is scoped to `obektivno` only.
- **Impact:** A patient receives an **invented diagnosis as fact** in their take-home summary — anxiety, misdirected follow-up, medico-legal exposure. This is the exact E00.2 incident. The fabrication is also frozen into `ai_original_fields`.
- **Recommended fix:** Add a grounding pass for the main diagnosis parallel to `dropUngroundedComorbidities` (same (a)–(e) anchor logic over `cleanTranscript`, but for `osnovna_diagnoza`/`osnovna_mkb`). When a valid code's diagnosis text has **zero** transcript anchors, set `extracted_fields.mkb_review = { needs_review: true, reason: 'diagnosis_text_not_grounded' }` so the **existing** `/approve`+`/export` 409 gate forces doctor reconciliation, and surface it as an `uncertain_spans` marker pre-approval. Invariant to respect: don't overwrite `osnovna_diagnoza` (it must stay the spoken wording for `ai_original_fields`); only *flag*.
- **Confidence:** high.

---

## P1 — correctness that erodes trust

### [P1-01] Valid-checksum ЕГН decodes to an impossible age (226 / 127) — no plausibility bound, front or back   (Identity validation, both repos) · *seeded S1 sibling*
- **Location:** `tubermed-backend/lib/national-id.js:127-136` (`validateEgnNotFuture` — future-only) + `:138-154` (`dobFromEgn` decodes 1800s for months 21-32); `tubermed-backend/routes/patients.js:88-99` (POST stores, no warning) + PATCH (no checksum/age check at all); `tubermed-web/lib/egn.ts` + `lib/age.ts` (no bound); no DB `CHECK` on `birth_date` (migrations/001).
- **Repro / evidence (offline, synthetic):** `0021011508` → checksum valid → `dobFromEgn` `1800-01-01` → age 226. `9921011507` → `1899-01-01` → age 127. Both pass `validateEgnChecksum` and `validateEgnNotFuture` (returns null). A single-digit month typo (`11`→`21`) silently flips the century 100 years.
- **Impact:** Implausible DOB/age shown in the UI and stored. (Correctable — `birth_date` is editable via PATCH — so not data-loss, but trust-eroding and would feed any future age-driven logic.) This is the residual S1 sibling the checksum fix did not address.
- **Recommended fix:** Add `validateEgnPlausibleAge` (reject decoded age > ~150 y, or DOB < ~1900) to the validator chain in `national-id.js` and enforce **hard (400)** on POST **and** PATCH; mirror on the frontend `canSubmit` gate. One fix, both layers (this absorbs the backend-only facet the agents filed separately).
- **Confidence:** high.

### [P1-02] Loaded-patient "drop on invalid ID" fires only for ЕГН — ЛНЧ/foreign keep a stale identity (wrong-patient filing)   (New-visit form, tubermed-web)
- **Location:** `tubermed-web/app/(workspace)/app/new-visit/page.tsx:~220-241` (`egnStillValid` / drop branch gated on `next.national_id_type === 'egn'`). Documented gap: AGENTS.md known-issues.
- **Repro / evidence:** Load a ЛНЧ/foreign patient, then edit the ID to an invalid value. The drop predicate is `egn`-only, so the loaded patient's name + banner + history persist next to the mismatched ID. Because `selected` is unchanged, `handleSaveDraft`/`handleStartVisit` PATCH/POST against the **originally-loaded** `selected.id`, not the typed ID — the doctor files a visit onto patient A while believing they're working with patient B.
- **Impact:** Wrong-patient clinical-data filing (a healthcare never-event). Narrowed by ЛНЧ/foreign being rare in BG and requiring the doctor to miss the stale banner, but ЛНЧ validation is format-only so the mismatch reads as "fine" longer. P0-adjacent for the foreign-patient subset.
- **Recommended fix:** Generalize the drop predicate to all id types: port `validateLnchFormat`/foreign-format to the client and drop the loaded patient whenever `national_id_type !== 'none' && !isValidFormatForType(id)`. Invariant: banner + DOB/age persist only while the field holds a valid identity for the loaded patient.
- **Confidence:** high.

### [P1-03] Stale patient-summary cache survives a note edit → patient gets contradictory (e.g. wrong-dose) guidance   (Patient summary, tubermed-backend + web)
- **Location:** `tubermed-backend/routes/consultations.js` (`POST /:id/edit` updates `extracted_fields` but never NULLs `patient_summary`/`patient_summary_at`; the patient-summary route returns the cache when `!regenerate`); `tubermed-web/components/PatientSummaryModal.tsx` (reopen calls `load(false)`).
- **Repro / evidence:** Approve note → generate summary (caches) → edit a dose `5 mg`→`10 mg` via `/edit` → reopen the summary modal → `load(false)` returns the **pre-edit** cached summary → patient summary says `5 mg` against a `10 mg` note. The cache is invalidated only by the non-obvious "Регенерирай" button.
- **Impact:** Patient leaves with take-home guidance that contradicts the approved note — wrong dose/instructions handed over as fact. P0-adjacent (the authoritative note is correct, and it's recoverable, which keeps it P1).
- **Recommended fix:** In `POST /:id/edit`, fire-and-forget set `patient_summary = NULL, patient_summary_at = NULL`. Next `/patient-summary` regenerates from current fields. Invariant: the summary is only ever served for the *current* `extracted_fields`.
- **Confidence:** high.

### [P1-04] Documented allergy can land with NO CRITICAL card-flag — C2 is prompt-only, no deterministic backstop   (Drug safety STEP 3, tubermed-backend + web)
- **Location:** `tubermed-backend/lib/process-audio.js:~538-559` (C2 "always emit a card-flag for a documented allergy" — prompt-only, zero post-Claude validation); `tubermed-web/lib/drug-safety.ts:~353-417` (`checkDrugSafety` fires only on prescription+allergen match, so the frontend can't recover a standalone allergy flag).
- **Repro / evidence:** A transcript with a documented penicillin allergy but no penicillin-family prescription. Claude is *told* to emit a CRITICAL card-flag (C2) regardless, but `med_alerts: []` is accepted with no validator checking that every `alergii[]` entry produced a flag. The frontend net only fires on drug+allergen co-occurrence → no standalone alert. (CLAUDE.md documents C2 as a prior silent-failure class — "DO NOT RELAX C2"; the backstop is still prompt discipline only.)
- **Impact:** A documented allergy is recorded without the permanent card-flag meant to warn on **future** prescriptions; a later prescriber gets no in-system contraindication warning.
- **Recommended fix:** Deterministic post-Claude validator in `extractFromTranscript`: for each `alergii[]` entry (and clearly-asserted allergies in `anamneza`) with no matching `med_alerts` card-flag, inject a synthetic CRITICAL flag (`drug = allergen`, `action = avoid-this-group`). Never lose C2 to Haiku variance.
- **Confidence:** high.

### [P1-05] Fabricated patient denials ("не пуши", "не употребява алкохол") — prompt-only defense, no validator   (Extraction STEP 2, tubermed-backend)
- **Location:** `tubermed-backend/lib/process-audio.js:~390-392` (prompt rule "НЕ ДОБАВЯЙ ОТРИЦАНИЯ"); no validator scans `anamneza` for ungrounded denials.
- **Repro / evidence:** A short transcript ("Как сте? Добре.") can yield `anamneza` containing "Отрича тютюнопушене. Отрича употреба на алкохол." that the patient never said. Non-deterministic; nothing deterministic catches it.
- **Impact:** A fabricated denial suppresses clinical vigilance (false "denies smoking" → missed screening) and is a medico-legal liability (record implies a history was taken). Same class as the E00.2 fabrication, lower blast radius.
- **Recommended fix:** Validator scanning `anamneza` for negation cue + risk-factor noun (`отрица|няма|без|не пуши|не употребява` + tobacco/alcohol/etc.); for each ungrounded denial inject an `uncertain_spans` entry forcing confirmation before approval.
- **Confidence:** high.

### [P1-06] `injectMissingVitalSpans` can mask a REAL measurement behind a false "не е измерено" span   (Extraction STEP 2 / vitals, tubermed-backend)
- **Location:** `tubermed-backend/lib/process-audio.js:705-784` (no `cleanTranscript` access), `:714-718` (hardcoded reasons), `:486-487` (call site *has* `cleanTranscript` in scope).
- **Repro / evidence:** The validator receives only `fields`, not the transcript, so it cannot distinguish a legitimate "не е измерено" from a fabricated one. Transcript "Дишането 18 в минута" but Claude emits `ДЧ: не е измерено` → the validator injects a span reading "ДЧ не е спомената в разговора" — which is **false** and actively misinforms.
- **Impact:** A real vital is dropped and the span text tells the doctor it was "not mentioned" when it was — suppresses investigation of the discrepancy.
- **Recommended fix:** Pass `cleanTranscript` into `injectMissingVitalSpans`; before injecting a "not measured" span, search the transcript for the vital keyword + nearby number. If found, inject a *mismatch* span ("споменато в разговора, но незаписано — потвърди стойност") instead.
- **Confidence:** high.

### [P1-07] Transient `'retrying'` status is not rejected by `/approve`, `/export`, `/edit`, `/patient-summary`   (AuthZ / lifecycle, tubermed-backend)
- **Location:** `tubermed-backend/routes/consultations.js:~426-564` (retry CAS + fire-and-forget restore at `:545-551`, with a code comment acknowledging the leftover state); the four gate endpoints select no `status` column and have no `'retrying'` guard.
- **Repro / evidence:** If the fire-and-forget `error→retrying→error` restore fails, the row sticks in `'retrying'`. The gate endpoints don't check `status`, so a doctor can approve/export a note built from a **failed** re-extraction. `test-race-retry-extraction.js` exercises the async window.
- **Impact:** Stale/partial clinical data from a failed extraction can be approved and exported as final.
- **Recommended fix:** Add a `status === 'retrying'` → 409 ("консултацията се обработва") guard to `/approve`, `/export`, `/edit`, `/patient-summary`, mirroring the existing `mkb_review` 409 pattern.
- **Confidence:** high.

### [P1-08] Verbatim transcript attached to thrown error — latent full-conversation log-leak (currently contained)   (PII / GDPR, tubermed-backend)
- **Location:** `tubermed-backend/lib/process-audio.js:~181-184` (`err.transcript = rawTranscript`); `routes/transcribe.js` + `routes/sessions.js` catch blocks (today log `err.message` only).
- **Repro / evidence:** `processAudio` attaches the verbatim doctor-patient transcript (with embedded ЕГН/PII) to the thrown error. Both call sites correctly log `err.message` only **today**, with comments warning never to log the full object. The sole defense is developer discipline — any future `console.error(err)` / aggregator that serializes the error object dumps the entire conversation into Railway stdout.
- **Impact:** Time-bomb PII leak: currently safe, one careless refactor from a full-transcript + ЕГН leak into logs. Listed P1 because the impact ceiling is a GDPR-grade leak; it is **not** an active defect today.
- **Recommended fix:** Don't attach the transcript to the error. The failed transcript is already persisted to the consultation row (the fire-and-forget UPDATE) for `/retry-extraction`; have routes read it from the row, never from the error object.
- **Confidence:** high (mechanism); the leak itself is latent, not active.

### [P1-09] Rate-limit bypass via `X-Forwarded-For` spoofing on signup + pilot-leads   (Auth surface, tubermed-backend)
- **Location:** `tubermed-backend/routes/auth.js:~22-30` (`clientIp` reads the first XFF element); `routes/pilot-leads.js:~37-46`.
- **Repro / evidence:** `clientIp` takes the **first** IP from `x-forwarded-for` with no trusted-proxy validation and no `req.ip` fallback. A client rotating `X-Forwarded-For` resets the per-IP bucket, defeating the signup invite-code rate limit and pilot-leads spam limit. (Not in the auto-verified batch — the auth-surface verifier died on a transport error — re-checked by the lead; marked needs-confirmation pending the exact Railway proxy hop config.)
- **Impact:** Brute-force of the signup invite code and unbounded pilot-leads spam become possible; the primary anti-abuse control is neutralized.
- **Recommended fix:** Configure Express `trust proxy` to the actual Railway hop count and derive the client IP from the trusted position (or `req.ip`); reject/normalize spoofed XFF. Invariant: the rate-limit key must be an IP the client can't freely choose.
- **Confidence:** needs-confirmation.

---

## P2 — quality / confusing state

### [P2-01] JWT stored in `localStorage`/`sessionStorage`, 30-day lifetime, no CSP — documented-accepted, but public signup widened exposure   (Auth, tubermed-web) · *deferred-flag*
- **Location:** `tubermed-web/lib/api.ts` (`setSession`/`getSession`, plain `JSON.stringify`, no encryption); `tubermed-backend/routes/auth.js` (30-day JWTs); no CSP/X-Frame-Options in `next.config.ts`; `middleware/auth.js` (JWT-only, no second factor).
- **Repro / evidence:** `localStorage['tuber_auth']` holds the raw 30-day JWT. Any XSS/malware/physical access reads it → 30 days of full doctor impersonation. **Documented-accepted** in AGENTS.md/CLAUDE.md for the original threat model (no public signup, PIN-gated, doctor device).
- **Impact:** Large blast radius *if* a token leaks, but conditional on a separate compromise. Re-surfaced now because A4 public signup widened the population and there is still no CSP to blunt XSS.
- **Recommended fix:** Deferred per project policy — flag only. Minimum near-term: add a baseline CSP (blunts the primary XSS vector). Longer-term (own session): httpOnly+Secure+SameSite cookies + CSRF + shorter JWT with refresh.
- **Confidence:** high (mechanism); accepted-risk by policy.

### [P2-02] Century month-edge off-by-one silently flips DOB by 100 years   (Identity, both repos)
- **Location:** `tubermed-backend/lib/national-id.js:143-145` + `tubermed-web/lib/egn.ts:38-40`.
- **Repro / evidence:** months 21-32 → 1800s (−20), 41-52 → 2000s (−40). A single-digit month typo (`11`→`21`) yields an 1800s DOB accepted as valid (post-offset month still 1-12). Relies on the doctor noticing an implausible age.
- **Impact:** Data-entry typo → ~100-year-wrong DOB. Mitigated once P1-01's age bound lands.
- **Recommended fix:** Validate decoded month ∈ [1,12] explicitly; rely on the P1-01 plausibility bound to catch resulting ages.
- **Confidence:** high.

### [P2-03] Form `canSubmit` checks checksum but not `dobFromEgn` — a checksum-valid future-dated ЕГН passes the client gate   (Identity, tubermed-web) · *S1 sibling*
- **Location:** `tubermed-web/components/PatientForm.tsx` `EgnField` (`egnInvalid`/`canSubmit` now use format+checksum); the parent `canSubmit` keys on `dobFromEgn` separately.
- **Repro / evidence:** `6044034225` → checksum valid, `dobFromEgn` null (future 2044). Depending on the gate wiring a checksum-valid future-dated ЕГН can enable submit; the backend then only soft-warns. Checksum and DOB-validity are evaluated in two places.
- **Impact:** Client validation is non-authoritative for the future-dated case. Low practical reach (dates >2030).
- **Recommended fix:** Ensure the submit gate requires `isValidEgnChecksum(egn) && dobFromEgn(egn) != null` together.
- **Confidence:** high.

### [P2-04] Degenerate ЕГН (all-zeros, post-offset bad month/day, Feb-29 non-leap) passes format+checksum; backend stores NULL DOB silently   (Identity, tubermed-backend)
- **Location:** `tubermed-backend/lib/national-id.js:106-154`; `routes/patients.js:93-99`.
- **Repro / evidence:** `0000000000` passes format + checksum (Σ=0, control 0), `dobFromEgn` returns null → patient created with `birth_date = NULL` and **no** `validation_warning`. Feb-29 non-leap similar.
- **Impact:** Patients creatable with no derivable DOB/age and no signal that the ЕГН is nonsense.
- **Recommended fix:** After checksum passes, require `dobFromEgn` non-null → else 400, instead of silently storing NULL.
- **Confidence:** high.

### [P2-05] Front/back divergence on future DOB: frontend hard-blocks, backend soft-warns   (Identity, both repos)
- **Location:** `tubermed-backend/lib/national-id.js:127-136` + `routes/patients.js:98-99` (soft) vs `tubermed-web/lib/egn.ts` (hard null).
- **Repro / evidence:** A future-dated ЕГН: the frontend `dobFromEgn` returns null (blocks); the backend `validateEgnNotFuture` emits a soft warning and saves anyway → a direct API client persists a future-DOB patient the form forbids.
- **Impact:** Defense-in-depth inconsistency; medically impossible future DOBs reachable via API.
- **Recommended fix:** Make the backend future-date check hard (400) to match the frontend; NULL any legacy future-DOB rows first.
- **Confidence:** high.

### [P2-06] Comorbidity grounding path (d) is circular — a Claude-written `terapia` grounds the same Claude-emitted comorbidity   (Extraction, tubermed-backend)
- **Location:** `tubermed-backend/lib/process-audio.js:863-864` (path (d) searches `terapia` + other Claude-generated fields, incl. `osnovna_diagnoza` at `:827`).
- **Repro / evidence:** Claude writes `terapia="Амлодипин … за хипертония"` and `pridruzhavashti=["Есенциална хипертония"]`; path (d) finds "хипертония" in `terapia` and keeps the comorbidity — grounded on Claude's own output, not the doctor. (Same root family as P0-01: trusting model output as a grounding source.)
- **Impact:** A fabricated comorbidity can survive into note + summary.
- **Recommended fix:** Restrict path (d) to doctor-proximate fields (`anamneza`/`obektivno`/`izsledvania`); treat a `terapia`-only hit as WEAK grounding → inject an `uncertain_span` rather than silently keep.
- **Confidence:** high.

### [P2-07] Fabricated exam findings ("везикуларно дишане", "ритмична сърдечна дейност") — prompt-only, no cross-check   (Extraction, tubermed-backend)
- **Location:** `tubermed-backend/lib/process-audio.js:391-392` (prompt rule); no validator.
- **Repro / evidence:** A back-pain-only exam can yield fabricated normal heart/lung findings; the prompt forbids it but is non-deterministic, and no validator checks `obektivno` findings against transcript exam keywords.
- **Impact:** Fabricated normal findings can suppress appropriate investigation.
- **Recommended fix:** Validator flagging major-system `obektivno` findings with no corresponding exam keyword in the transcript via `uncertain_spans`.
- **Confidence:** needs-confirmation.

### [P2-08] Borderline drug-name corruption left uncorrected can miss a safety match if STEP 2 also fails to normalize it   (Drug safety / gazetteer, tubermed-backend)
- **Location:** `tubermed-backend/lib/vocabulary/gazetteer.js:~296-381`; `process-audio.js:~233-244,491`.
- **Repro / evidence:** Distance-2/ambiguous matches are flagged borderline (`uncertain_span`) but **not** rewritten, so a misspelled drug can reach STEP 2/3. (Verification narrowed this from the original P1: STEP 3 reads STEP 2's *extracted* fields, borderlines surface as doctor-review spans, and the originally-cited case was actually a confident distance-1 rewrite.)
- **Impact:** Real but narrow — only a borderline misspelling that *also* survives STEP 2 normalization can miss a safety match; the `uncertain_span` is a pre-approval review gate.
- **Recommended fix:** For critical families (anticoagulants/beta-blockers/statins/allergen drugs), tighten auto-correct to distance ≤1; ensure borderline spans always reach the doctor.
- **Confidence:** needs-confirmation.

### [P2-09] Disclaimer split fails silently if the marker phrase drifts   (Patient summary, tubermed-web)
- **Location:** `tubermed-web/components/PatientSummaryModal.tsx:~47-58` (`splitSummary` exact-substring on "не замества медицинска консултация").
- **Repro / evidence:** If the model emits a variant ("не заменя…") the marker match returns −1 → the disclaimer is swallowed into the editable body and `DISCLAIMER_FALLBACK` is appended → risk of a duplicate/misplaced disclaimer, breaking the "exactly once, non-editable" invariant.
- **Impact:** Disclaimer-integrity invariant degrades to depend on an exact string.
- **Recommended fix:** Have the backend return structured `{ body, disclaimer }` (no marker-parsing), or use a stable sentinel and keep backend `DISCLAIMER` ↔ frontend `DISCLAIMER_FALLBACK` in sync via a check.
- **Confidence:** high.

### [P2-10] `recoverVisitId` never reset after recovery — diverges from documented invariant (latent loop hazard)   (Reliability, tubermed-web)
- **Location:** `tubermed-web/lib/use-cold-start-recovery.ts:~53-75`; `app/app/scribe/page.tsx:~97-169`.
- **Repro / evidence:** The status→destination matrix is acyclic and the 401 carve-out is intact, but `recoverVisitId` is never nulled after `phase='recovered'` (contrary to AGENTS.md). Re-fetch is prevented today only by the `[visitId,page]` dep array — no live loop, but a future deps change could resurrect one.
- **Impact:** No current loop; latent maintenance hazard + contract divergence.
- **Recommended fix:** Reset `recoverVisitId` to null when `phase` becomes `'recovered'`, restoring the documented invariant.
- **Confidence:** high.

---

## P3 — polish / hardening

### [P3-01] `POST /:id/edit` clamps `pridruzhavashti` to 4 silently — response doesn't reflect the clamp   (API contract, tubermed-backend)
- **Location:** `tubermed-backend/routes/consultations.js:~209-211`.
- **Repro / evidence:** A direct API client sending 5 comorbidities gets 200 + `edit_count+1` while only 4 persist (`console.warn` only). The web UI caps at 4, so impact is limited to non-UI clients.
- **Impact:** Response misrepresents persisted state for API callers.
- **Recommended fix:** Echo the post-clamp array, or 400 instead of silently slicing.
- **Confidence:** high.

### [P3-02] Error responses echo raw Postgres/Supabase messages (schema enumeration)   (PII/hardening, tubermed-backend)
- **Location:** `tubermed-backend/routes/patients.js:273,361,384,483,489` (`res.status(500).json({ error: error.message })`).
- **Repro / evidence:** A 23505 surfaces "duplicate key value violates unique constraint idx_patients_id_hash", leaking index/column names (`organization_id`, `national_id_hash`). (Verification: schema disclosure, **not** PII — ranked low.)
- **Impact:** Internal schema/constraint names leak; aids targeted attacks. No PII in the message.
- **Recommended fix:** Return a generic Bulgarian 500; log `error.message` server-side only. Keep the actionable 409 dedup case.
- **Confidence:** high.

### [P3-03] PIN login path lacks a dummy-hash compare — org/doctor-existence timing leak   (Auth, tubermed-backend)
- **Location:** `tubermed-backend/routes/auth.js:~227-237`.
- **Repro / evidence:** Email login burns `DUMMY_PASSWORD_HASH` on misses, but the PIN path runs `bcrypt.compare` only when org+doctor exist → wrong org/doctor returns ~10 ms vs ~200 ms — enumerable.
- **Impact:** An attacker can time-probe valid `organizationSlug`s. Low (clinic list largely public).
- **Recommended fix:** Unconditionally run `bcrypt.compare` against `DUMMY_PASSWORD_HASH` on any PIN-path miss.
- **Confidence:** high.

### [P3-04] ЛНЧ has no checksum (format/length only); foreign ID has no validation   (Identity, tubermed-backend)
- **Location:** `tubermed-backend/lib/national-id.js:162-165`; `routes/patients.js:100-103`.
- **Repro / evidence:** `validateLnchFormat` accepts any 10 digits; foreign IDs accept any non-empty string.
- **Impact:** Garbage ЛНЧ/foreign IDs storable; compounds P1-02.
- **Recommended fix:** Implement the ЛНЧ checksum if the spec is available; add a length cap + trim for foreign IDs; document foreign IDs as accepted as-is.
- **Confidence:** high.

### [P3-05] Shared `resolvedRef` across session cycles is fragile under two-tab / rapid-switch races   (PhoneMode / WS, tubermed-web)
- **Location:** `tubermed-web/app/app/scribe/page.tsx:~635` (component-level `resolvedRef`), `:740-847`.
- **Repro / evidence:** `resolvedRef` is component-level, not per-session; a prior session's poll can set it true. (Verification: the synchronous `cancelledRef` gating + `init()` reset + 2.5 s poll fallback prevent an actual stall today → code-smell, not exploitable.) **Investigated + documented only — do not refactor.**
- **Impact:** No data loss today (poll fallback recovers); fragile to future reordering of the gating.
- **Recommended fix (note, not action):** Scope `resolvedRef` per session-init closure; document the one-active-session-per-tab assumption.
- **Confidence:** needs-confirmation.

### [P3-06] ЕГН hash uses SHA-256+pepper rather than PBKDF2/Argon2 (Tier-3 deferred)   (PII/hardening, tubermed-backend) · *deferred-flag*
- **Location:** `tubermed-backend/lib/national-id.js:89-96`.
- **Repro / evidence:** ЕГН hashed with SHA-256+pepper; the 10^10 ЕГН space is brute-forceable (~hours) **only** if the hash store and pepper both leak. Documented Tier-3 deferred.
- **Impact:** Latent; exploitable only under simultaneous DB-hash + pepper compromise.
- **Recommended fix:** Flag only — TODO to migrate to PBKDF2(≥100k)/Argon2 + key rotation if ЕГН hashes are retained long-term.
- **Confidence:** high.

### [P3-07] Aggressive transliteration collapsing yields false-positive name matches on short names   (Name search UX, both repos)
- **Location:** `tubermed-backend/lib/translit.js:38-44` + `tubermed-web/lib/translit.ts:38-52`.
- **Repro / evidence:** `normalizeLatin('Anny') === normalizeLatin('Ani')`; `y→i`, double-consonant, `z→s` collapse short names together → trigram search returns ambiguous pairs. The confirm modal (name+last4+DOB) disambiguates, so a wrong-patient load needs a careless pick.
- **Impact:** Minor wrong-patient-load risk under time pressure; mitigated by the confirm modal. **Not** a tenant/security issue — the RPC is org-scoped and parameterized (verified, see Appendix A).
- **Recommended fix:** Apply a `pg_trgm` similarity threshold (≥0.7) and avoid `y→i`/double-consonant collapsing on very short names.
- **Confidence:** needs-confirmation.

---

## Appendix A — Verified CORRECT / refuted (checked and cleared)
These were filed by an investigator and then **refuted** by adversarial verification — listed so they aren't re-chased:
- **Cross-org isolation holds.** `GET /api/consultations/:id` and `POST /:id/consent` carry the `organization_id`/`assertOrgOwnership` filter; cross-org returns 404, not a leak. (Initial "IDOR / missing org filter" claims were wrong — both `.eq` filters present.)
- **`/patient-summary` IS gated on `note_approved`** (the "approval gate missing" claim was false).
- **`POST /api/visits/start`** strips `organization_id` before returning (explicitly deleted).
- **Admin `X-Admin-Secret`** uses a timing-safe compare; no JWT bypass.
- **Result-page edit-flush data-loss fix is INTACT** — `fieldsRef.current` (not stale closure) + flush-on-unmount + double-flush guard all present.
- **`/retry-extraction` first-write-wins** — `ai_original_fields` `.is(null)` guard correctly enforced; 409/502 paths correct; no edit clobber (gated to `status='error'`).
- **`mergeBackendAlerts` dedup** does not drop a CRITICAL by spelling mismatch (both sides read the same `extracted_fields`; the real residual is shared gazetteer blindness → folded into P2-08).
- **Name-search RPC** (`search_patients_by_name`) is org-scoped + parameterized — no SQL injection / cross-tenant enumeration (the transliteration false-positive is UX only → P3-07).
- **ЕГН auto-load stale-closure race** — the reqId guard prevents the described flash.
- **`/me` practice fields** degrade cleanly on a pre-017 DB on all render paths.

## Appendix B — Deferred / accepted-risk (flag, don't fix)
- **P2-01** JWT-in-localStorage + 30-day token + no CSP (documented-accepted; re-rate given public signup).
- **P3-06** ЕГН-hash SHA-256+pepper → PBKDF2/Argon2 + key rotation (Tier-3 deferred).
- **JWT in WebSocket query string** (`wsUrl()`), `?token=` lands in proxy logs — documented-accepted today.
- **P3-05** PhoneMode/WS two-tab races — investigated + documented per instructions; **not** refactored.

## Method & caveats
- Pure static analysis + offline synthetic computation. No backend was run, no external service (Supabase/Anthropic/Soniox) called, no DB read/written, no production touched.
- The extraction-fabrication findings (P0-01, P1-05, P1-06, P2-06/07) describe *gaps in the deterministic safety nets* around a non-deterministic model — they are reproducible **as code paths**, not as guaranteed single-prompt outputs. The fix in every case is a deterministic validator/gate, not a prompt tweak.
- One verifier (auth-surface) failed on a transport error mid-run; P1-09 and the P3-03 timing item were re-checked by the lead by hand and carry `needs-confirmation` where a live proxy/timing measurement is required.
- Severities follow the project rubric; the lead reconciled the multi-agent pass's 4×P0 down to 1×P0 with the transparent rationale in the executive summary.
