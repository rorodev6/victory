# Switchboard quickstart

Coordination for many developers and AI agents on one project. Everything lives in the project's own
git repo: no server, no tokens, no accounts. Whoever can push to the repo is in. It knows nothing about
what the project is. Needs Node 18+ and git. Works with any git host (the automatic security checks and
Issues mirror need GitHub) and with any AI tool (Claude Code gets hooks; others use the CLI).

## Set a project up (once, by the owner)
```
cd <your project repo>
node <where-you-unzipped>/switchboard-kit/switchboard.mjs init --owner <your-github-login>
git checkout -b switchboard-setup && git add -A && git commit -m "Add Switchboard" && git push -u origin switchboard-setup
```
Open a pull request, review it, merge it. Then in the repo's GitHub settings:
- protect the default branch (pull requests + review from Code Owners);
- add a ruleset on `switchboard-state`: block force pushes and deletion;
- Actions > General > Workflow permissions: read-only by default.

If the repository does not accept binary files, add `--no-fonts` to `init`: the install is then text only
(the dashboard uses system fonts).

## Every developer (nothing to install)
```
git pull
```
Open Claude Code in the repo and approve the project's hooks and MCP server when asked. That's it:
the session is briefed, edits are checked, and the `switchboard` tools are available.

Start with one sentence:
> Give me a rundown on how this project currently works, what is in progress, and where I can start without overlapping.

Dashboard: `node .switchboard/switchboard.mjs ui`

The project's README gets a **Live work board** section: a picture of who is working on what, grouped by
workstream, redrawn by the checks every few minutes (skip it with `init --no-readme`).

## Your name on the board
You appear under an alias like `dev-1a2b` until you choose otherwise: in the dashboard (your avatar, top right),
or `node .switchboard/switchboard.mjs name "Your Name"` (`name --reset` goes back to the alias).

## Large files that are not in git
Declare the root for the team in `.switchboard/project.json`: `"roots": { "assets": "Renders and plates" }`.
On each machine that has them, open the dashboard's **Build list**, press **Choose folder…** next to the root
and **Connect**: the folder is scanned and watched from then on. Or from a terminal:
```
node .switchboard/switchboard.mjs root add assets D:\path\to\assets
node .switchboard/switchboard.mjs scan assets
```
Only file names, sizes and times are shared. Plan outputs with a task area like `@assets/ep01/**`.

## Other AI tools (Codex, Cursor, Aider, ChatGPT with a shell)
```
node .switchboard/switchboard.mjs prompt --out AGENTS.md
```
They use the same board through the CLI: `rundown`, `board`, `take 12`, `claim <path>`, `post "..."`, `done 12 "..."`.

## Fully private (nothing leaves the machine)
```
node <where-you-unzipped>/switchboard-kit/switchboard.mjs init --local
```
The board then lives only in `.git/switchboard/` on that machine, even if the repo has a GitHub remote, and
the files `init` writes stay uncommitted until you decide. A repo with no remote behaves the same way.
Switch to syncing through the repo later with `init --sync`.

## What is shared when a remote is used
Task and message text you write, file paths, sizes and times, and branch names. People and machines appear
under neutral aliases (`dev-1a2b`, `pc-3c4d`): your git name, your email and your computer's name are never
published. To show a name of your choice: `git config switchboard.name <alias>` and
`git config switchboard.host <label>`. Never shared: file contents, prompts, or local folder locations.
