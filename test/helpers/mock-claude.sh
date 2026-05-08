#!/bin/bash
# Mock `claude` binary for tests.
# Emits canned stream-json events on stdout and (optionally) makes real
# git commits inside cwd so commit enumeration can be tested.
#
# Controlled by env:
#   MOCK_CLAUDE_SCENARIO   one of: success | incomplete | rate-limit | error
#   MOCK_CLAUDE_COMMITS    integer (default 1) — how many commits to make in success path
#   MOCK_CLAUDE_RESET      ISO timestamp to embed in rate-limit error message
#
# All other args are accepted and ignored.

set -e

SCENARIO="${MOCK_CLAUDE_SCENARIO:-success}"
COMMITS="${MOCK_CLAUDE_COMMITS:-1}"
RESET="${MOCK_CLAUDE_RESET:-}"

emit() {
  echo "$1"
}

case "$SCENARIO" in
  success)
    emit '{"type":"system","subtype":"init","session_id":"mock"}'
    for i in $(seq 1 "$COMMITS"); do
      f="mock-file-${i}-$(date +%s%N).txt"
      echo "mock content $i" > "$f"
      git add "$f" >/dev/null 2>&1 || true
      git -c user.email=mock@example.com -c user.name=Mock commit -q -m "AFK: mock commit $i (#mock)" >/dev/null 2>&1 || true
      emit "{\"role\":\"assistant\",\"message\":{\"content\":[{\"type\":\"tool_use\",\"name\":\"Bash\",\"input\":{\"command\":\"git commit -m '...$i'\"}}]}}"
    done
    emit '{"role":"assistant","message":{"content":[{"type":"text","text":"All acceptance criteria met. <promise>COMPLETE</promise>"}]}}'
    exit 0
    ;;
  incomplete)
    emit '{"type":"system","subtype":"init","session_id":"mock"}'
    f="mock-incomplete-$(date +%s%N).txt"
    echo "wip" > "$f"
    git add "$f" >/dev/null 2>&1 || true
    git -c user.email=mock@example.com -c user.name=Mock commit -q -m "AFK: wip (#mock)" >/dev/null 2>&1 || true
    emit '{"role":"assistant","message":{"content":[{"type":"text","text":"Got stuck. Leaving comment on issue."}]}}'
    exit 0
    ;;
  rate-limit)
    emit '{"type":"system","subtype":"init","session_id":"mock"}'
    if [ -n "$RESET" ]; then
      echo "Error: rate limit exceeded. Resets at ${RESET}." >&2
    else
      echo "Error: usage limit reached." >&2
    fi
    exit 130
    ;;
  error)
    echo "Error: something broke." >&2
    exit 1
    ;;
  *)
    echo "unknown MOCK_CLAUDE_SCENARIO: $SCENARIO" >&2
    exit 99
    ;;
esac
