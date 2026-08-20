#!/usr/bin/env bash
# verify-clean-clone — run this repo's CI job against a CLEAN CLONE (2026-08-19)
#
# ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
# On 2026-08-19 BOTH repos' CI jobs turned out to be red on their default
# branch, each for its own reason, and neither had ever shown it locally.
#
# Here it was the lint step: the workflow ran bare `npm run lint`, which exits 1
# on any error, while this repo carries 21 accepted pre-existing react-hooks
# findings — so the job was red from the day it was added. That one was at least
# visible to anyone who looked.
#
# The backend's was not. Its replay harness loaded the IAL gazetteer from
# `../tubermed-web/public/ial-inns.json` — THIS repo, through the parent
# directory — so it resolved on a laptop with both repos checked out side by
# side and nowhere else. Two suites failed on any clean checkout, silently,
# since CI existed. Every local run was green because every local run happened
# next to a sibling.
#
# That is the sixth instance of one class, and the class now has a name in
# CLAUDE.md: **verification infrastructure is production.** A working tree is
# not what CI checks out. It carries untracked files, a sibling repo, a .env, a
# populated node_modules and whatever else the last six months left lying
# around — and any one of them can make a gate pass for a reason that does not
# exist on the machine that matters.
#
# So this stops being something someone thinks of and becomes something that
# runs. **Before every push order.** Not when it seems relevant.
#
# ── WHAT IT DOES ───────────────────────────────────────────────────────────
#   1. `git clone` the repo's COMMITTED state into a scratch dir — no working
#      tree, no untracked files, no .env.
#   2. Clone it OUTSIDE the monorepo parent, so the sibling repo is genuinely
#      absent. This is the check that found the bug; without it the clone still
#      sees ../tubermed-web and proves nothing.
#   3. `npm ci` from the lockfile.
#   4. Run the exact steps of .github/workflows/ci.yml.
#
# ── ⚠ WHAT IT DOES NOT COVER — read this before calling a green a green ────
# This is a REPRODUCTION, not a CI run. It cannot see:
#   • the RUNNER — CI is ubuntu-latest; this is your Windows box. Path
#     separators, case-sensitivity and line endings all differ, and a
#     case-only filename collision is invisible here.
#   • the NODE VERSION — web CI pins node 24 (needed for native type-stripping
#     in `node --test scripts/*.test.ts`) and backend CI pins 22. This runs
#     whatever `node -v` says locally. A difference between them will not show.
#   • the MIRROR JOB — `mirror-gate` needs SIBLING_REPO_TOKEN and a checkout of
#     tubermed-backend from GitHub. Not reproducible offline, and deliberately
#     so: this script's whole point is the sibling's ABSENCE.
#   • `npm run build` — NOT a CI step (Vercel builds on deploy), so it is not
#     run here either. Run it yourself before a push; AGENTS.md still requires
#     it, and the ○→ƒ shell check only exists in its output.
#   • anything about the actual push — branch protection, required checks, the
#     event payload the workflow's diff-range logic reads.
# **Those need a real push.** This script exists to make sure the push is not
# the first time anyone finds out.
#
# Usage:  npm run verify:clean-clone
#         scripts/verify-clean-clone.sh [--keep]     # --keep leaves the clone
#
# Exit 0 = the job would pass on a clean checkout. Non-zero = it would not.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_NAME="$(basename "$REPO_ROOT")"
KEEP=0
[ "${1:-}" = "--keep" ] && KEEP=1

# Deliberately OUTSIDE the monorepo parent: a clone next to tubermed-web would
# still find the sibling and would have passed on 2026-08-19.
WORK="$(mktemp -d 2>/dev/null || echo "${TMPDIR:-/tmp}/tubermed-clean-clone-$$")"
mkdir -p "$WORK"
CLONE="$WORK/$REPO_NAME"

cleanup() {
  if [ "$KEEP" -eq 1 ]; then
    echo ""
    echo "clone kept at: $CLONE"
  else
    rm -rf "$WORK" 2>/dev/null || true
  fi
}
trap cleanup EXIT

echo "═══════════════════════════════════════════════════════════════════"
echo " verify-clean-clone — $REPO_NAME"
echo "═══════════════════════════════════════════════════════════════════"
echo "source : $REPO_ROOT"
echo "clone  : $CLONE"
echo "node   : $(node -v)   ⚠ CI pins a specific major — see the header"
echo ""

# ── Refuse to certify a dirty tree ─────────────────────────────────────────
# A clone carries COMMITTED state only, so uncommitted work is silently absent
# from everything below. Reporting green while the thing you are about to push
# is unstaged is precisely the failure this script exists to stop.
DIRTY="$(git -C "$REPO_ROOT" status --porcelain | grep -v '^??' || true)"
if [ -n "$DIRTY" ]; then
  echo "⚠  UNCOMMITTED TRACKED CHANGES — the clone will NOT contain them:"
  echo "$DIRTY" | sed 's/^/     /'
  echo ""
  echo "   This run verifies the COMMITTED state only. Commit first, or read"
  echo "   the result as 'the last commit is clean', never as 'my work is clean'."
  echo ""
fi

echo "── 1. clone committed state (sibling repo deliberately absent) ──"
git clone -q --local --no-hardlinks "$REPO_ROOT" "$CLONE" || { echo "✗ clone failed"; exit 1; }
echo "   HEAD: $(git -C "$CLONE" log --oneline -1)"
echo "   untracked in clone: $(git -C "$CLONE" status --porcelain | wc -l | tr -d ' ') (expect 0)"
SIBLINGS="$(ls "$WORK" | grep -c 'tubermed' || true)"
echo "   tubermed-* dirs beside the clone: $SIBLINGS (expect 1 — itself)"
if [ "$SIBLINGS" -ne 1 ]; then
  echo "✗ the clone is not isolated — a sibling repo is reachable, so this run proves nothing"
  exit 1
fi
echo ""

echo "── 2. npm ci (lockfile only) ──"
( cd "$CLONE" && npm ci ) >"$WORK/npmci.log" 2>&1
if [ $? -ne 0 ]; then
  echo "✗ npm ci failed"; tail -20 "$WORK/npmci.log"; exit 1
fi
echo "   ok"
echo ""

echo "── 3. the CI job's own steps ──"
FAILED=0
failed_list=""
cd "$CLONE" || exit 1

# Exactly the `checks` job from .github/workflows/ci.yml, in order.
run_step() {
  local name="$1"; shift
  local out
  if out="$("$@" 2>&1)"; then
    echo "   ✓ $name"
  else
    FAILED=1; failed_list="$failed_list $name"
    echo "   ✗ $name"
    echo "$out" | tail -14 | sed 's/^/       /'
  fi
}

run_step "npm run lint:ratchet" npm run lint:ratchet
run_step "npx tsc --noEmit"     npx tsc --noEmit
run_step "npm test"             npm test

echo ""
echo "═══════════════════════════════════════════════════════════════════"
if [ "$FAILED" -eq 0 ]; then
  echo " ✓ CLEAN-CLONE GREEN — the checks job would pass"
  echo ""
  echo " ⚠ NOT verified here: ubuntu-latest, the pinned node major, the"
  echo "   mirror gate (needs SIBLING_REPO_TOKEN), \`npm run build\` (not a CI"
  echo "   step — run it yourself), and anything about the push event itself."
  echo "   Those need a real run."
  exit 0
fi
echo " ✗ CLEAN-CLONE RED — CI would fail on:$failed_list"
echo ""
echo "   These pass in the working tree and fail here, which means they depend"
echo "   on something the working tree has and a checkout does not: an"
echo "   untracked file, a sibling repo, a .env, or a stale node_modules."
exit 1
