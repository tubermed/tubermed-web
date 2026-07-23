<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# What this repo is

TuberMed's frontend: Next.js 16 app on Vercel (`app.tubermed.com`) — the doctor-facing
workspace (identity-free start-visit card, notes library, scribe recording, editable
Амбулаторен лист, exports) plus the public marketing landing. The API is `tubermed-backend/` (Node/Express on Railway EU) —
its contract and gates are documented in that repo's `CLAUDE.md`. All user-facing strings
are Bulgarian; code, comments, and commit messages are English.

# Non-negotiable invariants

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

`npm run build` · `npx tsc --noEmit` clean · `npm run lint` introduces **zero new**
findings vs the pre-existing baseline (don't chase pre-existing ones). No unit-test
runner in this repo — verify interactive behavior in a live local browser (preview
tools freeze CSS transitions/rAF — don't trust them for animated state; say what you
couldn't exercise headlessly).

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
- **CSP:** `contentSecurityPolicy()` in `next.config.ts` `headers()` (prod-only; rebuild). `Permissions-Policy: microphone=(self)` MANDATORY — the scribe records; removing it breaks recording. `connect-src` DERIVED, never hardcoded — `backendConnectOrigins()` (`NEXT_PUBLIC_BACKEND_URL`); `sentryConnectOrigins()` (`lib/sentry-csp.ts`) EU-guarded (`*.ingest.de.sentry.io`). Cross-origin = EU backend + EU Sentry ONLY — never US/Google/non-EU.
- **Colours:** tokens in `globals.css` `@theme` (that file is the source of truth); never hardcode. No gradients on clinical surfaces; only auth/brand panels may use `--brand-panel-*`. Scribe QR `fgColor` stays literal `#1C2B44` synced to `--brand-panel-base` (vars break export).

# Known gotchas

- **Never "simplify" the result-page edit flush (silent data loss):** keep (1) `flushEdit` reads `fieldsRef.current`, never a captured `fields`; (2) flush-on-unmount (guard: `pendingEditField.current`). Stale closure dropped lone/last edits while `edit_count` bumped.
- **Deploy hazard:** Vercel ships only tubermed-web, Railway only tubermed-backend — cross-repo reads ENOENT in prod. Use committed in-repo mirrors; `public/` is browser-only. Flag cross-repo runtime reads.
- **Three review systems — never conflate:** vital-range warnings (`lib/vital-rules.ts`), amber AI-uncertainty spans (`lib/uncertain-spans.ts`, advisory, no gate), source traceability. New span surfaces: match `mkbReviewCopy`.
- **Patient-summary 429s:** calm notice, never the red error; regenerate-429 preserves on-screen summary + unsaved edits; wording from server `error` only.
- **postcss CVE: DEFERRED, not reachable. NEVER `npm audit fix --force`** — installs next@9.3.3, destroys the app.
- **`med_alerts` must flow through `mergeBackendAlerts()`** — never revert to bare `checkDrugSafety()`; `/edit` posts the FULL `fields` object. `lib/types.ts` must match the backend's JSON (contract edits touch both repos).
- ⚠ **CROSS-REPO MIRROR INVARIANT — investigation templates:** `lib/echo-template.ts`, `lib/pacemaker-template.ts` and `lib/ekg-template.ts` are the committed display mirrors of the backend's `lib/templates/echo-v1.js` / `pacemaker-v1.js` / `ekg-v1.js` (labels/units/dot-paths/kind/refNorma, plus ЕКГ's `EKG_RENDER_STYLE`). A backend template change and its mirror must land TOGETHER (same discipline as `public/ial-inns.json`/`mkb10.json`). The echo descriptor serves BOTH the standalone echo note AND embedded `izsledvania_blocks` cards via `lib/investigation-blocks.ts` — keep both containers in lockstep; pacemaker and ekg are EMBEDDED-only (no standalone notes — backend `VALID_NOTE_TYPES` gates them) and are WORKING DRAFTS pending Соколов validation. ekg is the LIGHT block: `renderStyle:'paragraph'` makes BOTH the on-screen card and the exporters render its values as ONE prose paragraph (one source of truth, `f6a36c3`) — don't regress it to label rows. Aliases + plausibility bounds stay backend-only.
- **`izsledvania_blocks` contract (embedded investigations):** a SIBLING key on the консултация fields — ABSENT (never `[]`) when there are no blocks; `izsledvania`/`naznacheni` stay flat strings. Block-local `uncertain_spans` live inside `block.fields` with dot-path `field` keys relative to the block; block edits round-trip via those dot-paths (C6) and `/edit` still posts the FULL `fields` object. `block.source` + `field_sources` offsets index the RAW transcript — never re-derive them client-side. Don't change the shape or the 3-state source UI (намерен източник / няма ясен източник / opt-in предположение) without a cross-repo task.

# History

Dated session write-ups (2026-06 onward) live in `docs/history/<YYYY-MM>.md`; the verbatim
pre-slim versions of the sections above are in `docs/history/archive-2026-07-pre-slim.md`.
Read the relevant month when a task references past work — they are not loaded by default.
