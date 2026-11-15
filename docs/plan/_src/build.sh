#!/usr/bin/env bash
# Rebuilds MASTER_PLAN.md and the three developer prompts from the fragments in this folder.
# Usage: bash docs/plan/_src/build.sh
set -euo pipefail
src="$(cd "$(dirname "$0")" && pwd)"
out="$(dirname "$src")"

# section N of overview.md = from "## N." up to the next "## <digit>." heading
section() { awk -v n="$1" '/^## [0-9]+\./{f=($2==n".")} f' "$src/overview.md"; }
nl() { printf '\n'; }

prompt() { # $1 = role file prefix, $2 = output file
  {
    cat "$src/$1.head.md"; nl
    printf -- '---\n\n# SHARED PROJECT CONTEXT (identical in all three developer briefs)\n\n'
    cat "$src/overview.md"; nl
    cat "$src/contracts.md"; nl
    printf -- '---\n\n# YOUR WORK\n\n'
    cat "$src/$1.tasks.md"; nl
    printf -- '---\n\n'
    cat "$src/git.md"; nl
    printf -- '---\n\n'
    cat "$src/$1.tail.md"
  } > "$out/$2"
}

prompt dominic PROMPT_A_DOMINIC.md
prompt thant   PROMPT_B_THANT.md
prompt muste   PROMPT_C_MUSTE.md

{
  printf '# BASTION — MASTER DEVELOPMENT PLAN\n\n'
  printf 'Regional Disaster Operations Platform · three developers: Dominic (architecture and backend), Thant (UI/UX and frontend), Muste (features and integrations).\n\n'
  printf 'Planning document only. No application code exists yet. Developer prompts: `PROMPT_A_DOMINIC.md`, `PROMPT_B_THANT.md`, `PROMPT_C_MUSTE.md` in this folder.\n\n'
  printf '# PART 1 · APPLICATION UNDERSTANDING\n\n'
  section 1; nl
  cat "$src/mA.md"; nl
  printf '# PART 2 · TECHNICAL ARCHITECTURE\n\n'
  section 2; nl
  section 4; nl
  cat "$src/contracts.md"; nl
  cat "$src/mB.md"; nl
  printf '# PART 5 · COMPLETE DEVELOPMENT TASK BACKLOG\n\n'
  printf 'Every task lists owner, priority, complexity, branch, dependencies, objective, implementation, files, acceptance criteria, tests and commit milestones. 55 tasks: 35 P0, 14 P1, 6 P2.\n\n'
  cat "$src/dominic.tasks.md"; nl
  cat "$src/thant.tasks.md"; nl
  cat "$src/muste.tasks.md"; nl
  printf '# PART 6 · FILE OWNERSHIP MATRIX\n\n'
  section 3; nl
  cat "$src/mC.md"; nl
  printf '# PART 8 · GITHUB COLLABORATION PROTOCOL\n\n'
  cat "$src/git.md"; nl
  cat "$src/mD.md"
} > "$out/MASTER_PLAN.md"

wc -w "$out"/MASTER_PLAN.md "$out"/PROMPT_*.md
