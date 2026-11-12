# Manual test checklist

Run on the test server with the dev bot before each production deploy. Do everything twice: once as an admin tester (has the dev admin role) and once as a non-admin tester. Keep `#game-roles-log` open and confirm one line per action.

## Panel and roles

- [ ] Admin: `/gameadmin setup` on a fresh server shows the plan, asks to confirm, creates everything. Running it again reports nothing to do.
- [ ] Both: the panel button opens a private menu. The non-admin sees no admin buttons; the admin does.
- [ ] Both: join and leave a game from a category dropdown; the role changes and `#game-roles-log` gets one line.
- [ ] Both: game autocomplete finds games by name and alias.
- [ ] Non-admin: every admin button, modal and `/gameadmin` command is refused.

## Add and remove games

- [ ] Admin: `/games add` and `/games remove` replies render: a deferred private reply, then the newer layout.
- [ ] Admin: adding a game creates its role below the template, sorted alphabetically, with the template's settings, and announces it in `#game-roles`.
- [ ] Admin: removing a game asks for confirmation, deletes the role and the database row.
- [ ] Admin: edit a game name and aliases; the role is renamed.

## Suggest and approve

- [ ] Non-admin: suggest a game; a close match offers "Did you mean ...?".
- [ ] Non-admin: the 11th pending suggestion is refused (limit 10).
- [ ] Admin: the review card in `#game-roles-admin` can approve, edit or reject (with a reason).
- [ ] Non-admin: "My suggestions" shows the result; no DM is sent.
- [ ] Admin: the review list with several long suggestions renders (text limit).

## LFG

- [ ] Both: start an LFG post from the panel; it appears in `#game-roles` with you already under In.
- [ ] Member: `/games menu` in a normal channel, then Looking for group: the post appears in that channel.
- [ ] Member: `/lfg` (or `/games menu` → Looking for group) in a channel members can't post in, such as #rules: the bot refuses privately and posts nothing.
- [ ] The "Click your answer again to remove it." line shows as small grey text under the lists.
- [ ] The LFG role mention inside the newer layout actually pings the role, and editing the post does not ping again.

## Right-click options and logs

- [ ] Both: the right-click member commands appear and work as intended; non-admins are refused admin ones.
- [ ] `#game-roles-log` has exactly one line per action, including joins from panel, command and LFG.

## Setup, panel repair and restarts

- [ ] Refresh panel on a panel posted with the newer layout updates it in place. A panel deleted by hand gets reposted.
- [ ] `/gameadmin setup` on a server missing a permission shows the problem list, not an error.
- [ ] A recreated Game Roles Admin category gets the existing admin channels moved into it.
- [ ] Restart behaviour: "Bot started" appears once per start.
- [ ] `/gameadmin uninstall` run from `#game-roles-admin` with nothing kept: Uninstall is disabled until "Keep admin channels" is ticked.
- [ ] The same from a thread inside `#game-roles-admin`: Uninstall is disabled there too.
- [ ] Uninstall keeping nothing, run from another channel: roles and channels are gone, the report has a backup file that opens with `sqlite3`, and `/gameadmin setup` then rebuilds everything.
- [ ] Uninstall keeping roles: members still have their game roles afterwards.
- [ ] Uninstall with "Leave the server": the report arrives, then the bot leaves and its commands disappear. Invite it again afterwards.

## Review Focus

- [ ] Two admins act on one suggestion card (or approve after the member withdrew): exactly one decision lands; the second admin gets "This suggestion was already approved."
- [ ] A game's role deleted by hand: menus still render; joining replies "That game's role is missing. This error has been logged."; `#game-roles-log` gets a ⚠️ error line; Remove game still deletes the row.
- [ ] A category with 0 games, one with more than 25, a menu over 40 components, and a stale dropdown submitted after a game was removed: no select is sent with 0 options, categories chunk and page, unknown selections are ignored.
- [ ] User text with mentions (`@everyone`, `<@&id>`) in game names, notes, LFG "when" and rejection reasons never pings anyone.
- [ ] A masked link (`[Claim](https://example.com)`) or a `# heading` in an LFG note or a suggestion shows as plain text, not a link or a heading.
- [ ] Bot loses Manage Roles, or its role is dragged below the template: role actions reply with the exact fix ("Move the bot's role above Game role template in Server Settings → Roles") instead of "This interaction failed".
- [ ] Quickly ticking then unticking the same game in one dropdown within a moment may be a no-op (member cache lag); re-open the menu to confirm.

## Backups

- [ ] Admin: Run backup now posts a file to `#game-roles-backups`. Download it and run `sqlite3 <file> .tables`; it opens and lists the tables.
