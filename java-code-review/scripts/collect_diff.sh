#!/usr/bin/env bash
# Collects the diff for review and prints: the base, the file list, the stats and the diff itself.
# Usage:
#   collect_diff.sh                 # branch vs upstream/main + uncommitted
#   collect_diff.sh --staged        # staged only (pre-commit)
#   collect_diff.sh A...B           # an arbitrary range
#   collect_diff.sh path/File.java  # one file (vs the base)
set -euo pipefail

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "ERROR: not a git repository" >&2; exit 1; }

# Generated files and noise we do not review
EXCLUDES=(
  ':(exclude)**/target/**' ':(exclude)**/build/**' ':(exclude)**/generated/**'
  ':(exclude)**/*.lock' ':(exclude)**/package-lock.json'
  ':(exclude)**/*.min.js' ':(exclude)**/*.svg' ':(exclude)**/*.png' ':(exclude)**/*.jar'
)

find_base() {
  local upstream
  # a repository without commits: the base is the empty tree, everything in the index counts as new
  if ! git rev-parse --verify -q HEAD >/dev/null; then
    git hash-object -t tree /dev/null; return
  fi
  if upstream=$(git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null); then
    # if the branch is already pushed and its upstream is itself, compare with main
    if [[ "$upstream" != *"/$(git branch --show-current)" ]]; then
      git merge-base HEAD "$upstream"; return
    fi
  fi
  for cand in origin/main origin/master main master; do
    if git rev-parse --verify -q "$cand" >/dev/null; then
      git merge-base HEAD "$cand"; return
    fi
  done
  git rev-list --max-parents=0 HEAD | tail -1
}

MODE="default"; ARG="${1:-}"
if [[ "$ARG" == "--staged" ]]; then MODE="staged"
elif [[ "$ARG" == *..* ]]; then MODE="range"
elif [[ -n "$ARG" ]]; then MODE="file"
fi

case "$MODE" in
  staged)
    echo "== SCOPE: staged changes"
    DIFF_ARGS=(--cached) ;;
  range)
    echo "== SCOPE: $ARG"
    DIFF_ARGS=("$ARG") ;;
  file)
    BASE=$(find_base)
    echo "== SCOPE: file $ARG vs $(git rev-parse --short "$BASE")"
    if git diff --quiet "$BASE" -- "$ARG"; then
      echo "== NOTE: no changes in this file; review the whole file"
      echo "== FILES"; echo "$ARG"; exit 0
    fi
    DIFF_ARGS=("$BASE" -- "$ARG") ;;
  default)
    BASE=$(find_base)
    echo "== SCOPE: $(git branch --show-current) vs $(git rev-parse --short "$BASE") (incl. uncommitted)"
    DIFF_ARGS=("$BASE") ;;
esac

if [[ "$MODE" == "file" ]]; then
  echo "== FILES"; git diff --name-status "${DIFF_ARGS[@]}"
  echo "== STAT";  git diff --stat "${DIFF_ARGS[@]}"
  echo "== DIFF";  git diff -U10 "${DIFF_ARGS[@]}"
else
  echo "== FILES"; git diff --name-status "${DIFF_ARGS[@]}" -- . "${EXCLUDES[@]}"
  echo "== STAT";  git diff --stat "${DIFF_ARGS[@]}" -- . "${EXCLUDES[@]}" | tail -1
  if [[ "$MODE" == "default" ]]; then
    UNTRACKED=$(git ls-files --others --exclude-standard -- '*.java' '*.kt' '*.xml' '*.yml' '*.yaml' '*.properties' '*.sql' || true)
    if [[ -n "$UNTRACKED" ]]; then echo "== UNTRACKED (read these files in full)"; echo "$UNTRACKED"; fi
  fi
  echo "== DIFF"; git diff -U10 "${DIFF_ARGS[@]}" -- . "${EXCLUDES[@]}"
fi
