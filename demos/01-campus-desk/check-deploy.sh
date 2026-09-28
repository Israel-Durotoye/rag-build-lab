#!/usr/bin/env bash
# Check that a deployed Campus Guide speaks this frontend's API contract.
#
#   ./check-deploy.sh https://your-app.vercel.app          # through the Next.js proxy: what the browser uses
#   ./check-deploy.sh https://owner-space.hf.space         # the Space directly
#   ./check-deploy.sh https://your-app.vercel.app --full   # also upload a small text file, ask, and delete it
#
# Needs curl and python3. A sleeping Space can take a few minutes to wake;
# if the first check times out, run it again.
set -euo pipefail

BASE="${1:?usage: check-deploy.sh <https://frontend-or-backend> [--full]}"
shift
FULL=false
for arg in "$@"; do
  case "$arg" in
    --full) FULL=true ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done
BASE="${BASE%/}"
HERE="$(cd "$(dirname "$0")" && pwd)"
EXPECTED="$(sed -n 's/^export const API_VERSION = \([0-9][0-9]*\);.*/\1/p' "$HERE/lib/contract.ts")"
[ -n "$EXPECTED" ] || { echo "could not read API_VERSION from lib/contract.ts" >&2; exit 1; }
WORKSPACE="$(python3 -c 'import secrets; print(secrets.token_hex(16))')"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/campus-guide-check.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }
json() { python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(eval(sys.argv[2], {}, {"d": d}))' "$@"; }
header() { tr -d '\r' < "$1" | awk -v k="$(echo "$2" | tr 'A-Z' 'a-z')" -F': ' 'tolower($1)==k {print $2}' | tail -1; }

echo "checking $BASE against frontend contract v$EXPECTED (workspace $WORKSPACE)"

# 1. Status: the header is what lib/api.ts checks on every reply.
code="$(curl -sS --max-time 60 -o "$TMP/status.json" -D "$TMP/status.h" -w '%{http_code}' "$BASE/api/status")" \
  || fail "GET /api/status did not answer (is the Space awake and public? does CAMPUS_API_URL point at it?)"
[ "$code" = "200" ] || fail "GET /api/status returned HTTP $code: $(head -c 300 "$TMP/status.json")"
got="$(header "$TMP/status.h" X-Campus-API-Version)"
[ "$got" = "$EXPECTED" ] || fail "X-Campus-API-Version is '${got:-missing}', frontend expects $EXPECTED (deploy the matching backend)"
body_version="$(json "$TMP/status.json" 'd.get("apiVersion")')"
[ "$body_version" = "$EXPECTED" ] || fail "status body apiVersion is $body_version, expected $EXPECTED"
echo "ok   /api/status: contract v$got, generation=$(json "$TMP/status.json" 'd["generation"]'), model=$(json "$TMP/status.json" 'd["model"]'), embeddings=$(json "$TMP/status.json" 'd["embeddings"]["status"]'), ocr=$(json "$TMP/status.json" 'd["ocr"]["enabled"]')"

# 2. A workspace-scoped route, the way the browser calls it.
code="$(curl -sS --max-time 60 -H "X-Workspace-Id: $WORKSPACE" -o "$TMP/docs.json" -D "$TMP/docs.h" -w '%{http_code}' "$BASE/api/documents")"
[ "$code" = "200" ] || fail "GET /api/documents returned HTTP $code: $(head -c 300 "$TMP/docs.json")"
[ "$(header "$TMP/docs.h" X-Campus-API-Version)" = "$EXPECTED" ] || fail "/api/documents reply lacks the contract header (a proxy answered instead of the backend?)"
echo "ok   /api/documents: $(json "$TMP/docs.json" 'len(d["documents"])') documents in a fresh workspace"

# 3. The API docs are reachable through the same path.
code="$(curl -sS --max-time 60 -o /dev/null -w '%{http_code}' "$BASE/api/docs")"
[ "$code" = "200" ] && echo "ok   /api/docs" || echo "warn /api/docs returned HTTP $code"

$FULL || { echo "done. Add --full to upload a text file, stream an answer and delete it."; exit 0; }

# 4. Upload (NDJSON stream) -> chat (NDJSON stream) -> delete.
printf 'Campus Guide deployment check.\n\nLibrary hours\nThe library closes at 9 pm on weekdays and at 5 pm on Saturdays.\n' > "$TMP/check.txt"
curl -sS -N --max-time 300 -H "X-Workspace-Id: $WORKSPACE" -F "file=@$TMP/check.txt;type=text/plain" \
  -o "$TMP/upload.ndjson" -D "$TMP/upload.h" "$BASE/api/documents" || fail "POST /api/documents failed"
[ "$(header "$TMP/upload.h" X-Campus-API-Version)" = "$EXPECTED" ] || fail "upload reply lacks the contract header"
DOC_ID="$(python3 - "$TMP/upload.ndjson" <<'PY'
import json, sys
events = [json.loads(l) for l in open(sys.argv[1]) if l.strip()]
stages = [e.get("stage") for e in events if e.get("type") == "progress"]
for e in events:
    if e.get("type") == "error":
        sys.exit("upload error: " + e["error"])
done = [e for e in events if e.get("type") == "done"]
if not done:
    sys.exit("upload stream ended without a 'done' event; events: " + ", ".join(e.get("type", "?") for e in events))
sys.stderr.write("ok   upload streamed %d events (stages: %s), %d chunks\n" % (len(events), " > ".join(dict.fromkeys(stages)), done[0]["document"]["chunks"]))
print(done[0]["document"]["id"])
PY
)" || fail "upload did not produce a document"

curl -sS -N --max-time 300 -H "X-Workspace-Id: $WORKSPACE" -H 'Content-Type: application/json' \
  -d '{"message":"When does the library close on weekdays?","history":[],"mode":"keyword"}' \
  -o "$TMP/chat.ndjson" -D "$TMP/chat.h" "$BASE/api/chat" || fail "POST /api/chat failed"
[ "$(header "$TMP/chat.h" X-Campus-API-Version)" = "$EXPECTED" ] || fail "chat reply lacks the contract header"
python3 - "$TMP/chat.ndjson" <<'PY'
import json, sys
events = [json.loads(l) for l in open(sys.argv[1]) if l.strip()]
kinds = list(dict.fromkeys(e.get("type", "?") for e in events))
for e in events:
    if e.get("type") == "error":
        sys.exit("chat error: " + e["error"])
done = [e for e in events if e.get("type") == "done"]
if not done:
    sys.exit("chat stream ended without a 'done' event; events: " + ", ".join(kinds))
d = done[0]
answer = (d.get("answer") or "").strip().replace("\n", " ")
print("ok   chat streamed %d events (%s); status=%s; sources=%d" % (len(events), ", ".join(kinds), d["status"], len(d["sources"])))
if answer:
    print("     answer: " + (answer[:160] + ("…" if len(answer) > 160 else "")))
else:
    print("     no generated answer (no model key on the backend?); the passages were returned instead")
PY

code="$(curl -sS --max-time 60 -X DELETE -H "X-Workspace-Id: $WORKSPACE" -o /dev/null -w '%{http_code}' "$BASE/api/documents/$DOC_ID")"
[ "$code" = "200" ] && echo "ok   deleted the check document" || echo "warn DELETE returned HTTP $code; remove document $DOC_ID by hand"
echo "done: frontend and backend agree on contract v$EXPECTED at $BASE"
