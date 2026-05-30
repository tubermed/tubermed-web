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
   `[Отказ]` reverts the ЕГН and keeps the edits. **DECISION:** on `[Запази]`,
   `chief_complaint` and `visit_type` are **preserved** across the swap — only the patient
   identity changes; the visit context is the doctor's typed work too. Do **not** turn this
   into a silent reset of the visit fields — silent loss of typed context is the exact bug
   this feature exists to prevent. (Scope: scenario 1 only — an already-loaded patient. The
   new-patient-draft case is intentionally not guarded.)
   **Fires on the FIRST ЕГН divergence** (first delete/add/change), not the second.
   `changedEditableLabels` deliberately **EXCLUDES `birth_date` / `gender`** — they're DERIVED
   from the ЕГН (never user edits) and are not dirty-tracked. Including them caused an
   off-by-one: dropping a digit clears birth_date+gender, which then read as a "change" vs the
   loaded patient on the NEXT keystroke and fired a spurious guard. With them excluded, a
   loaded patient with **unsaved edits** fires the guard the instant the ЕГН first diverges;
   a loaded patient with **no unsaved edits** never fires — the derived DOB/gender/age simply
   unpopulate as the ЕГН stops being a valid 10 digits, and the doctor retypes freely. (The
   derived fields are still PATCHed by `persistPatient`; exclusion only affects edit-tracking.)

5. **DEFERRED — not built:** visit/edit *migration* on patient switch ("move edits between
   patients" / "revert wrong-patient edits"). Considered and deliberately not built — it's a
   speculative data-migration UI for a case no doctor has reported. Revisit only if pilot
   doctors ask for it.

# Known issues / gotchas

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
