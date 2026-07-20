<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# What this repo is

TuberMed's frontend: Next.js 16 app on Vercel (`app.tubermed.com`) — the doctor-facing
workspace (new-visit form, scribe recording, editable Амбулаторен лист, exports) plus the
public marketing landing. The API is `tubermed-backend/` (Node/Express on Railway EU) —
its contract and gates are documented in that repo's `CLAUDE.md`. All user-facing strings
are Bulgarian; code, comments, and commit messages are English.

# Non-negotiable invariants

- The doctor is the legal author: notes are editable, approval (`✓ Потвърждавам`) gates
  export and the patient summary — never bypass or fake the approval state client-side.
- PII discipline: plaintext ЕГН only per the workflow rules below; no PII in URLs,
  browser history, logs, or commits (fake ЕГНs/names only in tests and fixtures).
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

`npm run build` · `npx tsc --noEmit` clean · `npm run lint` introduces **zero new**
findings vs the pre-existing baseline (don't chase pre-existing ones). No unit-test
runner in this repo — verify interactive behavior in a live local browser (preview
tools freeze CSS transitions/rAF — don't trust them for animated state; say what you
couldn't exercise headlessly).

# New-visit ЕГН workflow

`app/(workspace)/app/new-visit/page.tsx` + `components/PatientForm.tsx` — deliberate rules, do NOT "simplify":

1. **Submit gate:** `canSubmit` includes `!egnInvalid` (egn, 10 digits, DOB underivable). Keep the gate.

2. **Lookup lives INSIDE the form — no top search bar** (`PatientSearch`: patients page only).
   (A) **Name typeahead:** Име/Презиме/Фамилия debounce `searchPatients` (fuzzy, transliterated) → dropdown. Ambiguous → a pick opens `PatientLoadConfirmModal`: [Зареди данни] loads the full record (incl. allergies/chronic — drug-safety); [Отказ] keeps the typed name, reopens the dropdown. The only confirm-before-load path.
   (B) **Full valid 10-digit ЕГН → instant auto-load:** derives DOB/gender/age locally (no network) AND fires the backend exact-hash lookup. Match → auto-loads IMMEDIATELY (no dropdown/click); no match → new patient with derived fields. Backstop: the name appears instantly — a typo surfaces the wrong patient.
   `EgnField` owns all ЕГН input, keyed by patient id (stale-guard resets). "× Изчисти" → `handleClearSelection`: direct `setForm(EMPTY_FORM)`, bypassing the interceptor.

3. **Plaintext ЕГН on new-visit ONLY** (no mask/reveal link/"Смени"); patients page keeps masked last-4 + `RevealEgnButton` + 30s auto-hide. `fromPatient()` blanks `national_id` for ALL callers — plaintext NEVER comes from `getPatient`/search (GDPR). (a) auto-load re-applies the doctor-typed value; (b) typeahead: audit-logged `revealNationalId` ONCE on confirm-load (confirm = authorization; no auto-hide). Fetch plaintext ONLY via `revealNationalId`.

4. **ЕГН-switch guard (`EgnSwitchGuardModal`).** Loaded patient with unsaved record edits + ЕГН change → HELD; modal lists changed fields (`changedEditableLabels`). [Запази] PATCHes the current patient FIRST (edits never lost), then swaps to an empty form + new ЕГН + derived DOB/gender; `chief_complaint` + `visit_type` CLEARED on BOTH patient-change paths — NO path may carry one patient's visit context to another; do NOT restore preserving. [Отказ] reverts, keeps edits. Fires on the FIRST divergence. `changedEditableLabels` EXCLUDES `birth_date`/`gender` (derived; including them misfired; still PATCHed via `persistPatient`). No unsaved edits → no guard; once the ID is invalid for its type (egn = 10 digits + DOB + checksum; lnch = 10 digits; foreign = non-empty; `shouldDropLoadedPatient`, `lib/national-id.ts`), `handleFormChange` DROPS the patient (clears identity + visit context; valid retype re-loads). Save-time last4 guard (`handleSaveDraft`/`handleStartVisit`) backstops a valid-but-different id.

5. DEFERRED: patient-switch edit migration; revisit only if pilots ask.

# Standing rules — Sentry, CSP, design tokens

- **Sentry:** Replay OFF, tracing OFF: rates 0, no `replayIntegration`; `instrumentation-client.ts` runtime-strips `browserTracingIntegration` (tree-shake no-ops on Turbopack). `sendDefaultPii: false`; `lib/sentry-scrub.ts` `scrubEvent` as `beforeSend` at every init site; EU ingest only. Never `@sentry/wizard`.
- **CSP:** `contentSecurityPolicy()` in `next.config.ts` `headers()` (prod-only; rebuild). `Permissions-Policy: microphone=(self)` MANDATORY — the scribe records; removing it breaks recording. `connect-src` DERIVED, never hardcoded — `backendConnectOrigins()` (`NEXT_PUBLIC_BACKEND_URL`); `sentryConnectOrigins()` (`lib/sentry-csp.ts`) EU-guarded (`*.ingest.de.sentry.io`). Cross-origin = EU backend + EU Sentry ONLY — never US/Google/non-EU.
- **Colours:** tokens in `globals.css` `@theme` (that file is the source of truth); never hardcode. No gradients on clinical surfaces; only auth/brand panels may use `--brand-panel-*`. Scribe QR `fgColor` stays literal `#1C2B44` synced to `--brand-panel-base` (vars break export).

# Known gotchas

- **P1-01 (web half OPEN):** `lib/egn.ts` `dobFromEgn` maps months 21–32 to the 1800s, no plausibility bound; a month typo shifts DOB a century. Backend 400s; `canSubmit` mirror TODO.
- **Never "simplify" the result-page edit flush (silent data loss):** keep (1) `flushEdit` reads `fieldsRef.current`, never a captured `fields`; (2) flush-on-unmount (guard: `pendingEditField.current`). Stale closure dropped lone/last edits while `edit_count` bumped.
- **Deploy hazard:** Vercel ships only tubermed-web, Railway only tubermed-backend — cross-repo reads ENOENT in prod. Use committed in-repo mirrors; `public/` is browser-only. Flag cross-repo runtime reads.
- **Three review systems — never conflate:** vital-range warnings (`lib/vital-rules.ts`), amber AI-uncertainty spans (`lib/uncertain-spans.ts`, advisory, no gate), source traceability. New span surfaces: match `mkbReviewCopy`.
- **Patient-summary 429s:** calm notice, never the red error; regenerate-429 preserves on-screen summary + unsaved edits; wording from server `error` only.
- **patients page ~111/120:** lint errors; hoist `applyPage` above `loadPatient`.
- **postcss CVE: DEFERRED, not reachable. NEVER `npm audit fix --force`** — installs next@9.3.3, destroys the app.
- **`med_alerts` must flow through `mergeBackendAlerts()`** — never revert to bare `checkDrugSafety()`; `/edit` posts the FULL `fields` object. `lib/types.ts` must match the backend's JSON (contract edits touch both repos).
- ЕГН checksum lives in BOTH repos: `lib/egn.ts` `isValidEgnChecksum` mirrors the backend's `validateEgnChecksum` — keep them in sync if the algorithm ever changes.
- ⚠ **CROSS-REPO MIRROR INVARIANT — investigation templates:** `lib/echo-template.ts` and `lib/pacemaker-template.ts` are the committed display mirrors of the backend's `lib/templates/echo-v1.js` / `pacemaker-v1.js` (labels/units/dot-paths/kind/refNorma). A backend template change and its mirror must land TOGETHER (same discipline as `public/ial-inns.json`/`mkb10.json`). The echo descriptor serves BOTH the standalone echo note AND embedded `izsledvania_blocks` cards via `lib/investigation-blocks.ts` — keep both containers in lockstep; pacemaker is EMBEDDED-only (no standalone pacemaker note — backend `VALID_NOTE_TYPES` gates it) and is a WORKING DRAFT pending Соколов validation. Aliases + plausibility bounds stay backend-only.
- **`izsledvania_blocks` contract (embedded investigations):** a SIBLING key on the консултация fields — ABSENT (never `[]`) when there are no blocks; `izsledvania`/`naznacheni` stay flat strings. Block-local `uncertain_spans` live inside `block.fields` with dot-path `field` keys relative to the block; block edits round-trip via those dot-paths (C6) and `/edit` still posts the FULL `fields` object. `block.source` + `field_sources` offsets index the RAW transcript — never re-derive them client-side. Don't change the shape or the 3-state source UI (намерен източник / няма ясен източник / opt-in предположение) without a cross-repo task.

# History

Dated session write-ups (2026-06 onward) live in `docs/history/<YYYY-MM>.md`; the verbatim
pre-slim versions of the sections above are in `docs/history/archive-2026-07-pre-slim.md`.
Read the relevant month when a task references past work — they are not loaded by default.
