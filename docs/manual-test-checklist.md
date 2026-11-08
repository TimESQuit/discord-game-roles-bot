# Manual test checklist

Run on the test server with the dev bot before each production deploy. Do everything twice: once as an admin tester (has the dev admin role) and once as a non-admin tester. Keep `#bot-log` open and confirm one line per action.

## Panel and roles

- [ ] Admin: `/gameadmin setup` on a fresh server shows the plan, asks to confirm, creates everything. Running it again reports nothing to do.
- [ ] Both: the panel button opens a private menu. The non-admin sees no admin buttons; the admin does.
- [ ] Both: join and leave a game from a category dropdown; the role changes and `#bot-log` gets one line.
- [ ] Both: game autocomplete finds games by name and alias.
- [ ] Non-admin: every admin button, modal and `/gameadmin` command is refused.

## Add and remove games

- [ ] Admin: `/games add` and `/games remove` replies render: a deferred private reply, then the newer layout.
- [ ] Admin: adding a game creates its role below the template, sorted alphabetically, with the template's settings, and announces it in `#game-news`.
- [ ] Admin: removing a game asks for confirmation, deletes the role and the database row.
- [ ] Admin: edit a game name and aliases; the role is renamed.

## Suggest and approve

- [ ] Non-admin: suggest a game; a close match offers "Did you mean ...?".
- [ ] Non-admin: the 11th pending suggestion is refused (limit 10).
- [ ] Admin: the review card in `#bot-admin` can approve, edit or reject (with a reason).
- [ ] Non-admin: "My suggestions" shows the result; no DM is sent.
- [ ] Admin: the review list with several long suggestions renders (text limit).

## LFG

- [ ] Both: start an LFG post from the panel; it appears in `#game-news` with you already under In.
- [ ] The "Click your answer again to remove it." line shows as small grey text under the lists.
- [ ] The LFG role mention inside the newer layout actually pings the role, and editing the post does not ping again.

## Right-click options and logs

- [ ] Both: the right-click member commands appear and work as intended; non-admins are refused admin ones.
- [ ] `#bot-log` has exactly one line per action, including joins from panel, command and LFG.

## Setup, panel repair and restarts

- [ ] Refresh panel on a panel posted with the newer layout updates it in place. A panel deleted by hand gets reposted.
- [ ] `/gameadmin setup` on a server missing a permission shows the problem list, not an error.
- [ ] A recreated Bot admin category gets the existing admin channels moved into it.
- [ ] Restart behaviour: "Bot started" appears once per start.

## Review Focus

- [ ] Two admins act on one suggestion card (or approve after the member withdrew): exactly one decision lands; the second admin gets "This suggestion was already approved."
- [ ] A game's role deleted by hand: menus still render; joining replies "That game's role is missing; the admins have been told."; `#bot-admin` gets a notice; Remove game still deletes the row.
- [ ] A category with 0 games, one with more than 25, a menu over 40 components, and a stale dropdown submitted after a game was removed: no select is sent with 0 options, categories chunk and page, unknown selections are ignored.
- [ ] User text with mentions (`@everyone`, `<@&id>`) in game names, notes, LFG "when" and rejection reasons never pings anyone.
- [ ] Bot loses Manage Roles, or its role is dragged below the template: role actions reply with the exact fix ("Move the bot's role above Game role template in Server Settings → Roles") instead of "This interaction failed".
- [ ] Quickly ticking then unticking the same game in one dropdown within a moment may be a no-op (member cache lag); re-open the menu to confirm.

## Backups and monitoring

- [ ] Admin: Run backup now posts a file to `#bot-backups`. Download it and run `sqlite3 <file> .tables`; it opens and lists the tables.
- [ ] Stop the dev bot and wait: the healthchecks.io alert arrives in `#bot-admin`. Pause the check afterwards.
