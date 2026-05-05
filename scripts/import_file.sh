#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8088}"
FIT_FILE="${1:-}"

if [[ -z "$FIT_FILE" ]]; then
  echo "Usage: $0 /path/to/activity.fit"
  exit 1
fi

# Check USERNAME
if [ -z "${USERNAME:-}" ]; then
  read -rp "Enter USERNAME: " USERNAME
fi

# Check PASSWORD
if [ -z "${PASSWORD:-}" ]; then
  read -rsp "Enter PASSWORD: " PASSWORD
  echo
fi

# Final validation
if [ -z "${USERNAME:-}" ] || [ -z "${PASSWORD:-}" ]; then
  echo "Error: Both USERNAME and PASSWORD must be provided."
  exit 1
fi

# open the session
SESSION=$(curl --silent -X POST $BASE_URL/api/unlock -H 'Content-Type: application/json' -d "{\"username\":\"$USERNAME\",\"password\":\"$PASSWORD\"}" | jq -r '.token')

# import FIT file
STATUS=$(curl --silent "$BASE_URL/api/import-fit" -H "X-Session: $SESSION" -F "file=@$FIT_FILE" --insecure)
if echo "$STATUS" | jq -e 'has("error")' > /dev/null; then
  echo $STATUS
else
  echo $FIT_FILE $(echo $STATUS | jq -r '.status')
fi
