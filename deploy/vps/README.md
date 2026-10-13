# VPS auto-deploy

The hosted app (https://narratea.oreki.dev) runs on the Oracle instance from
`/mnt/book_data/narratea` as the `narratea.service` systemd unit, with the
Cloudflare tunnel in front of it. This directory is the deployment pipeline.

## Flow

1. Push to `main`.
2. GitHub Actions runs `.github/workflows/ci.yml` (format, typecheck, tests,
   client build) on that commit.
3. On the VPS, `narratea-deploy.timer` fires every two minutes. It fetches
   `origin/main`; if that commit is not the last one deployed successfully, it
   reads the commit's check runs from the public GitHub API and only continues
   once they are all green. A red or still-running commit leaves the app
   untouched and is retried later.
4. On a green, newer commit: `git reset --hard origin/main`, `bun install
   --frozen-lockfile`, `bun run build:client`, `bun run db:migrate`,
   `systemctl restart narratea`, then `GET /healthz` until it answers 2xx
   (about two minutes at most).
5. Only after the health check passes is the commit written to
   `.git/narratea-deployed-rev`. If any step fails, the unit exits non-zero
   (visible in `systemctl status narratea-deploy`) and the next tick runs the
   whole deploy again, because `origin/main` still differs from that record.
   A commit that fails every time is retried every tick until `main` moves;
   stop the timer to pause it.

Nothing is deployed from a laptop, so the pipeline does not depend on the
instance's public IP and needs no SSH key or secret in GitHub.

## One-time install (already done on the box)

```bash
cd /mnt/book_data/narratea
deploy/vps/install.sh
```

## Day to day

```bash
sudo systemctl start narratea-deploy        # deploy now instead of waiting
journalctl -u narratea-deploy -f            # watch a deploy
systemctl list-timers narratea-deploy.timer # next run
cat .git/narratea-deployed-rev              # last commit that deployed and passed /healthz
sudo systemctl stop narratea-deploy.timer   # pause auto-deploy
sudo systemctl disable narratea-deploy.timer # stop for good
```

To force a redeploy of the current `origin/main`, delete
`.git/narratea-deployed-rev` and start the unit.

## Rollback

```bash
cd /mnt/book_data/narratea
sudo systemctl stop narratea-deploy.timer
git reset --hard <previous-sha>
/home/ubuntu/.bun/bin/bun run build:client && sudo systemctl restart narratea
```

Stop the timer first: while `origin/main` differs from
`.git/narratea-deployed-rev` (for example because its deploy just failed), the
next tick would redeploy it over the rollback. Start the timer again once
`main` carries a fix or a revert. Reverting the commit on `main` is also a
rollback on its own, and is what the timer will pick up on its next tick.

## Notes

- `.env` is git-ignored, so `git reset --hard` never touches it.
- The Cloudflare tunnel terminates TLS and reaches the app over plain HTTP, so
  `.env` needs `TRUST_PROXY=true`: the CSRF origin check then reads the
  original `https` scheme from `X-Forwarded-Proto` instead of rejecting
  same-origin POSTs. Keep `HOST` on loopback so only the tunnel can set those
  headers.
- The timer reads check runs unauthenticated from the public repo, so it is
  rate-limited to 60 requests an hour; it only calls the API when `origin/main`
  differs from the last successful deploy, which is at most 30 calls an hour
  even while a failing deploy is being retried.
- `.git/narratea-deployed-rev` lives inside `.git`, so `git reset --hard` and
  `git clean` never touch it. When the record is missing (for example on the
  first run of a script version that writes it), the timer redeploys the
  current `origin/main` once.
- A commit with no check runs (for example one pushed before CI existed) is
  deployed as-is.
