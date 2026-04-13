#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8080}"
FIT_FILE="${1:-}"

if [[ -z "$FIT_FILE" ]]; then
  echo "Usage: $0 /path/to/activity.fit"
  exit 1
fi

echo "Checking status..."
curl -s "$BASE_URL/api/status" | jq .

echo "If onboarding is needed, create account manually first:"
echo "curl -X POST $BASE_URL/api/onboard -H 'Content-Type: application/json' -d '{\"username\":\"user\",\"password\":\"pass12345\"}'"

echo "Done."
