# VPS auto-deploy

The hosted app (https://narratea.oreki.dev) runs on the Oracle instance from
`/mnt/book_data/narratea` as the `narratea.service` systemd unit, with the
Cloudflare tunnel in front of it. This directory is the deployment pipeline.

## Flow

1. Push to `main`.
2. GitHub Actions runs `.github/workflows/ci.yml` (format, typecheck, tests,
   client build) on that commit.
3. On the VPS, `narratea-deploy.timer` fires every two minutes. It fetches
   `origin/main`; if the checkout is behind, it reads that commit's check runs
   from the public GitHub API and only continues once they are all green. A red
   or still-running commit leaves the app untouched and is retried later.
4. On a green, newer commit: `git reset --hard origin/main`, `bun install
   --frozen-lockfile`, `bun run build:client`, `bun run db:migrate`, then
   `systemctl restart narratea`.

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
sudo systemctl stop narratea-deploy.timer   # pause auto-deploy
sudo systemctl disable narratea-deploy.timer # stop for good
```

## Rollback

```bash
cd /mnt/book_data/narratea
git reset --hard <previous-sha>
/home/ubuntu/.bun/bin/bun run build:client && sudo systemctl restart narratea
```

Reverting the commit on `main` also works and is what the timer will pick up on
its next tick.

## Notes

- `.env` is git-ignored, so `git reset --hard` never touches it.
- The timer reads check runs unauthenticated from the public repo, so it is
  rate-limited to 60 requests an hour; it only calls the API when the checkout
  is behind, which keeps it far below that.
- A commit with no check runs (for example one pushed before CI existed) is
  deployed as-is.
