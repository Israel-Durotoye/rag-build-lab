#!/usr/bin/env bash
# Check that a deployed Finder speaks this frontend's API contract.
#
#   ./check-deploy.sh https://your-app.vercel.app          # through the Next.js proxy: what the browser uses
#   ./check-deploy.sh https://owner-space.hf.space         # the Space directly
#   ./check-deploy.sh http://127.0.0.1:3002 --full         # also load the sample library, ask, compare modes
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
TMP="$(mktemp -d "${TMPDIR:-/tmp}/finder-check.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

# Hugging Face's edge now and then answers 502 before a request reaches the
# Space; curl retries those (and connection failures) like the browser client does.
RETRY="--retry 3 --retry-delay 1"
HEADER="X-Manual-API-Version"

fail() { echo "FAIL: $*" >&2; exit 1; }
json() { python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(eval(sys.argv[2], {}, {"d": d}))' "$@"; }
header() { tr -d '\r' < "$1" | awk -v k="$(echo "$2" | tr 'A-Z' 'a-z')" -F': ' 'tolower($1)==k {print $2}' | tail -1; }
contract() { [ "$(header "$1" "$HEADER")" = "$EXPECTED" ] || fail "$2 reply lacks the contract header (a proxy answered instead of the backend?)"; }

echo "checking $BASE against frontend contract v$EXPECTED (workspace $WORKSPACE)"

# 1. Status: the header is what lib/api.ts checks on every reply.
code="$(curl -sS $RETRY --max-time 60 -o "$TMP/status.json" -D "$TMP/status.h" -w '%{http_code}' "$BASE/api/status")" \
  || fail "GET /api/status did not answer (is the backend awake and public? does MANUAL_API_URL point at it?)"
[ "$code" = "200" ] || fail "GET /api/status returned HTTP $code: $(head -c 300 "$TMP/status.json")"
got="$(header "$TMP/status.h" "$HEADER")"
[ "$got" = "$EXPECTED" ] || fail "$HEADER is '${got:-missing}', frontend expects $EXPECTED (deploy the matching backend)"
body_version="$(json "$TMP/status.json" 'd.get("apiVersion")')"
[ "$body_version" = "$EXPECTED" ] || fail "status body apiVersion is $body_version, expected $EXPECTED"
GENERATION="$(json "$TMP/status.json" 'd["generation"]')"
echo "ok   /api/status: contract v$got, generation=$GENERATION, model=$(json "$TMP/status.json" 'd["model"]') via $(json "$TMP/status.json" 'd["provider"]'), embeddings=$(json "$TMP/status.json" 'd["embeddings"]["status"]')"

# 2. Workspace-scoped routes, the way the browser calls them.
code="$(curl -sS $RETRY --max-time 60 -H "X-Workspace-Id: $WORKSPACE" -o "$TMP/library.json" -D "$TMP/library.h" -w '%{http_code}' "$BASE/api/library")"
[ "$code" = "200" ] || fail "GET /api/library returned HTTP $code: $(head -c 300 "$TMP/library.json")"
contract "$TMP/library.h" "/api/library"
[ "$(json "$TMP/library.json" 'd["sample"]["available"]')" = "True" ] || fail "the sample library is missing (were corpus.json and library/models.json deployed?)"
echo "ok   /api/library: $(json "$TMP/library.json" 'len(d["documents"])') manuals in a fresh workspace; sample library of $(json "$TMP/library.json" 'len(d["sample"]["documents"])') manuals available ($(json "$TMP/library.json" 'd["sample"]["licence"]'))"

# 3. The API docs are reachable through the same path.
code="$(curl -sS $RETRY --max-time 60 -o /dev/null -w '%{http_code}' "$BASE/api/docs")"
[ "$code" = "200" ] && echo "ok   /api/docs" || echo "warn /api/docs returned HTTP $code"

$FULL || { echo "done. Add --full to load the sample library, ask on two look-alike boards and compare search modes."; exit 0; }

# 4. Load the sample library (embeds it once per server; the first call can take a minute).
code="$(curl -sS $RETRY --max-time 600 -X POST -H "X-Workspace-Id: $WORKSPACE" -o "$TMP/sample.json" -D "$TMP/sample.h" -w '%{http_code}' "$BASE/api/sample")"
[ "$code" = "200" ] || fail "POST /api/sample returned HTTP $code: $(head -c 300 "$TMP/sample.json")"
contract "$TMP/sample.h" "sample"
echo "ok   sample library loaded: $(json "$TMP/sample.json" 'len(d["documents"])') manuals"

# 5. The same port on two look-alike boards: each answer must stay on its own board.
for board in uno-r4-minima:D5 uno-r4-wifi:D13; do
  model="${board%%:*}"; pin="${board##*:}"
  curl -sS $RETRY -N --max-time 300 -H "X-Workspace-Id: $WORKSPACE" -H 'Content-Type: application/json' \
    -d "{\"message\":\"Which header pin is RA4M1 port P102?\",\"model\":\"$model\",\"mode\":\"keyword\"}" \
    -o "$TMP/ask.ndjson" -D "$TMP/ask.h" "$BASE/api/ask" || fail "POST /api/ask failed"
  contract "$TMP/ask.h" "ask"
  python3 - "$TMP/ask.ndjson" "$model" "$pin" <<'PY'
import json, sys
events = [json.loads(l) for l in open(sys.argv[1]) if l.strip()]
model, pin = sys.argv[2], sys.argv[3]
for e in events:
    if e.get("type") == "error":
        sys.exit("ask error: " + e["error"])
done = [e for e in events if e.get("type") == "done"]
if not done:
    sys.exit("ask stream ended without a 'done' event; events: " + ", ".join(e.get("type", "?") for e in events))
d = done[0]
card = d.get("card") or {}
if card.get("kind") != "found" or f"{pin} | P102" not in card.get("meaning", ""):
    sys.exit(f"the P102 card for {model} should read {pin}; got {card.get('meaning')!r}")
for item in d["sources"]:
    for unit in item["units"]:
        if not unit["masked"] and unit["models"] is not None and model not in unit["models"]:
            sys.exit(f"a passage for {unit['models']} reached the {model} answer")
answer = (d.get("answer") or "").strip().replace("\n", " ")
print(f"ok   {model}: P102 is {pin}; status={d['status']}; {len(d['sources'])} passages, none from another board")
if answer:
    print("     answer: " + answer[:160] + ("…" if len(answer) > 160 else ""))
PY
done

# 6. Ask without a model: Finder must ask which one, not guess.
curl -sS $RETRY -N --max-time 120 -H "X-Workspace-Id: $WORKSPACE" -H 'Content-Type: application/json' \
  -d '{"message":"Which header pin is port P102?","mode":"keyword"}' -o "$TMP/clarify.ndjson" "$BASE/api/ask" || fail "POST /api/ask failed"
python3 - "$TMP/clarify.ndjson" <<'PY'
import json, sys
done = [json.loads(l) for l in open(sys.argv[1]) if l.strip()][-1]
if done.get("status") != "clarification":
    sys.exit("without a model Finder should ask which one; status was " + str(done.get("status")))
print("ok   no model chosen: Finder asked (%s) with %d choices" % (done["clarification"]["reason"], len(done["clarification"]["candidates"])))
PY

# 7. The search-mode lab: three rankings for one query, no model involved.
code="$(curl -sS $RETRY --max-time 120 -H "X-Workspace-Id: $WORKSPACE" -H 'Content-Type: application/json' \
  -d '{"query":"board not detected after uploading","model":"uno-r4-wifi"}' -o "$TMP/lab.json" -D "$TMP/lab.h" -w '%{http_code}' "$BASE/api/lab")"
[ "$code" = "200" ] || fail "POST /api/lab returned HTTP $code: $(head -c 300 "$TMP/lab.json")"
contract "$TMP/lab.h" "lab"
echo "ok   lab: keyword $(json "$TMP/lab.json" 'len(d["keyword"]["results"])'), semantic $(json "$TMP/lab.json" 'len(d["semantic"]["results"])') (available=$(json "$TMP/lab.json" 'd["semantic"]["available"]')), fused $(json "$TMP/lab.json" 'len(d["fused"])') candidates; constant $(json "$TMP/lab.json" 'd["constant"]')"
[ "$GENERATION" = "True" ] || echo "note no model key is configured on this backend: answers were the manuals' own sentences"
echo "done: frontend and backend agree on contract v$EXPECTED at $BASE"
