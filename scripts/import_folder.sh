#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://192.168.5.190:8088}"
CREDS_FILE="/home/pi/git/fit-dashboard/scripts/creds.json"
FIT_FOLDER="${1:-}"

if [[ -z "$FIT_FOLDER" ]]; then
  echo "Usage: $0 /path/to/activities"
  exit 1
fi

# open the session
SESSION=$(curl --silent -X POST $BASE_URL/api/unlock -H 'Content-Type: application/json' -d "$(cat $CREDS_FILE)" | jq -r '.token')

# import FIT files from folder
for i in $FIT_FOLDER/*
do
  echo $i
  STATUS=$(curl --silent "$BASE_URL/api/import-fit" -H "X-Session: $SESSION" -F "file=@$i" --insecure)
  if echo "$STATUS" | jq -e 'has("error")' > /dev/null; then
    echo $i $STATUS
  else
    echo $i $(echo $STATUS | jq -r '.status')
  fi
done
