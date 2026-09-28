#!/usr/bin/env bash
# Assemble the Campus Guide backend into a Hugging Face Gradio Space and push it.
#
#   ./hf-space/deploy-space.sh <owner>/<space-name>          # e.g. israel-durotoye/campus-guide-api
#   ./hf-space/deploy-space.sh <owner>/<space-name> --dry-run # assemble only, print the folder
#
# Needs the current standalone `hf` CLI, logged in (`hf auth login`) with an
# account that can create Spaces. The Space is created on first run (private by
# default; pass --public to change that).
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

cleanup() { rm -rf "$STAGE"; }
trap cleanup EXIT

# Only what the Space runtime needs: shared core, backend and packaging.
rsync -a --exclude '__pycache__' --exclude '*.pyc' "$ROOT/rag_core" "$STAGE/"
rsync -a --exclude '__pycache__' --exclude '*.pyc' --exclude 'tests' "$DEMO/backend" "$STAGE/"
cp "$ROOT/pyproject.toml" "$HERE/app.py" "$HERE/README.md" "$HERE/packages.txt" "$HERE/.dockerignore" "$STAGE/"
cp "$DEMO/backend/requirements.txt" "$STAGE/requirements.txt"
GIT_SHA="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)"
printf 'source: https://github.com/Israel-Durotoye/rag-build-lab @ %s\n' "$GIT_SHA" > "$STAGE/SOURCE.txt"

if [ -f "$STAGE/backend/.env.local" ] || grep -rq "sk-[A-Za-z0-9]\{20,\}" "$STAGE" 2>/dev/null; then
  echo "refusing to deploy: a secret-looking value is in the staged files" >&2; exit 1
fi

echo "assembled $(find "$STAGE" -type f | wc -l | tr -d ' ') files in $STAGE"
if $DRY_RUN; then
  # Keep the assembled folder so the caller can inspect it.
  trap - EXIT
  exit 0
fi

# The standalone installer places the current CLI here. Fall back to PATH for
# package-manager installs, and allow CI to provide a specific binary.
HF_BIN="${HF_CLI_BIN:-${HOME}/.local/bin/hf}"
if [ ! -x "$HF_BIN" ]; then HF_BIN="$(command -v hf || true)"; fi
[ -n "$HF_BIN" ] || { echo "install the Hugging Face CLI: curl -LsSf https://hf.co/cli/install.sh | bash" >&2; exit 1; }
"$HF_BIN" auth whoami >/dev/null 2>&1 || { echo "log in first: $HF_BIN auth login" >&2; exit 1; }

VISIBILITY="--private"; $PUBLIC && VISIBILITY="--public"
"$HF_BIN" repos create "$SPACE" --type space --sdk gradio --flavor zero-a10g $VISIBILITY --exist-ok >/dev/null
"$HF_BIN" upload "$SPACE" "$STAGE" . --repo-type space --commit-message "Deploy backend @ $GIT_SHA" --delete '*'
echo "pushed. Build logs: https://huggingface.co/spaces/$SPACE?logs=build"
echo "then set AGENTROUTER_API_KEY under the Space's settings, and point the frontend's CAMPUS_API_URL at https://${SPACE%%/*}-${SPACE##*/}.hf.space"
if ! $PUBLIC; then
  echo "note: the Space is private. Its hf.space URL then needs a Hugging Face login, which the Vercel" >&2
  echo "      frontend's proxy cannot supply. Make it public (--public, or the Space's settings) before" >&2
  echo "      pointing CAMPUS_API_URL at it; check with ./check-deploy.sh <space-url>." >&2
fi
