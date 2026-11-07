# Game Roles Bot

A Discord bot that lets members join and leave game roles from one panel, suggest new games, and post looking-for-group messages. Admins approve suggestions and manage games and categories.

## Built for one server

This bot is built for a single server. It does not support several servers at once, and the Discord application is meant to be private ("Public Bot" turned off). You are welcome to run your own copy: create your own Discord application, follow the dev setup below, and deploy it however you like. Nothing in this repo contains real server data; all IDs and secrets come from your own `.env` file.

Stack: Node 26 (runs the TypeScript directly), discord.js, SQLite with Kysely, Drizzle for the schema and migrations, Vitest, oxlint and oxfmt.

## Dev setup

1. In the Discord Developer Portal, create an application. Turn off "Public Bot" and turn on the "Server Members" privileged intent. Create the bot user and copy its token.
2. Invite the bot to your test server with a link that grants these permissions: Manage Roles, Manage Channels, View Channels, Send Messages, Embed Links, Attach Files, Read Message History. Never grant Administrator. Use the scopes `bot` and `applications.commands`.
3. In Server Settings, Roles, drag the bot's role high enough for the game roles to go below it.
4. Copy `.env.example` to `.env` and fill it in:

   | Variable                 | Meaning                                                  |
   | ------------------------ | -------------------------------------------------------- |
   | `DISCORD_TOKEN`          | The bot token                                            |
   | `DISCORD_APPLICATION_ID` | The application ID                                       |
   | `DISCORD_GUILD_ID`       | The server the bot serves                                |
   | `ADMIN_ROLE_ID`          | The role whose members are admins                        |
   | `HEALTHCHECK_URL`        | Optional healthchecks.io ping URL; empty skips check-ins |
   | `DATABASE_PATH`          | SQLite file, default `data/bot.sqlite`                   |
   | `BACKUP_HOUR_UTC`        | Hour of the nightly backup, default 4                    |

5. `pnpm install`, then `pnpm dev` (restarts on file changes).
6. In the server, run `/gameadmin setup` as an admin. It checks permissions, shows what it will create, asks for confirmation, then builds the template role, channels and panel, and records their IDs. Running it again repairs anything deleted.
7. Set the template role's color, and create a webhook in the bot-admin channel (channel settings, Integrations) for healthchecks.io alerts.

Other scripts: `pnpm check` (type-check, lint, format check, migration check, tests), `pnpm format`, `pnpm test`.

### Changing the database

If you know Django, the flow is the same shape:

1. Edit `src/db/schema.ts` (like editing `models.py`).
2. Run `pnpm db:generate` (like `makemigrations`). It writes SQL into `drizzle/`.
3. Review the generated SQL and commit it together with the schema change.
4. The bot applies pending migrations when it starts (like `migrate`).

`pnpm check` and CI fail if the schema changed without a migration. SQLite often has to rebuild a table to change it; the migrator turns foreign keys off while it does that, so read the generated SQL for any rebuild.

## Droplet setup

The bot runs in its own Docker Compose project, with no open ports. Replace `<droplet-host>` and the paths below with your own.

1. **Check resources.** `free -h` and `swapon --show`. Add swap if there is none, and check how much memory your other services use before keeping the 256 MB container limit in `compose.yaml`. Confirm `docker compose version` shows v2.
2. **As an admin (root or sudo), once:**
   - create the deploy user, for example `deploy`, with no sudo: `adduser --disabled-password deploy`;
   - give it Docker access with `usermod -aG docker deploy`. That is close to root access, so the key below must be able to do only one thing;
   - create the folder: `mkdir /opt/game-roles-bot && chown deploy:deploy /opt/game-roles-bot`;
   - install the deploy script (step 5) as root.
3. **As the deploy user:** `git clone https://github.com/<owner>/<repo>.git /opt/game-roles-bot`, then `mkdir -p /opt/game-roles-bot/data`.
   **As an admin:** `chown 1000:1000 /opt/game-roles-bot/data` (the container runs as uid 1000).
4. **Env file** (deploy user). Create `/opt/game-roles-bot/.env` from `.env.example` with the production values, then `chmod 600 .env`. Leave `DATABASE_PATH` out; compose sets it.
5. **Deploy script** (admin). Keep the live copy outside the repo at `/usr/local/bin/deploy-game-roles-bot`, owned by root, mode 755, so the deploy user cannot edit it. Reference copy:

   ```sh
   #!/bin/bash
   set -euo pipefail
   SHA="${SSH_ORIGINAL_COMMAND:-}"
   case "$SHA" in
     *[!0-9a-f]* | "") echo "bad commit" >&2; exit 1 ;;
   esac
   [ "${#SHA}" -eq 40 ] || { echo "bad commit" >&2; exit 1; }
   cd /opt/game-roles-bot
   git fetch --quiet origin main
   # Only commits on main, and never backwards (two pushes can finish their checks out of order).
   git merge-base --is-ancestor "$SHA" origin/main || { echo "not a main commit" >&2; exit 1; }
   git merge-base --is-ancestor HEAD "$SHA" || { echo "refusing to deploy an older commit" >&2; exit 1; }
   git checkout --quiet --detach "$SHA"
   GIT_SHA="$SHA" docker compose build --pull
   GIT_SHA="$SHA" docker compose up -d
   docker image prune -f
   ```

   The workflow sends the commit SHA as the SSH command; the script validates it (40 hex characters) before using it.

6. **Restrict the key.** Generate a key pair just for deploys. In the deploy user's `~/.ssh/authorized_keys`, one line:

   ```
   restrict,command="/usr/local/bin/deploy-game-roles-bot" ssh-ed25519 AAAA... deploy-key
   ```

   `restrict` is equivalent to `no-pty,no-port-forwarding,no-agent-forwarding,no-X11-forwarding` plus more; spelling those four out instead is also fine.

7. **SSH hardening.** Keys only: no password logins, no root login.
8. **Monitoring.** In healthchecks.io create a check with period 5 minutes and grace 10 minutes. Add a Discord integration using the webhook of the bot-admin channel, and put the check's ping URL in `HEALTHCHECK_URL`.
9. **By hand.** If Actions is unavailable, an admin can run the script as the deploy user: `sudo -u deploy env SSH_ORIGINAL_COMMAND=<40-character-commit-sha> /usr/local/bin/deploy-game-roles-bot`.
10. **Rolling back.** The script refuses to move to an older commit, on purpose: old code could meet a newer database schema. To roll back, restore a database backup from before the bad release (see below), then push a revert commit to `main` and let the pipeline deploy it.

## GitHub setup checklist

- [ ] `.gitignore` covers the env file, database and backups before the first commit. History is public too.
- [ ] Turn on secret scanning and push protection.
- [ ] Protect `main`: no force pushes, no deletion.
- [ ] Run workflows only on pushes to `main` and manual runs. Never use `pull_request_target`. Keep fork pull requests without secrets.
- [ ] Set the workflow token's default permissions to read-only.
- [ ] Pin every third-party action to an exact commit (the workflow does; Dependabot keeps them current).
- [ ] Turn on Dependabot alerts.

Repository secrets used by `.github/workflows/deploy.yml`:

| Secret               | Value                                                                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DEPLOY_HOST`        | The droplet's address                                                                                                                                   |
| `DEPLOY_USER`        | The deploy user                                                                                                                                         |
| `DEPLOY_SSH_KEY`     | The private key of the deploy-only key pair                                                                                                             |
| `DEPLOY_KNOWN_HOSTS` | Output of `ssh-keyscan <droplet-host>`, checked against the droplet's real host key (`ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` on the droplet) |

Droplet checklist: deploy user without sudo; key limited to the deploy script; script outside the repo and root-owned; keys-only SSH; `.env` readable only by its owner.

Discord checklist: "Public Bot" off on both applications (dev and prod); only the permissions listed above, never Administrator; the prod token only in the droplet's env file, the dev token only on your machine.

## Restoring a backup

The bot posts a database copy to the backups channel every night and keeps 30 days. Roles live in Discord, so losing the database loses games, categories, aliases and suggestions but nobody's roles.

1. Download the backup file from the backups channel.
2. Stop the bot: `docker compose stop` in `/opt/game-roles-bot` (as the deploy user).
3. Replace `data/bot.sqlite` with the downloaded file, and, as an admin, run `chown 1000:1000` on it. Remove any leftover `bot.sqlite-wal` and `bot.sqlite-shm` files.
4. Start the bot: `docker compose up -d`. Check for the "Bot started" notice in the admin channel.

## If something leaks

- **Bot token:** reset it in the Discord Developer Portal, update the env file, restart the bot. Reset first, clean up git history after.
- **SSH key:** remove it from the droplet's `authorized_keys`, create a new key, update the `DEPLOY_SSH_KEY` secret.
- **healthchecks.io URL:** create a new check and update the env file.

## License

MIT. See `LICENSE`.
