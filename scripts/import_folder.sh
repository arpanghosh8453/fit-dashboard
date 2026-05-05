#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8088}"
FIT_FOLDER="${1:-}"

if [[ -z "$FIT_FOLDER" ]]; then
  echo "Usage: $0 /path/to/activities"
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

# import FIT files from folder
for i in $FIT_FOLDER/*
do
  STATUS=$(curl --silent "$BASE_URL/api/import-fit" -H "X-Session: $SESSION" -F "file=@$i" --insecure)
  if echo "$STATUS" | jq -e 'has("error")' > /dev/null; then
    echo $i $STATUS
  else
    echo $i $(echo $STATUS | jq -r '.status')
  fi
done
