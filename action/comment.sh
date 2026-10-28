#!/usr/bin/env bash
# Keeps one comment on the pull request up to date with the report. A clean report only updates a comment that is
# already there, so pull requests with nothing to say stay quiet.
set -uo pipefail
report="$RUNNER_TEMP/system-design-report.md"
marker='<!-- system-design-check -->'
[ -s "$report" ] || exit 0

if ! ids="$(gh api "repos/$REPO/issues/$PR/comments" --paginate --jq ".[] | select(.body | startswith(\"$marker\")) | .id")"; then
  echo "::warning::Could not read the pull request's comments; give the job pull-requests: write (a fork's token is read-only)."
  exit 0
fi
id="$(echo "$ids" | tail -n 1)"
if [ -z "$id" ] && [ "$DRIFTED" != true ] && ! grep -q '📐' "$report"; then
  exit 0
fi

body="$(printf '%s\n%s\n' "$marker" "$(cat "$report")")"
if [ -n "$id" ]; then
  gh api -X PATCH "repos/$REPO/issues/comments/$id" -f body="$body" > /dev/null
else
  gh api "repos/$REPO/issues/$PR/comments" -f body="$body" > /dev/null
fi || echo "::warning::Could not comment on the pull request; give the job pull-requests: write (a fork's token is read-only)."
