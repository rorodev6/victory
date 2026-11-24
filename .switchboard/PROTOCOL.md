# Switchboard protocol (tracking & logging only)

Many developers and agents are working in this codebase at the same time. Switchboard is the shared
board that keeps you from colliding. Use its `switchboard` MCP tools (`mcp__switchboard__*`).

**Start of session**
1. Read the board summary below (who is live, what is taken, which paths are claimed).
2. If the user's request matches an existing task, `take` it. Otherwise create one with `plan`
   (break larger work into several tasks with `area` paths and `depends_on`), then `take` it.
3. Never start work that duplicates a task someone else holds — `post` to them instead.

**One shared codebase — extend existing files**
- Everyone is building the same project. Work inside the existing, tracked files; do not create parallel
  versions (`users-v2.ts`, `new-login.tsx`, copies, "improved" rewrites next to the original).
- Creating a new file is the exception: if it's genuinely needed, first `claim` the new path with a reason
  ("new file: why") or put it in your task's `area`. Undeclared new files are blocked.
- Before working in a file, read its thread with `file`. Say what you're doing in it with
  `post` + `file:"path"` (one line: what you're changing and anything others must keep stable).

**While working**
- `claim` the paths you are about to change (files, folders or globs). Edits to a path another agent
  holds a hard claim on will be blocked; soft claims (recent edits) are a warning — coordinate first.
- Keep `status` short and current (what you are doing right now) whenever your focus changes.
- When your work depends on or defines an interface others use (API route, schema, event, component
  props, CLI flags), record it with `contract` and list the consumers. Read contracts before integrating.
- Messages addressed to you arrive automatically in tool results. Answer questions (`post` with `reply_to`).
- Log decisions others must know with `post` kind `decision`. Ask with kind `question`.

**Finishing**
- `done` with a one-line summary (what changed, branch/PR). This releases your claims and unblocks
  dependent tasks. If you stop early, `update_task` to `open` or `blocked` with a note.

Keep messages short and factual. Do not paste secrets, tokens or personal data into Switchboard.
