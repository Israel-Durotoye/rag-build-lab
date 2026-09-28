#!/usr/bin/env bash
# Assemble the Campus Guide backend into a Hugging Face Docker Space and push it.
#
#   ./hf-space/deploy-space.sh <owner>/<space-name>          # e.g. israel-durotoye/campus-guide-api
#   ./hf-space/deploy-space.sh <owner>/<space-name> --dry-run # assemble only, print the folder
#
# Needs the `hf` CLI, logged in (`hf auth login`) with a write token. The Space
# is created on first run (private by default; pass --public to change that).
set -euo pipefail

SPACE="${1:?usage: deploy-space.sh <owner>/<space-name> [--dry-run] [--public]}"
shift
DRY_RUN=false; PUBLIC=false
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --public) PUBLIC=true ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

HERE="$(cd "$(dirname "$0")" && pwd)"            # demos/01-campus-desk/hf-space
DEMO="$(cd "$HERE/.." && pwd)"                    # demos/01-campus-desk
ROOT="$(cd "$DEMO/../.." && pwd)"                 # repository root
STAGE="$(mktemp -d "${TMPDIR:-/tmp}/campus-guide-space.XXXXXX")"

# Only what the image needs: the shared core, the backend and the packaging.
rsync -a --exclude '__pycache__' --exclude '*.pyc' "$ROOT/rag_core" "$STAGE/"
rsync -a --exclude '__pycache__' --exclude '*.pyc' --exclude 'tests' "$DEMO/backend" "$STAGE/"
cp "$ROOT/pyproject.toml" "$HERE/Dockerfile" "$HERE/README.md" "$HERE/.dockerignore" "$STAGE/"
GIT_SHA="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)"
printf 'source: https://github.com/Israel-Durotoye/rag-build-lab @ %s\n' "$GIT_SHA" > "$STAGE/SOURCE.txt"

if [ -f "$STAGE/backend/.env.local" ] || grep -rq "sk-[A-Za-z0-9]\{20,\}" "$STAGE" 2>/dev/null; then
  echo "refusing to deploy: a secret-looking value is in the staged files" >&2; exit 1
fi

echo "assembled $(find "$STAGE" -type f | wc -l | tr -d ' ') files in $STAGE"
if $DRY_RUN; then exit 0; fi

command -v hf >/dev/null || { echo "install the Hugging Face CLI: pip install -U huggingface_hub" >&2; exit 1; }
hf auth whoami >/dev/null 2>&1 || { echo "log in first: hf auth login" >&2; exit 1; }

VISIBILITY="--private"; $PUBLIC && VISIBILITY=""
hf repo create "$SPACE" --repo-type space --space_sdk docker $VISIBILITY --exist-ok >/dev/null
hf upload "$SPACE" "$STAGE" . --repo-type space --commit-message "Deploy backend @ $GIT_SHA" --delete '*'
echo "pushed. Build logs: https://huggingface.co/spaces/$SPACE?logs=build"
echo "then set AGENTROUTER_API_KEY under the Space's settings, and point the frontend's CAMPUS_API_URL at https://${SPACE%%/*}-${SPACE##*/}.hf.space"
rm -rf "$STAGE"
