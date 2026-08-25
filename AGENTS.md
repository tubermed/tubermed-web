<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# What this repo is

TuberMed's frontend: Next.js 16 app on Vercel (`app.tubermed.com`) — the doctor-facing
workspace (identity-free start-visit card, notes library, scribe recording, editable
Амбулаторен лист, exports) plus the public marketing landing. The API is `tubermed-backend/` (Node/Express on Railway EU) —
its contract and gates are documented in that repo's `CLAUDE.md`. All user-facing strings
are Bulgarian; code, comments, and commit messages are English.

# Non-negotiable invariants

- **VERIFICATION INFRASTRUCTURE IS PRODUCTION (standing rule, 2026-08-19).** Every rule
  about the deployed app — no cross-repo reads, no environment assumptions, no silent
  degradation — applies **identically** to scripts, harnesses, gates and guards.
  **A harness that degrades silently is worse than a broken feature, because it
  certifies the product while blind.** Six instances, all in tooling rather than the
  product: a boundary guard that could not see itself; a replay that measured
  UNCOMMITTED code and reported it as the committed contract; a detector that flagged
  its own correction map; `\b` in three separate new gates, invisible until `git add`,
  twice after we knew; a support filter applied after the DB limit, answering „никога не
  се е чупило"; and the backend's replay harness reading THIS repo through
  `../tubermed-web/…`, which resolves on one laptop on earth and left backend CI red on
  `main` since it existed. That last one is the sharpest, because **the rule already
  existed** — the cross-repo-read line in "Known gotchas" below was written, then broken
  in a test harness, because nobody thinks of a test harness as production. Concretely:
  a gate may not assume an untracked file is present (`git add` before trusting a
  green), must state its own coverage when it skips, and must be run from a **clean
  clone** before any push (`npm run verify:clean-clone`).
- The doctor is the legal author: notes are editable, approval (`✓ Потвърждавам`) gates
  export and the patient summary — never bypass or fake the approval state client-side.
- No patient identity: TuberMed keeps **no patient records** — there is no ЕГН or name
  field anywhere in the workspace (identity removal, 2026-07). No PII in URLs, browser
  history, `sessionStorage`, logs, or commits; synthetic data only in tests and fixtures.
- EU-only browser traffic: cross-origin requests go to the EU backend and EU Sentry
  ingest ONLY (enforced by the derived CSP `connect-src`). Note: the backend's own
  extraction call currently goes to US `api.anthropic.com` pending the Bedrock EU
  migration — see `tubermed-backend/CLAUDE.md`; nothing in the browser talks to it.
- Landing pages respect `prefers-reduced-motion` (effects collapse to final static state).

# Git & session law — work on `master`, no feature branches

All work lands directly on **`master`**, one commit per change; Dimitar reviews the
diff and **pushes** (never push yourself, never `--force`). If a task prompt says to
create or branch off a feature branch, **ignore that and work on `master`** — it's the
standing repo convention, not a per-task choice. Stage only the files you changed
(`git add <file>`, never `-A`), and never stage or revert files you didn't edit — if
`git status` shows unexpected modifications (desktop-sync EOL mangling), leave them
unstaged and report. Verify-first: task prompts and audits can be stale — confirm their
claims against the real code before editing; if reality disagrees, stop and report.

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

## Other hazards
- The desktop file-sync can corrupt the working tree / mangle EOLs; if `.git` or HEAD
  won't resolve, stop and tell Dimitar to restore from a real terminal.
- Close GitHub Desktop before git operations (`index.lock` contention).

# Verification gates (before every commit)

`npm run build` · `npx tsc --noEmit` clean · **`npm run lint:ratchet`** — zero NEW
findings vs the recorded baseline (don't chase pre-existing ones). `npm test`
(added 2026-07-28) is plain `node --test scripts/*.test.ts` — **no runner, no loader,
no test dependency**: Node 24 strips the types natively. It covers only DOM-free logic
modules (today `lib/stt-stream.ts`); anything touching React or the DOM still has to be
verified in a live local browser (preview tools freeze CSS transitions/rAF — don't trust
them for animated state; say what you couldn't exercise headlessly).

**The accepted lint residual is a NUMBER IN EXACTLY ONE FILE: `.eslint-baseline.json`.**
Do not restate it here — a count typed in two places is a count that will disagree with
itself, and `scripts/lint-ratchet.test.ts` fails if this file starts repeating it. The
file carries the counts, per rule, plus the reason the residual is accepted.

⚠ **The gate is a RATCHET, not a ceiling (2026-08-19).** More findings than the baseline
fails, as expected — but FEWER findings also fails, with a different message: lower the
baseline in the same commit. Unclaimed headroom silently absorbs the next regression,
which is how a baseline drifts back up to where it started. `npm run lint:ratchet --
--update` rewrites the file.

⚠ **Why this replaced bare `npm run lint` in CI:** the workflow ran plain eslint, which
exits 1 on any error, so the job was **red on `master` from the day it was added**. A job
that is always red teaches whoever reads it that red is what that job looks like, and a
real failure then scrolls past unread — the ignorable-gate shape, arriving at the level of
the thing that guards everything else. It was also asserting the wrong predicate: the rule
above is *zero new findings*, not *zero findings*, so the rule was satisfied while the
gate failed. The gate was wrong, not the code. The 21 `react-hooks/set-state-in-effect`
+ `immutability` errors stay on the backlog: fixing them means restructuring effects
across 8 files, which changes render behaviour on the scribe and result pages and needs a
live-browser pass plus review — not a side effect of a CI cleanup.

**Dependencies — `npm audit --omit=dev`, and it MUST say ONLINE (2026-08-07).**
⚠ **`npm audit --offline` prints „found 0 vulnerabilities" and exits 0 in BOTH repos
while HIGH advisories are live** — with no advisory database to consult it reports
nothing and calls that nothing a clean bill of health. A gate that checked nothing must
never read as green; if the machine has no network, the check did not run. Fix with
`npm audit fix`; **NEVER `--force`** (see known-gotchas). Measured 2026-08-07: 6 → 3
(`@babel/core`, `brace-expansion`, `fast-uri` fixed).

**DONE 2026-08-07 — `next@16.3.0` shipped, `npm audit --omit=dev` (online) now reports
0 vulnerabilities.** It cleared all 3 HIGH (`next`, `postcss`, `sharp`) at once.

⚠ **`npm install next@16.3.0` REWROTE THE EXACT PIN to `^16.3.0`** — restored by hand to
`16.3.0`. The pin is deliberate (so are `react`/`react-dom` at `19.2.4`): it is why npm
demanded `--force` in the first place, `--force` being the flag that installs next@9.3.3
and destroys the app. If a bump is ever needed again, `npm install next@<exact>` then
**check `package.json` and put the pin back** — the loosened range is easy to miss in a
lockfile-heavy diff, and a caret on the framework is how an unreviewed minor arrives on
its own.

⚠ `devDependencies.eslint-config-next` is still `16.2.6` and now trails `next`. Lint is
unaffected (the baseline held — see `.eslint-baseline.json`), so it was left alone rather
than risk moving the baseline in a dependency batch — but they should be bumped together
next time.

Gate run for the bump, per the rule below it: `npm run build` clean, all five `/app/*`
shells still `ƒ`, `tsc` clean, 179/179, lint at baseline.

# Identity-free visit start + notes library

The workspace keeps **no patient records** — no ЕГН/name field, no search, no dedup. The
whole patient surface (`PatientForm`, `PatientSearch`, `PatientResultRow`,
`PatientLoadConfirmModal`, `EgnSwitchGuardModal`, `DedupModal`, `RevealEgnButton`,
`TodayConsultations`, `lib/egn.ts`, `lib/national-id.ts`, `lib/age.ts`, the `/app/patients`
page + its nav entry) was **removed** (W1–W3, `45b0dac`→`9eda9cb`). Do NOT reintroduce any of it.

- **Start a visit (`components/StartVisitCard.tsx`).** `app/(workspace)/app/new-visit/page.tsx`
  is one click from empty page to recording: visit type + document template + optional chief
  complaint + „Започни запис" — **no submit gate and no identifier field**. Staging POSTs no
  `patient_id` (backend `visits/start` accepts this); the `PendingVisit` payload carries visit
  context only, and `sessionStorage` holds zero identity.
- **Notes library (`components/NotesLibrary.tsx`).** The path to every note: `GET /api/consultations`
  rendered newest-first, grouped by Sofia day, `status`-filterable, paginated („Покажи още").
  Rows are the visit's auto-generated label (time, chief complaint, visit type, diagnosis,
  status pill) and link to the visit itself — result page for filed notes, scribe for in-flight
  ones. It subsumes the old today-rail (today's visits are its newest group) and replaces the
  patients-history view; `StatusPill` / `STATUS_LABEL` / `visitHref` are shared from here.
- **Visit header (`components/VisitHeaderStrip.tsx`, replaces `PatientHeaderStrip`).** Rebuilt
  from the consultation row's OWN metadata (created_at, visit type, chief complaint) — never
  a patient. The flow stepper's first stage is „Преглед", not „Пациент".
- **Cold-start recovery (`lib/use-cold-start-recovery.ts`).** A `patient_id`-NULL row is NOT
  unrecoverable — recovery no longer fetches a patient; it renders the header from the `?visit=`
  row's metadata alone. Keep this identity-independent.

# Standing rules — Sentry, CSP, design tokens

- **Sentry:** Replay OFF, tracing OFF: rates 0, no `replayIntegration`; `instrumentation-client.ts` runtime-strips `browserTracingIntegration` (tree-shake no-ops on Turbopack). `sendDefaultPii: false`; `lib/sentry-scrub.ts` `scrubEvent` as `beforeSend` at every init site; EU ingest only. Never `@sentry/wizard`.
- **CSP:** `contentSecurityPolicy()` in `lib/csp.ts` (pure module so `npm test` can pin it — `scripts/csp.test.ts`), shipped by `next.config.ts` `headers()` (prod-only; rebuild). `Permissions-Policy: microphone=(self)` MANDATORY — the scribe records; removing it breaks recording. `connect-src` DERIVED, never hardcoded — `backendConnectOrigins()` (`NEXT_PUBLIC_BACKEND_URL`); `sentryConnectOrigins()` (`lib/sentry-csp.ts`) EU-guarded (`*.ingest.de.sentry.io`) — with ONE deliberate constant exception: `SONIOX_RT_CONNECT_ORIGIN` (`wss://stt-rt.eu.soniox.com`, the stt-rt streaming leg's destination; server-authored `ws_url`, so no client env var exists to derive from — frontend mirror of backend `lib/soniox-stream.js` `SONIOX_RT_WS_URL`, change TOGETHER). ⚠ A connect-src miss is invisible offline (prod-only header, socket-faking tests) and fails LIVE on every visit — omitting the Soniox origin shipped exactly that outage (2026-07-29, every streamed visit degraded at socket open). Cross-origin = EU backend + EU Soniox realtime + EU Sentry ONLY — never US/Google/non-EU.
- **Colours:** tokens in `globals.css` `@theme` (that file is the source of truth); never hardcode. No gradients on clinical surfaces; only auth/brand panels may use `--brand-panel-*`. Scribe QR `fgColor` stays literal `#1C2B44` synced to `--brand-panel-base` (vars break export).

# Live transcription (stt-rt-v5) — the scribe streams while recording

`lib/stt-stream.ts` wraps ONE websocket per visit; `PcMode` in `app/app/scribe/page.tsx`
drives it. Three rules, all load-bearing:

- **The MediaRecorder buffer is never sacrificed.** `ondataavailable` pushes every chunk
  to `chunksRef` exactly as before AND hands it to the socket. `blobRef` is released at
  exactly one point in the file: after the server confirms the transcript is persisted.
  A dropped connection must cost latency, never the visit.
- **A drop is TERMINAL — never add a mid-visit resume.** Reconnecting means either a hole
  in the transcript (what was said while the socket was down) or a duplicated boundary;
  a silent hole in a medical note is worse than losing the latency win on one visit.
  `degraded` is a one-way latch guarded twice (handler detachment + an in-handler check);
  the "can NEVER recover" test fails only if BOTH are removed.
- **Chunks recorded before the socket opens are QUEUED, not dropped.** Chunk 1 carries the
  WebM/EBML header — drop it and Soniox gets headerless clusters it cannot decode at all.
- Falling back to the audio upload is allowed ONLY on a 400 from the submit (our own shape
  validation, which runs before the server claims the row). Any other server response means
  the row already advanced and re-uploading would 409 into a dead end.

`ws_url` and `config` are **server-authored** (`StreamKeyResponse`) — never rebuild the EU
endpoint or the specialty vocabulary payload client-side.

- **The non-final hypothesis is DISPLAY ONLY.** Soniox sends its current hypothesis
  (replaced wholesale each frame) alongside finalized text; we were already receiving and
  discarding it, which was the whole ~10 s of apparent lag in the live panel. It is rendered
  greyed beside the finalized tail on BOTH the PC panel and the phone strip, and never
  contributes to the submitted transcript — only finalized text does.
- **Degrade + timing telemetry is a cross-repo contract.** When a visit that tried to stream
  lands on the async upload, the fallback request carries the failure CLASS in
  `X-Stream-Degraded`; on the `rt` path the submit reports `finalize_ms` and
  `stop_to_submit_ms`. The backend validates the header against a strict slug pattern and
  clamps the client timings (`clampClientMs`), so both are **untrusted input by design** —
  they may only ever be short enums and numbers, never free text. Header name and field names
  must change in BOTH repos together (backend `routes/transcribe.js` + `lib/analytics`).

# Known gotchas

- **The five `/app/*` shells are `force-dynamic` ON PURPOSE (edge-cache poisoning, 2026-07-28/29):** a corrupted Vercel edge-cache object made `/app/scribe/result` unloadable at the browser level twice in 48h with the code provably clean. The config lives in two server pass-through layouts — `app/app/layout.tsx` and `app/(workspace)/app/layout.tsx` — do NOT delete them to "restore static optimization" (the shells are auth-gated; the prerender bought ~tens of ms), and do NOT move the export into the pages: segment config in `'use client'` files is **silently ignored** (routes stay ○ Static — that near-miss happened in this very change; only the build's ○→ƒ flip proves it took). `headers()` Cache-Control can't do this either (Vercel overrides it on prerendered output). Post-deploy check: `node scripts/probe-shell-cache.mjs` must show every shell uncached (exit 0).
- **Never "simplify" the result-page edit flush (silent data loss):** keep (1) `flushEdit` reads `fieldsRef.current`, never a captured `fields`; (2) flush-on-unmount (guard: `pendingEditField.current`). Stale closure dropped lone/last edits while `edit_count` bumped.
- **Deploy hazard:** Vercel ships only tubermed-web, Railway only tubermed-backend — cross-repo reads ENOENT in prod. Use committed in-repo mirrors; `public/` is browser-only. Flag cross-repo runtime reads.
- **Three review systems — never conflate:** vital-range warnings (`lib/vital-rules.ts`), amber AI-uncertainty spans (`lib/uncertain-spans.ts`, advisory, no gate), source traceability. New span surfaces: match `mkbReviewCopy`.
- **Mockup drift — „a depiction is a claim" applies to `components/landing/` too (class, 3 instances, `docs/history/2026-08.md`).** A landing mockup depicts the product, so it asserts things about it — and it is the only code here with no test, no user report and no build gate that can catch it being wrong. It has drifted in all three directions: showing a feature the product **removed** (`Пациенти` nav, `8c92891`), claiming a capability the product **disabled** (clinical alerts, `08ef2cf` + `f265f47` for what that sweep missed), and showing a field the product had **never built** (`Алергии` — extracted since day one, rendered nowhere until `4c5ae4f`). **A change to what the product does is not done until the mockups depicting it are re-read.** `TuberMedHeroLoop.tsx` draws a лист, so it makes field-level claims — grep it when a field's render status changes. Re-read the WHOLE component: two sweeps have now corrected a header and left the card body (`08ef2cf`→`f265f47`, and the 2026-08-05 batch), so grepping for the reported string and stopping is how this class survives. `TuberMedHeroDesktop.tsx` was **deleted** 2026-08-05 — it had been parked and unrendered since 2026-06-29 while still drawing an `ЕГН` field, a named patient and a patient day-list; a mockup nobody renders is a mockup nobody re-reads.
- **Patient-summary 429s:** calm notice, never the red error; regenerate-429 preserves on-screen summary + unsaved edits; wording from server `error` only.
- **postcss CVE: DEFERRED, not reachable. NEVER `npm audit fix --force`** — installs next@9.3.3, destroys the app.
- **Clinical alerts are OFF and must stay off (2026-08-01, Dimitar's ruling).** MDR qualification turns on INTENDED PURPOSE: software that SELECTS a drug/allergy pair and surfaces it performs a clinical act whatever the wording. `NEXT_PUBLIC_CLINICAL_ALERTS` (`lib/clinical-alerts.ts`) defaults OFF; with it off `mergeBackendAlerts` is never called, so `safetyAlerts` is empty and the CRITICAL banner, warnings panel and MedsPanel row flags all disappear on their existing length conditions. **There is deliberately NO empty state** — „няма открити рискове" is itself a clinical claim. ⚠ Gating the backend alone is NOT enough: `lib/drug-safety.ts` `checkDrugSafety()` is our OWN client-side rule engine (8 allergy + 4 interaction rules) and `mergeBackendAlerts` calls it unconditionally, so an empty backend `med_alerts` still produced alerts. The engine stays in the repo, tested and reversible by config — flag it, never delete it. Landing/marketing copy must carry no interaction/safety claim (swept 2026-08-01).
- **`med_alerts` must flow through `mergeBackendAlerts()`** — never revert to bare `checkDrugSafety()`; `/edit` posts the FULL `fields` object. `lib/types.ts` must match the backend's JSON (contract edits touch both repos).
- ⚠ **A REQUIRED type the backend does not GUARANTEE is a defect class, and tsc cannot catch it (2026-08-03).** `DiagnosisLine` typed `code: string` and called `code.trim()`; the backend then began `delete entry.mkb`, throwing a TypeError in the **SEALED** лист render — the one artefact with no recovery path. The type was not wrong about itself, it was wrong about the runtime, so nothing flagged it. When a backend change makes a key absent, sweep CONTRACT-first: every key the backend can omit (`delete fields.*`/`delete entry.*` + the absent-when-empty keys) × every required-typed field in `lib/types.ts` × every unguarded dereference. Prefer fixing at the CHOKE POINT — `escapeHtml` accepts `string|null|undefined` because it is the class, while its call sites are only instances. Known residual: `Medication.inn` is typed required and the backend never normalises it (latent — measured 0 of 677 rows).
- **`mkb_correction { from, to?, rule }`** (on `pridruzhavashti[].mkb_correction` and `osnovna_mkb_correction`) records that a filed МКБ code differs from what the model emitted. `pridruzhavashti[].mkb` is **ABSENT (never `''`)** when stripped — readers must treat absence as "no code" and never dereference it unguarded. `rule` is a CLOSED union and **all doctor-facing Bulgarian is rendered HERE** (`mkbCorrectionCopy`, `lib/mkb-review.ts`) from that union — the backend sends no prose, and an unrecognised rule must render NOTHING rather than guess. Adding a rule backend-side fails `scripts/mkb-correction-copy.test.ts` until the copy is written (same mirror discipline as the investigation templates). It is an AI-uncertainty surface → **gold, never `--color-warn`**.
- ⚠ **CROSS-REPO MIRROR INVARIANT — investigation templates:** `lib/echo-template.ts`, `lib/pacemaker-template.ts` and `lib/ekg-template.ts` are the committed display mirrors of the backend's `lib/templates/echo-v1.js` / `pacemaker-v1.js` / `ekg-v1.js` (labels/units/dot-paths/kind/refNorma, plus ЕКГ's `EKG_RENDER_STYLE`). A backend template change and its mirror must land TOGETHER (same discipline as `public/ial-inns.json`/`mkb10.json`). The echo descriptor serves BOTH the standalone echo note AND embedded `izsledvania_blocks` cards via `lib/investigation-blocks.ts` — keep both containers in lockstep; pacemaker and ekg are EMBEDDED-only (no standalone notes — backend `VALID_NOTE_TYPES` gates them) and are WORKING DRAFTS pending Соколов validation. ekg is the LIGHT block: `renderStyle:'paragraph'` makes BOTH the on-screen card and the exporters render its values as ONE prose paragraph (one source of truth, `f6a36c3`) — don't regress it to label rows. Aliases + plausibility bounds stay backend-only.
- **`izsledvania_blocks` contract (embedded investigations):** a SIBLING key on the консултация fields — ABSENT (never `[]`) when there are no blocks; `izsledvania`/`naznacheni` stay flat strings. Block-local `uncertain_spans` live inside `block.fields` with dot-path `field` keys relative to the block; block edits round-trip via those dot-paths (C6) and `/edit` still posts the FULL `fields` object. `block.source` + `field_sources` offsets index the RAW transcript — never re-derive them client-side. Don't change the shape or the 3-state source UI (намерен източник / няма ясен източник / opt-in предположение) without a cross-repo task.

# History

Dated session write-ups (2026-06 onward) live in `docs/history/<YYYY-MM>.md`; the verbatim
pre-slim versions of the sections above are in `docs/history/archive-2026-07-pre-slim.md`.
Read the relevant month when a task references past work — they are not loaded by default.
