#!/usr/bin/env bash
# One-time install of the pull-based auto-deploy on the VPS. Run from the
# deployed checkout as the ubuntu user, which has passwordless sudo.
set -euo pipefail

APP=/mnt/book_data/narratea
cd "$APP"

chmod +x deploy/vps/narratea-deploy.sh

sudo -n cp deploy/vps/narratea-deploy.service /etc/systemd/system/narratea-deploy.service
sudo -n cp deploy/vps/narratea-deploy.timer /etc/systemd/system/narratea-deploy.timer
sudo -n systemctl daemon-reload
sudo -n systemctl enable --now narratea-deploy.timer

systemctl list-timers narratea-deploy.timer --no-pager
echo "Installed. First run: sudo systemctl start narratea-deploy"
