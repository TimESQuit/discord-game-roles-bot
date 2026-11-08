# Game Roles Bot — Design

> Exported from the Claude Docs design doc on 2026-11-07. The live doc is the source of truth.

## Overview

A private Discord bot that lets members of one server opt in and out of game and activity roles, suggest new games, and find players, all without DMs. It replaces the Reaction Roles setup on the production server.

**Goals**

- Self-service game roles from one panel button, with slash commands as shortcuts.
- Dozens of games grouped into categories, easy to browse and search.
- Members suggest games; admins approve them.
- Structured "looking for group" posts with a headcount.
- Safe role management: the bot only touches roles it owns, and every action is logged.

**Not in scope for v1**

- Game roles that unlock channels.
- Discord Community or Onboarding.
- Direct messages of any kind.

Direct `@game` mentions keep working exactly as they do today.

## Decisions at a glance

Everything below has been agreed; open questions are collected in the last section.

| Area | Decision |
| --- | --- |
| Language and library | TypeScript on discord.js v14 |
| Runtime | Node.js 26 LTS, running `.ts` files directly (no build step) |
| TypeScript | 7.0 for type-checking |
| Lint and format | oxlint (type-aware) and oxfmt, exact versions pinned |
| Package manager | pnpm |
| Tests | Vitest |
| Database | SQLite file, fully separate from the Django app |
| Hosting | Docker Compose on the existing droplet, in its own compose project |
| Deployment | GitHub Actions on push to main: checks run, then a restricted SSH key runs the deploy script. Secrets stay on the droplet. |
| Bots | Two applications: a dev bot for the test server (run only on your computer), a prod bot for production |
| Entry point | One read-only channel holding one panel message with one button |
| Private replies | Ephemeral replies only; no DMs |
| Roles | Created by the bot from one template role; one color; mentionable |
| Role order | Directly below the template role, alphabetical |
| Categories | Competitive, Chill, IRL activities; one category per game |
| Removing a game | The bot deletes the role, and only roles in its own table |
| Suggestions | Members suggest; admins approve or reject in #bot-admin |
| Admins | Members with a specific admin role (set in config) |
| Admin tools | Extra buttons in the same menu, plus `/gameadmin` commands |
| Slash commands | Every member and admin action also exists as a command |
| Right-click options | "See their games" and "Games in common" |
| LFG | Included in v1, with no cooldowns; channel limits decided later |
| Public posts | New-game announcements and panel LFG posts go to #game-news |
| Admin channels | #bot-admin, #bot-log and #bot-backups in an admin-only category |
| Member log | One line per action, so admins can help members who get stuck |
| Backups | Nightly database copy to #bot-backups, last 30 days kept |
| Monitoring | No external uptime service; Docker restarts the bot and a "bot started" notice shows each restart |
| Migration | One-off script kept out of the repo; new roles replace the old ones; Reaction Roles removed |
| Repository | Public on GitHub, with secret scanning and push protection on |
| Setup | /gameadmin setup creates the template role, channels and panel, and records their IDs in the database |

## Servers, environments and channels

The same code runs as two separate bot applications: a dev bot in the test server and a prod bot in the production server. Each has its own config, so testing can never touch production.

**Per-environment config** (stored in that environment's secrets file, never in git):

- Bot token and application ID
- Server ID
- Admin role ID

Everything else (the template role, the channels, the panel message) is created by setup and recorded in the database.

Slash commands are registered to each server directly, not globally, so command changes show up immediately.

**Channel layout** (the test server mirrors it):

| Channel | Who can see it | Who posts | What it holds |
| --- | --- | --- | --- |
| Panel channel (name to be decided) | Everyone | Bot only | The single panel message with its button |
| #game-news | Everyone | Bot | New-game announcements and LFG posts started from the panel. Members can't post here. |
| #bot-admin | Admins | Bot | Suggestions to review and error notices. Notifications on. |
| #bot-log | Admins | Bot | One line per member or admin action, and a line on every start. Muted. |
| #bot-backups | Admins | Bot | Nightly database copies, last 30 days. Muted. |

The three admin channels sit in one admin-only "Bot admin" category, so their permissions are set once on the category.

## Bot setup

Each bot needs three steps by hand; after that, `/gameadmin setup` builds the rest and records what it made.

**By hand, once per bot (dev and prod)**

1. In the Discord Developer Portal, create the application. Turn off "Public Bot" and turn on "Server Members". Put the token, application ID, server ID and admin role ID in that environment's env file.
2. Invite the bot with a link that grants: Manage Roles, Manage Channels, View Channels, Send Messages, Embed Links, Attach Files, Read Message History, Create Public Threads, Add Reactions.
3. In Server Settings → Roles, drag the bot's role high enough for the game roles to go below it. On production it must also be above every old game role, for the migration.

**`/gameadmin setup`** (admin role only)

- Checks the bot's permissions and role position first, and says exactly what to fix.
- Shows what it will create and asks for confirmation.
- Creates whatever is missing: the template role (mentionable, no permissions), the panel channel, #game-news, and the admin-only "Bot admin" category with #bot-admin, #bot-log and #bot-backups. The panel channel and #game-news are read-only for members.
- Adds the starting categories: Competitive, Chill, IRL activities.
- Posts the panel message and records every ID in the database.
- Running it again repairs anything deleted, never creates duplicates, and reports what was already fine.

**Then, by hand:** set the template role's color.

Manage Channels is only needed for setup and repair.

## Roles

The bot creates every game role by copying one template role, and it only ever changes roles listed in its own database.

- **Template role.** Admins create it once and set its color and "Allow anyone to @mention this role". It grants no permissions. The bot copies these settings onto each new game role.
- **Re-applying the template.** Later edits to the template don't carry over on their own. An admin action re-applies the template's settings to every game role.
- **One color for all game roles.** If members' main role has a color, that color still shows on names. The game color shows on role tags and @mentions.
- **Mentionable.** On by default (from the template), so direct `@Valheim` posts keep working.
- **Order.** Admins place the template below the members' main role and below the bot's own role. The bot keeps game roles directly below the template, sorted alphabetically, and re-sorts after each add or rename.
- **Safety rule.** The bot adds, removes and deletes only roles in its games table. The separate migration script is the only thing that deletes other roles.
- **Removing a game** deletes its Discord role, after an admin confirms. Everyone who had it loses it.
- **Bot permission.** The bot needs "Manage Roles", and its own role must sit above the template.

## Member experience

Everything starts from one button. Clicking it opens a private menu only that person can see, and every choice in it also exists as a slash command.

&#91;embedded content: panel menu · 7 member options, 2 admin options\]

The admin band appears only for members with the admin role; everyone else sees the seven options above it.

**What each option does**

- **Add games.** One multi-select dropdown per category, each under its own heading, with the person's current games already ticked. Submitting a dropdown changes roles in that category only.
- **Remove games.** Lists only the games the person has.
- **Suggest a game.** A short pop-up form: name, category, optional note. Covered under Suggestions and approval.
- **My games.** The person's current games, with a shortcut to change them.
- **Who plays…?** Pick a game, see who has it. The answer is private.
- **My suggestions.** Each suggestion's status: pending, approved or rejected (with the reason). Pending ones have a Withdraw button. This replaces notifications, since the bot never DMs.
- **Looking for group.** Opens the LFG form; the post goes to #game-news.
- **Admin buttons** appear only for the admin role. Covered under Admin tools.

**Slash commands**

- `/games` opens the same menu.
- `/games add`, `/games remove`, `/games suggest`, `/games mine`, `/games who`, `/games suggestions`
- `/lfg` posts in the channel it's typed in.
- `/gameadmin …` for admins only (see Admin tools).

**Finding a game by typing (autocomplete)**

- Matching is fuzzy (fuse.js), covers names and admin-set aliases, and tolerates typos.
- Admin-set **aliases** catch nicknames like `cod` or `wow`.
- Text is normalized first: case, accents, punctuation, `&` as "and".
- Suggestions fit the command: `add` hides games the person has; `remove` shows only theirs.
- With nothing typed yet, `add` shows popular games the person doesn't have.

**Right-click options** (members → Apps)

- **See their games**: a private list of that member's games.
- **Games in common**: the games you both have.

**Categories**

The first three are Competitive, Chill and IRL activities. Each game belongs to exactly one. A dropdown holds at most 25 games, so a category that grows past 25 gets split or paged.

## Suggestions and approval

Members suggest games; an admin approves, edits or rejects each one in #bot-admin, and the member sees the outcome under "My suggestions".

&#91;embedded content: suggestion flow · 1 check, 3 admin choices\]

A close match only prompts the member; it never blocks a suggestion.

- **Suggesting.** From the panel or `/games suggest`: name, category, optional note.
- **Duplicate check.** If the name closely matches an existing game or a pending suggestion, the bot asks "Did you mean …?" The member can pick that game or submit anyway.
- **Review card.** Each suggestion appears in #bot-admin with **Approve**, **Edit** and **Reject** buttons. Edit lets an admin fix the name, category or aliases before approving.
- **On approval** the bot creates the role from the template and sorts it into place. It adds the suggester to the role, announces the game in #game-news, and logs it.
- **On rejection** the admin enters a reason. The member sees it under "My suggestions", and the action is logged.
- **The suggester** checks the result under "My suggestions"; nothing is sent to them.
- **Limit.** A member can have at most 10 pending suggestions at once. An eleventh is refused with a short explanation.
- **Withdrawing.** A member can withdraw a pending suggestion from "My suggestions". Its review card in #bot-admin is marked withdrawn, and it's logged.

## Looking for group (LFG)

LFG is an optional, structured way to ask "anyone up for this?": one post pings the game's role, then members respond with a click and the post keeps a live headcount. Plain `@game` posts still work for everything else.

- **Starting one.** `/lfg` posts in the channel it's typed in. The panel's "Looking for group" button posts in #game-news.
- **The form.** Game (with autocomplete), an optional "when" (free text such as "tonight 9pm"), an optional note. "When" is shown exactly as typed; the bot doesn't interpret it.
- **The post** shows who started it, the game, when, the note and the role ping. Below that, two lists: **In** and **Maybe**. Whoever started the post is already in **In**.
- **Buttons on the post:** I'm in, Maybe, and Join this game's role. Clicking I'm in or Maybe again removes you, and a line under the lists says so. There's no "No" button: not answering means no.
- **Join this game's role** lets someone who doesn't follow the game sign up from the post itself. It's logged like any other join.
- **No cooldowns to start. Deferred to later:** which channels allow `/lfg`, whether posts close or expire, and whether a post opens a thread.
- **Old posts keep working.** If a post's game has since been removed, its buttons say so instead of failing.

## Admin tools

Members with the admin role get extra buttons in the same private menu, and matching `/gameadmin` commands. Everyone else never sees either. The bot checks the role on every action, not just when showing the buttons.

- **Review suggestions.** Lists pending suggestions; the same cards also sit in #bot-admin.
- **Add a game** directly: name, category, aliases.
- **Edit a game:** rename it, move it to another category, or change its aliases.
- **Remove a game.** Asks for confirmation, then deletes its role.
- **Manage categories:** add, rename, reorder.
- **Re-apply template** to every game role after the template changes.
- **Refresh panel.** Re-posts or updates the panel message if it was deleted or changed.
- **Run backup now.** Takes a backup immediately and posts it to #bot-backups, the same as the nightly one. Useful before a risky change and for testing. Also available as `/gameadmin backup`.
- **Run setup.** Creates or repairs the template role, channels and panel (see Bot setup). Also available as `/gameadmin setup`.

## Logging, backups and monitoring

Things that need attention go to #bot-admin; routine records go to the muted #bot-log and #bot-backups.

**#bot-log: one line per action**

- Members: joined or left a game, and where from (panel, command, LFG post).
- Suggestions: submitted, approved, edited, rejected, and by whom.
- Admins: games added, edited or removed; categories changed; template re-applied.
- A "bot started" line on every start, so repeated restarts are easy to spot.
- Per-action lines let an admin trace what happened when a member says "my role disappeared".

**#bot-admin: needs attention**

- Suggestion review cards.
- Errors the bot caught.

**Backups**

- Nightly, the bot takes a consistent snapshot of its SQLite database and posts the file to #bot-backups.
- It then deletes its own backup posts older than 30 days.
- Admins can also take a backup at any time with **Run backup now** (see Admin tools).
- Restoring: download a file, stop the bot, replace the database file, start the bot.
- Who has which role lives in Discord, not the database. Losing the database loses games, categories, aliases and suggestions, but no one's roles.

**Monitoring**

- **Crash:** Docker restarts the container automatically.
- **Lost connection to Discord:** discord.js reconnects on its own.
- **Stuck or droplet down:** nothing alerts. The bot shows as offline in the member list, and an admin restarts it when they notice. For a single server, live down alerts aren't worth the setup of an external service.

## Migration from Reaction Roles

A one-off script, kept out of the repo, moves members from the old roles to new bot-owned roles, with two confirmations before anything is deleted. Rehearse it on the test server first, with copies of the old roles.

1. **Prepare.** Run the bot's setup on production (see Bot setup). The bot's role must sit above every old role, or the old roles can't be deleted.
2. **Create the new games** through the bot with Add game, so the bot creates their roles from the template and tracks them.
3. **Map.** In a mapping file kept only where the script runs, list each old role and the new game role it becomes, or "drop". It is never committed.
4. **Dry run.** The script prints the plan: members to copy into each new role, old roles to delete, and anyone who will lose a dropped role. It warns if any old role still has channel permissions attached.
5. **First confirmation.** The script copies members from each mapped old role into its new role. Discord rate-limits role changes, so this can take a little while.
6. **Verify.** The script prints old and new member counts side by side; spot-check in Discord.
7. **Second confirmation.** The script deletes the old roles, mapped and dropped.
8. **Clean up.** Remove the Reaction Roles bot and its reaction message. Delete the script and mapping file from wherever they ran.
9. **Go live.** Post the panel message and announce the new setup.

**Where the script runs.** Rehearse it from your computer against the test server, using the dev bot's token. For production, copy the script and mapping onto the droplet and run it once in a throwaway container with the prod env file, so the prod token never leaves the droplet. The script calls Discord's API directly instead of connecting as a live bot, so it doesn't interfere with the running bot. Its actions don't appear in #bot-log; its terminal output is the record.

While it runs, members shouldn't use the old reaction message, so announce a short pause beforehand.

## Data the bot stores

One SQLite file holds what Discord doesn't. Discord stays the source of truth for who has which role.

| Record | What it holds |
| --- | --- |
| Games | Name, category, Discord role ID, aliases, who added or approved it, when |
| Categories | Name, display order |
| Suggestions | Who suggested, name, category, note, status (pending, approved, rejected, withdrawn), reviewer, rejection reason, decision date |
| LFG posts | Message, game, author, when, note, In and Maybe lists |
| Setup | IDs of the template role, channels and panel message, recorded by setup |

Tokens, the server ID and the admin role ID live in each environment's config, not the database.

## Personal data

The only member information the bot keeps is Discord user IDs. It stores no names, emails, messages or activity.

- **Stored in the database:** the user IDs of suggesters and reviewers, LFG authors and responders, and whoever added a game. Names are looked up from Discord when shown, never saved.
- **Not stored:** who has which role (Discord holds that), usernames or display names, message content (the bot doesn't ask for access to messages), online status, or what people are playing.
- **Held in memory only:** the server's member list, which Discord sends so the bot can answer "Who plays…?". This needs the bot's "Server Members" setting turned on. It's gone when the bot stops.
- **In Discord, admin-only:** #bot-log lines mention members and what they did. Backups in #bot-backups contain the database, and so the user IDs.
- **Never in the repo:** any member data, including in tests, which use made-up IDs.
- **When a member leaves:** nothing changes. Their records stay; Discord removes their roles, so they drop out of "Who plays…?" on their own.

Finished LFG posts and decided suggestions are kept indefinitely; at this size the database stays tiny.

## Tech stack and versions

Everything uses the latest compatible release as of November 2026; exact versions are pinned in the lockfile.

| Component | Choice | Notes |
| --- | --- | --- |
| Runtime | Node.js 26 LTS | LTS since Oct 28, 2026, supported to Apr 30, 2029 ([source](https://fireup.pro/news/nodejs-26-lts-whats-new-upgrade)) |
| Discord library | discord.js 14.28.x | Latest stable; v15 is published only as dev builds ([releases](https://github.com/discordjs/discord.js/releases)) |
| TypeScript | 7.0 | Type-checking only, since Node runs the `.ts` files. |
| Linter | oxlint + oxlint-tsgolint | Type-aware rules run on TypeScript 7; tsgolint versions track the TypeScript version ([tsgolint](https://github.com/oxc-project/tsgolint)) |
| Formatter | oxfmt | Still 0.x with near-weekly releases, so pinned exactly |
| Package manager | pnpm |  |
| Tests | Vitest |  |
| Database | SQLite through better-sqlite3 | Tables are described in TypeScript with Drizzle. drizzle-kit generates each SQL migration from schema changes, much like Django's `makemigrations`. Queries are written with Kysely |
| Container | Official Node 26 slim image | Keeps Node off the Ubuntu 22.04 host |

**What running `.ts` directly means:** Node removes type annotations at startup. TypeScript features that generate code (enums, namespaces, constructor parameter properties) are off-limits, and the `erasableSyntaxOnly` setting enforces that. TypeScript 7 also makes `strict` the default.

## Hosting and deployment

The bot runs in its own Docker Compose project on the existing droplet (1 vCPU, 1 GB RAM, 25 GB disk, Ubuntu 22.04). It shares nothing with the Django app.

**On the droplet**

- Own folder, own compose file, own Docker network. No ports are opened, since the bot only makes outgoing connections.
- The container restarts automatically and has a memory limit, set after checking how much the Django app uses.
- The SQLite file lives in a mounted folder on the host, so it survives rebuilds.
- Container logs are capped in size, to protect the 25 GB disk.
- Secrets live in an env file on the droplet. The repo holds only an example file with no real values.

**Deploying (GitHub Actions)**

1. Push to `main`.
2. GitHub Actions runs type-check, lint, tests and a check that every schema change has a migration. If any fail, nothing is deployed.
3. Actions connects to the droplet over SSH as a dedicated deploy user, with a key that can only run the deploy script.
4. The deploy script pulls the latest `main`, then rebuilds and restarts the bot's compose project, using the env file already on the droplet. The repo is public, so pulling needs no GitHub credentials on the droplet.
5. Check the run in the Actions tab and the "bot started" line in #bot-log.

Actions deploys production only. The same deploy script can also be run by hand over SSH if Actions is unavailable.

**Development** uses the dev bot against the test server. It runs only on your own computer, never on the droplet, so the droplet's resources go to Django and the prod bot.

- **How it runs:** run it directly with Node 26 and pnpm, or with the same compose file under Docker. It uses its own dev env file and its own local database file.
- **Backups work in dev too.** Dev has its own channels in the test server (see Testing).

**Before the first deploy**

- Check memory use and whether swap exists. Add swap if there is none.
- Confirm Docker Compose v2 is installed.
- Ubuntu 22.04 standard support ends in 2027. That doesn't block anything now.

## Public repository and security

The repo is public, but no secret ever enters it or GitHub. GitHub stores only what it needs to reach the droplet; the bot's secrets stay in the env file on the droplet.

**In the repo:** the code, tests, Dockerfile, compose file, deploy workflow, an example env file with placeholder values, a license, and a README. The README says the bot is built for one server and explains how to run your own copy.

**Never in the repo:** the env file, the migration script and its mapping file, bot tokens, the database and backups, the droplet's address, and server, channel or role IDs. Member names and the server's name also stay out; they live in config or the database.

**Stored in GitHub** (repository secrets; no per-environment secrets needed, since only production deploys):

| Secret | Why |
| --- | --- |
| Droplet host | Keeps the server's address out of public files |
| Deploy user | The limited account Actions logs in as |
| SSH private key | Used only to run the deploy script |
| SSH host fingerprint | Confirms Actions is connecting to your droplet, not an impostor |

**Setup checklist: GitHub**

- [ ] `.gitignore` covers the env file, database and backups before the first commit. Git history is public too, and deleting a file later doesn't remove it from history.
- [ ] Turn on secret scanning and push protection, so pushes containing tokens are blocked.
- [ ] Protect `main`: no force pushes, no deletion.
- [ ] Run workflows only on pushes to `main` and manual runs. Never use the `pull_request_target` trigger. Pull requests from forks get no secrets by default; keep it that way.
- [ ] Set the workflow token's default permissions to read-only.
- [ ] Pin every third-party action to an exact commit.
- [ ] Turn on Dependabot alerts for vulnerable dependencies.

**Setup checklist: droplet**

- [ ] Create a dedicated deploy user with no sudo.
- [ ] Restrict the deploy key in that user's `authorized_keys` to one command (the deploy script), with no shell, terminal or port forwarding.
- [ ] Keep the deploy script outside the repo, owned by root and not editable by the deploy user. The deploy user can run Docker, which is close to root access, so the script must be the only thing the key can do.
- [ ] SSH accepts keys only: no passwords, no root login.
- [ ] The env file is readable only by the account that runs the bot.

**Setup checklist: Discord**

- [ ] Turn off "Public Bot" on both applications, so only you can invite them.
- [ ] Give the bot only the permissions it needs (the list under Bot setup); never Administrator.
- [ ] The prod token exists only in the droplet's env file; the dev token only on your machine.

**If something leaks**

- **Bot token:** reset it in the Discord Developer Portal, update the env file, restart the bot. Reset first, clean up git history after.
- **SSH key:** remove it from the droplet's `authorized_keys`, create a new key, update the GitHub secret.

## Discord limits and constraints

None of these limits block the design at this size; each is handled as follows.

| Limit | Value | How the design handles it |
| --- | --- | --- |
| Roles per server | 250 | Not a concern at a few dozen games |
| Options per dropdown | 25 | One dropdown per category; split or page a category past 25 |
| Components per message (newer layout) | 40 | Room for roughly 10 to 12 categories in one menu |
| Autocomplete suggestions | 25 | The best 25 matches are shown |
| Time to answer a click or command | 3 seconds | Acknowledge first, then do slow work. Autocomplete can't do this, so it answers from memory. |
| Private (ephemeral) replies | Only in reply to an action | No DMs; "My suggestions" replaces notifications |
| Right-click commands | 5 per type | Uses 2 of the 5 member commands |
| Bot role position | Must be above roles it manages | The template sits below the bot's role |
| Rate limits | Role changes are throttled | discord.js queues requests; mostly matters during migration |

## Testing

Vitest covers the bot's decision-making; Discord itself is tested by hand on the test server.

**Unit tests (Vitest)** for the logic that doesn't need Discord:

- Autocomplete ranking, normalization and aliases.
- Working out which roles to add or remove when a category dropdown is submitted.
- Duplicate detection and the 10-pending limit for suggestions.
- Admin-role checks.
- Picking which backups are older than 30 days.

Calls to Discord sit behind a thin layer, so this logic runs in tests without a connection.

**Manual checks** on the test server with the dev bot before each production deploy: panel, add and remove, suggest and approve, LFG, the right-click options, the logs. GitHub Actions also runs tests, lint and type-check on every push to main; a failure stops the deploy.

**Testers.** Anyone you invite to the test server can test along with you. Give some testers the dev admin role and leave others without it, so both views get checked. The dev bot only answers while it runs on your computer; otherwise clicks show "This interaction failed".

## Open items and future ideas

These are the decisions still to make before or during the build.

**Open questions**

- [ ] Name of the panel channel.
- [ ] LFG: which channels allow `/lfg`, whether posts close or expire, threads, whether the author can edit.
- [x] SQLite driver: better-sqlite3, with Drizzle for the schema and migrations and Kysely for queries.
- [x] Fuzzy matching library: fuse.js.
- [ ] Time of day for the nightly backup.
- [ ] Container memory limit, after checking the droplet's memory and swap.
- [ ] Register slash commands on every startup, or with a separate script.
- [ ] License: MIT (others may reuse the code) or none (people can read it but not reuse it).

**Possible later**

- Game roles that unlock game-specific channels.
- Upgrading the droplet's Ubuntu.
- Real dates for LFG "when" (quick choices plus a time, shown in each viewer's time zone), which would allow auto-closing posts and reminders.

**Sources**

- [Node.js 26 LTS dates](https://fireup.pro/news/nodejs-26-lts-whats-new-upgrade)
- [discord.js releases](https://github.com/discordjs/discord.js/releases)
- [oxlint type-aware linting (tsgolint)](https://github.com/oxc-project/tsgolint)
