#!/usr/bin/env bash
# Writes the report (drift per infrastructure file, then what a design change adds) to the job summary and to
# $RUNNER_TEMP/system-design-report.md for the comment step. Sets the drifted output.
set -euo pipefail
export SYSTEM_DESIGN_DIR="$RUNNER_TEMP/system-design-designs"
report="$RUNNER_TEMP/system-design-report.md"
: > "$report"
drifted=false

if [ ! -f "$DESIGN" ]; then
  echo "::error::Design file not found: $DESIGN"
  exit 1
fi

while IFS= read -r file; do
  # Trim surrounding spaces; the rest of the name is kept as written.
  file="${file#"${file%%[![:space:]]*}"}"
  file="${file%"${file##*[![:space:]]}"}"
  [ -z "$file" ] && continue
  set +e
  node "$CLI" drift "$DESIGN" "$file" --markdown >> "$report"
  code=$?
  set -e
  case $code in
    0) ;;
    1) drifted=true ;;
    *) echo "::error::Could not check $DESIGN against $file"; exit "$code" ;;
  esac
  echo >> "$report"
done <<< "$INFRA"

# On a pull request, describe what the change to the design file adds, against the base branch.
if [ -n "${BASE_SHA:-}" ]; then
  if git fetch --no-tags --depth=1 origin "$BASE_SHA" 2> /dev/null; then
    if ! git diff --quiet "$BASE_SHA" -- "$DESIGN"; then
      before="$RUNNER_TEMP/system-design-before.json"
      git show "$BASE_SHA:$DESIGN" > "$before" 2> /dev/null || : > "$before"
      node "$CLI" diff "$before" "$DESIGN" --markdown >> "$report"
    fi
  else
    echo "::warning::Could not fetch the base commit, so the design change is not described."
  fi
fi

cat "$report" >> "$GITHUB_STEP_SUMMARY"
echo "drifted=$drifted" >> "$GITHUB_OUTPUT"
