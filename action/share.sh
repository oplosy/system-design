#!/usr/bin/env bash
# Builds a read-only HTML copy of the design for reviewers, who open it from the job's artifacts with no app installed.
set -euo pipefail
npm --prefix "$GITHUB_ACTION_PATH" run build --silent > /dev/null
export SYSTEM_DESIGN_DIR="$RUNNER_TEMP/system-design-share"
mkdir -p "$SYSTEM_DESIGN_DIR"
id="$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')).id)" "$DESIGN")"
cp "$DESIGN" "$SYSTEM_DESIGN_DIR/$id.json"
node "$CLI" share "$id" "$RUNNER_TEMP/system-design-review.html"
line="Review copy: download \`design-review\` from [this run]($GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID) and open the HTML file."
echo "$line" >> "$RUNNER_TEMP/system-design-report.md"
echo "$line" >> "$GITHUB_STEP_SUMMARY"
