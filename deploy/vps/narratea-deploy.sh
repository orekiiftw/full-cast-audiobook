#!/usr/bin/env bash
# Pull-based deploy for the Narratea app on the VPS. Installed as
# narratea-deploy.service, fired every two minutes by narratea-deploy.timer.
#
# Deploys origin/main only when its GitHub check runs are green (or when the
# commit has none, e.g. the very first deploy before CI existed). Exits quietly
# when there is nothing to do, so the timer's journal stays readable.
#
# A revision counts as deployed only after the restarted service passes its
# health check; only then is it written to .git/narratea-deployed-rev. The
# timer compares origin/main against that record, not against HEAD (which
# moves at the start of a deploy), so a deploy that fails at any step is
# retried on the next tick.
set -euo pipefail

APP=/mnt/book_data/narratea
BUN=/home/ubuntu/.bun/bin/bun
BRANCH=main
REPO=orekiiftw/full-cast-audiobook
API="https://api.github.com/repos/${REPO}/commits"
HEALTH_URL=http://127.0.0.1:3000/healthz

cd "$APP"

deployed_file=$(git rev-parse --git-path narratea-deployed-rev)

git fetch --quiet --prune origin "$BRANCH"
remote_rev=$(git rev-parse "origin/${BRANCH}")
deployed_rev=$(cat "$deployed_file" 2>/dev/null || true)

if [ "$deployed_rev" = "$remote_rev" ]; then
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
    echo "[deploy] ${remote_rev} has failing check runs; leaving the app on ${deployed_rev:-the current checkout}"
    exit 0
    ;;
esac

trap 'echo "[deploy] ${remote_rev} failed (line ${LINENO}); retrying next tick" >&2' ERR

echo "[deploy] ${deployed_rev:-unrecorded} -> ${remote_rev}"
git reset --hard --quiet "origin/${BRANCH}"

echo "[deploy] dependencies"
"$BUN" install --frozen-lockfile

echo "[deploy] client build"
"$BUN" run build:client

echo "[deploy] migrations"
"$BUN" run db:migrate

echo "[deploy] restarting service"
sudo -n systemctl restart narratea

echo "[deploy] health check"
if ! curl -fs -o /dev/null --max-time 5 --retry 30 --retry-delay 4 --retry-max-time 120 --retry-connrefused "$HEALTH_URL"; then
  echo "[deploy] ${remote_rev} never passed ${HEALTH_URL}; retrying next tick" >&2
  exit 1
fi
systemctl is-active --quiet narratea

printf '%s\n' "$remote_rev" >"${deployed_file}.tmp"
mv -f "${deployed_file}.tmp" "$deployed_file"
echo "[deploy] done ${remote_rev}"
