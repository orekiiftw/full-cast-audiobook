#!/usr/bin/env bash
# Pull-based deploy for the Narratea app on the VPS. Installed as
# narratea-deploy.service, fired every two minutes by narratea-deploy.timer.
#
# Deploys origin/main only when its GitHub check runs are green (or when the
# commit has none, e.g. the very first deploy before CI existed). Exits quietly
# when there is nothing to do, so the timer's journal stays readable.
set -euo pipefail

APP=/mnt/book_data/narratea
BUN=/home/ubuntu/.bun/bin/bun
BRANCH=main
REPO=orekiiftw/full-cast-audiobook
API="https://api.github.com/repos/${REPO}/commits"

cd "$APP"

git fetch --quiet --prune origin "$BRANCH"
local_rev=$(git rev-parse HEAD)
remote_rev=$(git rev-parse "origin/${BRANCH}")

if [ "$local_rev" = "$remote_rev" ]; then
  exit 0
fi

if ! checks_json=$(curl -fsS --max-time 20 "${API}/${remote_rev}/check-runs?per_page=100"); then
  echo "[deploy] cannot read check runs for ${remote_rev}; retrying next tick"
  exit 0
fi

verdict=$(printf '%s' "$checks_json" | python3 -c '
import json, sys

runs = json.load(sys.stdin).get("check_runs", [])
if not runs:
    print("deploy")
elif any(run.get("status") != "completed" for run in runs):
    print("pending")
elif all(run.get("conclusion") in ("success", "neutral", "skipped") for run in runs):
    print("deploy")
else:
    print("red")
')

case "$verdict" in
  deploy) ;;
  pending)
    echo "[deploy] ${remote_rev} still running CI; retrying next tick"
    exit 0
    ;;
  *)
    echo "[deploy] ${remote_rev} has failing check runs; leaving the app on ${local_rev}"
    exit 0
    ;;
esac

echo "[deploy] ${local_rev} -> ${remote_rev}"
git reset --hard --quiet "origin/${BRANCH}"

echo "[deploy] dependencies"
"$BUN" install --frozen-lockfile

echo "[deploy] client build"
"$BUN" run build:client

echo "[deploy] migrations"
"$BUN" run db:migrate

echo "[deploy] restarting service"
sudo -n systemctl restart narratea
sleep 4
systemctl is-active narratea
echo "[deploy] http $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/healthz)"
echo "[deploy] done ${remote_rev}"
