#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://192.168.5.190:8088}"
FIT_FOLDER="/home/pi/garminexports"
CREDS_FILE="/home/pi/git/fit-dashboard/scripts/creds.json"
FIT_FILE="${1:-}"

if [[ -z "$FIT_FILE" ]]; then
  echo "Usage: $0 /path/to/activity.fit"
  exit 1
fi

# open the session
SESSION=$(curl --silent -X POST $BASE_URL/api/unlock -H 'Content-Type: application/json' -d "$(cat $CREDS_FILE)" | jq -r '.token')

# import FIT file
STATUS=$(curl --silent "$BASE_URL/api/import-fit' -H 'Content-Type: multipart/form-data' -H "X-Session: $SESSION" -F "file=@$FIT_FOLDER/$FIT_FILE" --insecure)
echo "$FIT_FILE $(echo $STATUS | jq -r '.status')"
