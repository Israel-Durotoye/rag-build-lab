#!/usr/bin/env bash
# Check that a deployed Study Companion speaks this frontend's API contract.
#
#   ./check-deploy.sh https://your-app.vercel.app          # through the Next.js proxy: what the browser uses
#   ./check-deploy.sh https://owner-space.hf.space         # the Space directly
#   ./check-deploy.sh http://127.0.0.1:3001 --full         # also upload notes, ask, compare, practise and delete
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
TMP="$(mktemp -d "${TMPDIR:-/tmp}/study-companion-check.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

# Hugging Face's edge now and then answers 502 before a request reaches the
# Space; curl retries those (and connection failures) like the browser client does.
RETRY="--retry 3 --retry-delay 1"
HEADER="X-Study-API-Version"

fail() { echo "FAIL: $*" >&2; exit 1; }
json() { python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(eval(sys.argv[2], {}, {"d": d}))' "$@"; }
header() { tr -d '\r' < "$1" | awk -v k="$(echo "$2" | tr 'A-Z' 'a-z')" -F': ' 'tolower($1)==k {print $2}' | tail -1; }
contract() { [ "$(header "$1" "$HEADER")" = "$EXPECTED" ] || fail "$2 reply lacks the contract header (a proxy answered instead of the backend?)"; }

echo "checking $BASE against frontend contract v$EXPECTED (workspace $WORKSPACE)"

# 1. Status: the header is what lib/api.ts checks on every reply.
code="$(curl -sS $RETRY --max-time 60 -o "$TMP/status.json" -D "$TMP/status.h" -w '%{http_code}' "$BASE/api/status")" \
  || fail "GET /api/status did not answer (is the backend awake and public? does STUDY_API_URL point at it?)"
[ "$code" = "200" ] || fail "GET /api/status returned HTTP $code: $(head -c 300 "$TMP/status.json")"
got="$(header "$TMP/status.h" "$HEADER")"
[ "$got" = "$EXPECTED" ] || fail "$HEADER is '${got:-missing}', frontend expects $EXPECTED (deploy the matching backend)"
body_version="$(json "$TMP/status.json" 'd.get("apiVersion")')"
[ "$body_version" = "$EXPECTED" ] || fail "status body apiVersion is $body_version, expected $EXPECTED"
GENERATION="$(json "$TMP/status.json" 'd["generation"]')"
echo "ok   /api/status: contract v$got, generation=$GENERATION, model=$(json "$TMP/status.json" 'd["model"]') via $(json "$TMP/status.json" 'd["provider"]'), embeddings=$(json "$TMP/status.json" 'd["embeddings"]["status"]'), ocr=$(json "$TMP/status.json" 'd["ocr"]["enabled"]')"

# 2. Workspace-scoped routes, the way the browser calls them.
code="$(curl -sS $RETRY --max-time 60 -H "X-Workspace-Id: $WORKSPACE" -o "$TMP/docs.json" -D "$TMP/docs.h" -w '%{http_code}' "$BASE/api/documents")"
[ "$code" = "200" ] || fail "GET /api/documents returned HTTP $code: $(head -c 300 "$TMP/docs.json")"
contract "$TMP/docs.h" "/api/documents"
echo "ok   /api/documents: $(json "$TMP/docs.json" 'len(d["documents"])') sets of notes in a fresh workspace"
code="$(curl -sS $RETRY --max-time 60 -H "X-Workspace-Id: $WORKSPACE" -o "$TMP/sample.json" -w '%{http_code}' "$BASE/api/sample")"
[ "$code" = "200" ] || fail "GET /api/sample returned HTTP $code (were corpus.json and questions.json deployed with the backend?)"
echo "ok   /api/sample: $(json "$TMP/sample.json" 'len(d["questions"])') questions for $(json "$TMP/sample.json" 'd["documents"][0]["title"]')"

# 3. The API docs are reachable through the same path.
code="$(curl -sS $RETRY --max-time 60 -o /dev/null -w '%{http_code}' "$BASE/api/docs")"
[ "$code" = "200" ] && echo "ok   /api/docs" || echo "warn /api/docs returned HTTP $code"

$FULL || { echo "done. Add --full to upload notes, stream an answer, compare chunkings, make recall cards and delete them."; exit 0; }

# 4. Upload (NDJSON stream).
cat > "$TMP/check.md" <<'NOTES'
# Deployment check notes

## Negative feedback

Negative feedback subtracts the measured output from the reference to form an error signal. Important exception: negative feedback does not guarantee stability. If the loop gain is too high the loop can oscillate.

## Open-loop control

An open-loop controller sends a command without measuring the result, so it cannot correct for disturbances.
NOTES
curl -sS $RETRY -N --max-time 300 -H "X-Workspace-Id: $WORKSPACE" -F "file=@$TMP/check.md;type=text/markdown" \
  -o "$TMP/upload.ndjson" -D "$TMP/upload.h" "$BASE/api/documents" || fail "POST /api/documents failed"
contract "$TMP/upload.h" "upload"
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
d = done[0]["document"]
sys.stderr.write("ok   upload streamed %d events (stages: %s), %d sections, %d words\n" % (len(events), " > ".join(dict.fromkeys(stages)), d["sections"], d["words"]))
print(d["id"])
PY
)" || fail "upload did not produce a document"

# 5. Ask (NDJSON stream): retrieval, context, then an explanation or the notes' own sentences.
curl -sS $RETRY -N --max-time 300 -H "X-Workspace-Id: $WORKSPACE" -H 'Content-Type: application/json' \
  -d '{"message":"Does negative feedback guarantee stability?","mode":"keyword","chunking":"section"}' \
  -o "$TMP/ask.ndjson" -D "$TMP/ask.h" "$BASE/api/ask" || fail "POST /api/ask failed"
contract "$TMP/ask.h" "ask"
python3 - "$TMP/ask.ndjson" <<'PY'
import json, sys
events = [json.loads(l) for l in open(sys.argv[1]) if l.strip()]
kinds = list(dict.fromkeys(e.get("type", "?") for e in events))
for e in events:
    if e.get("type") == "error":
        sys.exit("ask error: " + e["error"])
done = [e for e in events if e.get("type") == "done"]
if not done:
    sys.exit("ask stream ended without a 'done' event; events: " + ", ".join(kinds))
d = done[0]
print("ok   ask streamed %d events (%s); status=%s; sections=%d; caveats=%d" % (len(events), ", ".join(kinds), d["status"], len(d["sources"]), len(d["caveats"])))
answer = (d.get("answer") or "").strip().replace("\n", " ")
shown = answer or " ".join(s["text"] for s in (d.get("explanation") or {}).get("sentences", []))
if answer:
    print("     explanation: " + answer[:200] + ("…" if len(answer) > 200 else ""))
else:
    print("     no generated explanation (%s); the notes' own sentences were returned" % (d["generation"]["error"] or "no model"))
if "does not guarantee" not in shown and "not guarantee" not in shown:
    print("warn the exception ('does not guarantee stability') is not in what was shown; read the answer yourself")
if not any("does not guarantee stability" in c["text"] for c in d["caveats"]):
    sys.exit("the notes' exception was not listed among the caveats")
PY

# 6. Compare: both chunkings for one question, no model involved.
code="$(curl -sS $RETRY --max-time 120 -H "X-Workspace-Id: $WORKSPACE" -H 'Content-Type: application/json' \
  -d '{"query":"open-loop controller","mode":"keyword","expand":true}' -o "$TMP/compare.json" -D "$TMP/compare.h" -w '%{http_code}' "$BASE/api/compare")"
[ "$code" = "200" ] || fail "POST /api/compare returned HTTP $code: $(head -c 300 "$TMP/compare.json")"
contract "$TMP/compare.h" "compare"
echo "ok   compare: section-aware reached $(json "$TMP/compare.json" 'len(d["runs"]["section"]["sections"])') sections in $(json "$TMP/compare.json" 'd["runs"]["section"]["budget"]["usedWords"]') words, fixed-length $(json "$TMP/compare.json" 'len(d["runs"]["fixed"]["sections"])') in $(json "$TMP/compare.json" 'd["runs"]["fixed"]["budget"]["usedWords"]')"

# 7. Practice without a model: recall cards (NDJSON stream), then remove them.
curl -sS $RETRY -N --max-time 120 -H "X-Workspace-Id: $WORKSPACE" -H 'Content-Type: application/json' \
  -d '{"kind":"recall","count":3}' -o "$TMP/practice.ndjson" -D "$TMP/practice.h" "$BASE/api/practice" || fail "POST /api/practice failed"
contract "$TMP/practice.h" "practice"
SET_ID="$(python3 - "$TMP/practice.ndjson" <<'PY'
import json, sys
events = [json.loads(l) for l in open(sys.argv[1]) if l.strip()]
for e in events:
    if e.get("type") == "error":
        sys.exit("practice error: " + e["error"])
done = [e for e in events if e.get("type") == "done"]
if not done:
    sys.exit("practice stream ended without a 'done' event")
s = done[0]["set"]
sys.stderr.write("ok   practice made %d recall cards from %d sections\n" % (len(s["items"]), len(s["sources"])))
print(s["id"])
PY
)" || fail "practice did not produce a set"
code="$(curl -sS $RETRY --max-time 60 -X DELETE -H "X-Workspace-Id: $WORKSPACE" -o /dev/null -w '%{http_code}' "$BASE/api/practice/$SET_ID")"
[ "$code" = "200" ] || echo "warn DELETE /api/practice returned HTTP $code"

code="$(curl -sS $RETRY --max-time 60 -X DELETE -H "X-Workspace-Id: $WORKSPACE" -o /dev/null -w '%{http_code}' "$BASE/api/documents/$DOC_ID")"
[ "$code" = "200" ] && echo "ok   deleted the check notes" || echo "warn DELETE returned HTTP $code; remove document $DOC_ID by hand"
[ "$GENERATION" = "True" ] || echo "note no model key is configured on this backend: quizzes, flashcards and generated explanations were not exercised"
echo "done: frontend and backend agree on contract v$EXPECTED at $BASE"
