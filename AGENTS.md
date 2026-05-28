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

2. **ЕГН-match dropdown.** Typing a full valid ЕГН in the form field shows a match
   dropdown rendered with the shared `PatientResultRow` component — the *same* row as the
   top search box (one source of truth). Clicking it loads the patient.

3. **Doctor-typed ЕГН persists after load — and why.** `fromPatient()` blanks
   `national_id` for **all** callers (GDPR: never re-display DB-fetched plaintext ЕГН).
   Only `handleEgnMatchLoad` re-applies the ЕГН the **doctor typed this session**. The
   rule is: *doctor-entered ЕГН may stay on screen; DB-fetched ЕГН never shows.* Do **not**
   move the ЕГН-persist into `fromPatient` or the shared `loadExistingPatient` helper — that
   would leak DB plaintext to the top-search load path.

4. **ЕГН-switch guard (`components/EgnSwitchGuardModal.tsx`).** Scenario: an existing
   loaded patient (`selected != null`) has unsaved **patient-record** edits
   (allergies/chronic/name/etc., per `changedEditableLabels`) and the doctor changes the
   ЕГН to switch patients. The change is **held** and a save-or-cancel modal lists the
   changed fields. `[Запази]` PATCHes the current patient then proceeds with the swap;
   `[Отказ]` reverts the ЕГН and keeps the edits. **DECISION:** on `[Запази]`,
   `chief_complaint` and `visit_type` are **preserved** across the swap — only the patient
   identity changes; the visit context is the doctor's typed work too. Do **not** turn this
   into a silent reset of the visit fields — silent loss of typed context is the exact bug
   this feature exists to prevent. (Scope: scenario 1 only — an already-loaded patient. The
   new-patient-draft case is intentionally not guarded.)

5. **DEFERRED — not built:** visit/edit *migration* on patient switch ("move edits between
   patients" / "revert wrong-patient edits"). Considered and deliberately not built — it's a
   speculative data-migration UI for a case no doctor has reported. Revisit only if pilot
   doctors ask for it.
