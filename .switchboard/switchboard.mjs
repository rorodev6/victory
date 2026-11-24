#!/usr/bin/env node
// Switchboard (GitHub-only): coordination for many developers and AI agents on one project, kept in the
// project's own private repo. No server, no tokens — access is whoever can push to the repo.
//
//   node .switchboard/switchboard.mjs dev [--pick]         start working (what DEV.cmd / DEV.sh run): pull, board, your AI tool
//   node .switchboard/switchboard.mjs join                 new here? signs you in, sets your name, opens the board
//   node .switchboard/switchboard.mjs init                 set this repo up (commit the result as a PR)
//   node .switchboard/switchboard.mjs ui                   open the live dashboard (local)
//   node .switchboard/switchboard.mjs start | stop | info  the local companion (starts itself on demand)
//   Agents without MCP tools:
//     rundown | board | streams | inbox | who | take <id> | done <id> "summary" | doing "what now" | file <path> | buildlist
//     plan "Title" [--area a,b] [--after 12] [--priority 0-4] [--body ..] | claim <paths..> [--why ..] | release [paths..|--all]
//     post "message" [--file path] [--kind question|decision|handoff|alert] [--to @handle] [--task 12]
//     contract "name" [--spec ..] [--kind api] [--status agreed] [--consumers @a,@b]
//   Files outside git (renders, media, data):
//     root add <name> <folder> | root list | root remove <name> | scan <name>
//   prompt [--out AGENTS.md]      system prompt for any AI, tailored to this project
//   ignore <handle> [--off]       stop a clearly bogus reservation from blocking edits on this machine
//   name ["Your Name"] [--reset]  the name you appear under on the board (default: an alias like dev-1a2b)
//   (internal: hook, mcp, daemon, ci <validate|render|issues|issue-event>)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const KIT = path.dirname(SELF);
const argv = process.argv.slice(2);
const cmd = argv[0] || 'help';
const flag = (n) => { const i = argv.indexOf('--' + n); return i < 0 ? undefined : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true); };
const opt = (n) => { const v = flag(n); return v === undefined || v === true ? undefined : String(v); };
const positionals = () => { const out = []; for (let i = 1; i < argv.length; i++) { if (argv[i].startsWith('--')) { if (argv[i + 1] && !argv[i + 1].startsWith('--')) i++; } else out.push(argv[i]); } return out; };
const list = (v) => (v ? v.split(',').map((x) => x.trim()).filter(Boolean) : undefined);
const git = (cwd, ...a) => { try { return execFileSync('git', a, { cwd, encoding: 'utf8', timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }).trim(); } catch { return ''; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------- talking to the local companion ----------------
/** The project this copy of Switchboard belongs to: the repo that CONTAINS this file. A hook fired while an
 *  agent is inside some other repository (a submodule, a vendored clone) is ignored — Switchboard never acts
 *  on a repo it was not installed into. */
function where(cwd = process.cwd()) {
  const top = git(cwd, 'rev-parse', '--show-toplevel'); if (!top) return null;
  const real = (x) => { try { return fs.realpathSync(x).toLowerCase(); } catch { return path.resolve(x).toLowerCase(); } };
  if (!fs.existsSync(path.join(top, '.switchboard', 'project.json'))) return null;
  if (real(path.join(top, '.switchboard')) !== real(KIT)) return null; // not the repo this client was installed into
  const common = path.resolve(top, git(top, 'rev-parse', '--git-common-dir'));
  return { top: path.resolve(top), base: path.join(common, 'switchboard'), branch: git(cwd, 'branch', '--show-current') || undefined };
}
const daemonInfo = (w) => { try { const d = JSON.parse(fs.readFileSync(path.join(w.base, 'daemon.json'), 'utf8')); return Number.isInteger(d.port) && typeof d.secret === 'string' && d.secret.length >= 32 ? d : null; } catch { return null; } };
const hmac = (secret, msg) => crypto.createHmac('sha256', secret).update(msg).digest('base64url');
const same = (a, b) => { const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || '')); return x.length === y.length && crypto.timingSafeEqual(x, y); };
/** Signed request: the secret from daemon.json never travels; the reply must prove the companion knows it too
 *  (so some other program that grabbed the port cannot feed answers to the agent). */
async function call(w, route, body, timeoutMs = 4000) {
  const d = daemonInfo(w); if (!d) throw new Error('companion not running');
  const raw = JSON.stringify(body || {}); const ts = Date.now(); const nonce = crypto.randomBytes(16).toString('base64url');
  const r = await fetch(`http://127.0.0.1:${d.port}${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-sb-ts': String(ts), 'x-sb-nonce': nonce, 'x-sb-sig': hmac(d.secret, `${ts}.${nonce}.${route}.${crypto.createHash('sha256').update(raw).digest('hex')}`) }, body: raw, signal: AbortSignal.timeout(timeoutMs) });
  if (!same(r.headers.get('x-sb-proof'), hmac(d.secret, `proof.${nonce}`))) throw new Error('companion identity check failed');
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || String(r.status));
  return j;
}
// covers the companion's code and the dashboard it serves: after a `git pull` brings a new Switchboard, the
// next hook or command finds the running companion stale and restarts it on the new version
const codeSig = (() => { const h = crypto.createHash('sha256'); try { const lib = path.join(KIT, 'lib'); const ui = path.join(KIT, 'ui'); const uiFiles = fs.existsSync(ui) ? fs.readdirSync(ui).filter((n) => /\.(js|css|html)$/.test(n)).sort().map((n) => path.join(ui, n)) : []; for (const f of [SELF, ...fs.readdirSync(lib).filter((n) => n.endsWith('.mjs')).sort().map((n) => path.join(lib, n)), ...uiFiles]) { h.update(path.basename(f)); h.update(fs.readFileSync(f)); } } catch { /* ignore */ } return h.digest('hex').slice(0, 16); })();
/** 'ok' | 'stale' (running older code than this checkout) | false */
async function alive(w, timeout = 1500) {
  const d = daemonInfo(w); if (!d) return false;
  try {
    const n = crypto.randomBytes(12).toString('base64url');
    const r = await fetch(`http://127.0.0.1:${d.port}/healthz?n=${n}`, { signal: AbortSignal.timeout(timeout) }); const j = await r.json();
    if (!r.ok || !same(j.proof, hmac(d.secret, `health.${n}`))) return false;
    return j.code === codeSig ? 'ok' : 'stale';
  } catch { return false; }
}
const pidAlive = (pid) => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const lockHolder = (w) => { try { return Number(fs.readFileSync(path.join(w.base, 'daemon.lock'), 'utf8')) || 0; } catch { return 0; } };
function spawnDaemon(w, { create }) {
  try { if (pidAlive(lockHolder(w)) && Date.now() - fs.statSync(path.join(w.base, 'daemon.lock')).mtimeMs < 20_000) return; } catch { /* no lock */ } // one is starting right now
  fs.mkdirSync(w.base, { recursive: true });
  const out = fs.openSync(path.join(w.base, 'daemon.log'), 'a');
  spawn(process.execPath, [SELF, 'daemon'], { cwd: w.top, detached: true, stdio: ['ignore', out, out], windowsHide: true, env: { ...process.env, ...(create ? {} : { SWITCHBOARD_NO_CREATE: '1' }) } }).unref();
}
/** create: may this call create the shared board branch on the remote? Only explicit commands, never hooks. */
async function ensure(w, { waitMs = 15_000, create = true } = {}) {
  let st = await alive(w);
  if (st === 'stale') { try { await call(w, '/rpc/stop', {}, 2000); } catch { /* already gone */ } await sleep(300); st = false; }
  if (st === 'ok') return true;
  spawnDaemon(w, { create });
  for (const t0 = Date.now(); Date.now() - t0 < waitMs;) { await sleep(150); if ((await alive(w)) === 'ok') return true; }
  return false;
}
const need = () => { const w = where(); if (!w) { console.error('Run this inside a repository that has Switchboard set up (.switchboard/project.json), using that repo\'s own .switchboard/switchboard.mjs.'); process.exit(1); } return w; };

// ---------------- hook shim (fast, fails open) ----------------
const EDIT = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const filesOf = (ti = {}) => [ti.file_path, ti.notebook_path].filter((x) => typeof x === 'string' && x);
function similarFiles(root, target) {
  const all = git(root, 'ls-files', '-co', '--exclude-standard').split('\n').filter(Boolean);
  const words = (p) => new Set(path.posix.basename(p).replace(/\.[^.]+$/, '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter((x) => x.length > 1));
  const rel = path.relative(root, target).replace(/\\/g, '/'); const tw = words(rel); const ext = path.extname(rel); const dir = path.posix.dirname(rel);
  if (!tw.size || rel.startsWith('..')) return [];
  return all.map((p) => { const w = words(p); let inter = 0; for (const x of tw) if (w.has(x)) inter++; return { p, inter, score: inter / (tw.size + w.size - inter || 1) + (path.extname(p) === ext ? 0.1 : 0) + (path.posix.dirname(p) === dir ? 0.15 : 0) }; })
    .filter((x) => x.inter > 0 && x.score >= 0.35 && x.p !== rel).sort((a, b) => b.score - a.score).slice(0, 6).map((x) => x.p);
}
async function hook() {
  let input = ''; for await (const c of process.stdin) { input += c; if (input.length > 2e6) break; }
  let h; try { h = JSON.parse(input); } catch { return; }
  const cwd = h.cwd || process.cwd();
  // only for the project this client lives in; anything else (another repo the agent wandered into) is ignored
  const w = where(cwd) || (process.env.CLAUDE_PROJECT_DIR ? where(process.env.CLAUDE_PROJECT_DIR) : null); if (!w) return;
  const inside = (f) => { const rel = path.relative(w.top, f); return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel); };
  const out = (o) => process.stdout.write(JSON.stringify(o));
  const base = { session_id: h.session_id, top: w.top, branch: w.branch };
  try {
    const ev = h.hook_event_name;
    if (ev === 'SessionStart') {
      if (!(await ensure(w, { create: false }))) return;
      const r = await call(w, '/rpc/hook', { kind: 'session-start', ...base }, 25_000);
      if (r.context) out({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: r.context } });
      return;
    }
    if (!(await alive(w, 800))) { spawnDaemon(w, { create: false }); return; } // never hold up the developer (an older companion keeps guarding)
    if (ev === 'PreToolUse' && EDIT.has(h.tool_name)) {
      const files = filesOf(h.tool_input).map((f) => path.resolve(cwd, f)); if (!files.length) return;
      const fresh = files.filter((f) => !fs.existsSync(f));
      const r = await call(w, '/rpc/hook', { kind: 'pre-edit', ...base, paths: files, new_paths: fresh, similar: fresh.length ? similarFiles(w.top, fresh[0]) : [] }, 2500);
      if (r.decision === 'deny') out({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: r.reason } });
      else if (r.context) out({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: r.context } });
    } else if (ev === 'PostToolUse') {
      const b = { kind: 'activity', ...base, tool: h.tool_name };
      if (EDIT.has(h.tool_name)) b.paths = filesOf(h.tool_input).map((f) => path.resolve(cwd, f));
      else if (h.tool_name === 'Bash' && /\bgit\s+(commit|push)\b|\bgh\s+pr\s+create\b/.test(String(h.tool_input?.command || ''))) b.command = String(h.tool_input.command).slice(0, 500);
      else return;
      const r = await call(w, '/rpc/hook', b, 2500);
      if (r.context) out({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: r.context } });
    } else if (ev === 'UserPromptSubmit') {
      const r = await call(w, '/rpc/hook', { kind: 'prompt', ...base }, 2000);
      if (r.context) out({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: r.context } });
    } else if (ev === 'SessionEnd') await call(w, '/rpc/hook', { kind: 'session-end', ...base }, 2000);
  } catch (e) { if (process.env.SWITCHBOARD_DEBUG) console.error(e); }
}

// ---------------- MCP over stdio (Claude Code starts this per session) ----------------
const S = (props, req = []) => ({ type: 'object', properties: { ...props, agent: { type: 'string', description: 'Your Switchboard handle (from your session briefing). Needed when several sessions share one folder.' } }, required: req });
const str = (d) => ({ type: 'string', description: d }); const int = (d) => ({ type: 'integer', description: d }); const arr = (d, items = { type: 'string' }) => ({ type: 'array', items, description: d });
const TOOLS = [
  { name: 'hello', description: 'Join the board (or re-attach) and get the live briefing: who is working on what, claimed paths, ready tasks, contracts, unread messages.', inputSchema: S({ name: str('Preferred handle if new') }) },
  { name: 'status', description: 'Say what you are doing right now (one short line).', inputSchema: S({ doing: str('e.g. "wiring refresh-token rotation in src/auth"'), task_id: int('Task you are on') }, ['doing']) },
  { name: 'board', description: 'List tasks. filter: ready | mine | active | all.', inputSchema: S({ filter: { type: 'string', enum: ['ready', 'mine', 'active', 'all'] } }) },
  { name: 'plan', description: 'Create tasks (one or many). Use ref + depends_on to chain them. area = paths/globs the task will touch (repo-relative, or @root/… for files outside git = planned outputs).', inputSchema: S({ tasks: arr('Tasks', S({ ref: str('Local reference'), title: str('Imperative, specific'), body: str('Details'), priority: int('0 = urgent … 4 = someday'), area: arr('Paths or globs'), depends_on: arr('refs or task ids'), accept: str('Acceptance criteria') }, ['title'])) }, ['tasks']) },
  { name: 'take', description: 'Atomically take a task (fails if someone else owns it) and claim its paths. Use before starting work.', inputSchema: S({ task_id: int('Task id'), force: { type: 'boolean', description: 'Only when the current owner agreed' } }, ['task_id']) },
  { name: 'update_task', description: 'Change a task: status (open|taken|blocked|review|done|dropped), note, priority, title, body, area, depends_on, accept.', inputSchema: S({ task_id: int('Task id'), status: str('New status'), note: str('Why / progress'), priority: int('0-4'), title: str(''), body: str(''), area: arr(''), depends_on: arr(''), accept: str('') }, ['task_id']) },
  { name: 'done', description: 'Finish a task: marks done, releases its claims, notifies dependents, logs the summary.', inputSchema: S({ task_id: int('Task id'), summary: str('What changed, where (branch/PR/commit)') }, ['task_id', 'summary']) },
  { name: 'check', description: 'Who else is touching these paths? (hard = reserved, soft = being edited)', inputSchema: S({ paths: arr('Files, dirs or globs') }, ['paths']) },
  { name: 'claim', description: 'Reserve paths (files, dirs, globs) before editing. Refused if another agent holds an overlapping hard claim.', inputSchema: S({ paths: arr('Files, dirs or globs'), task_id: int('Related task'), reason: str('Why'), force: { type: 'boolean' } }, ['paths']) },
  { name: 'release', description: "Release claims: specific paths, a task's claims, or all of yours.", inputSchema: S({ paths: arr('Paths'), task_id: int('Task'), all: { type: 'boolean' } }) },
  { name: 'post', description: 'Message the project channel or one agent. kind: chat | question | answer | decision | handoff | alert. file: attach to that file\'s thread.', inputSchema: S({ body: str('Short, factual'), to: str('@handle | humans | all'), kind: str('Kind'), task_id: int('Related task'), reply_to: str('Message id you answer'), file: str('Path whose thread this belongs to') }, ['body']) },
  { name: 'inbox', description: 'Unread messages for you plus the recent channel.', inputSchema: S({ recent: int('How many recent messages') }) },
  { name: 'file', description: 'Everything about one file: who edited it, claims, open tasks covering it, and its discussion thread.', inputSchema: S({ path: str('File path') }, ['path']) },
  { name: 'contract', description: 'Create/update an integration contract (API route, schema, event, component props, CLI). status: proposed | agreed | implemented | retired.', inputSchema: S({ name: str('e.g. "POST /api/sessions"'), kind: str('api | schema | event | component | cli | other'), spec: str('The interface'), status: str(''), consumers: arr('@handles that depend on it') }, ['name']) },
  { name: 'contracts', description: 'List integration contracts (or one by name with its full spec).', inputSchema: S({ name: str('Exact name') }) },
  { name: 'rundown', description: 'The project rundown for someone starting or resuming: what the project is, its rules, who is working on what, what is in progress, what is free to take, reserved paths, large files outside git, recent decisions and open questions, and how to start without overlapping. Use when asked how the project works or where to begin.', inputSchema: S({}) },
  { name: 'workstreams', description: 'What is being worked on right now, grouped automatically by area of the project (and kind of work: feature, fix, tests, docs, assets…): who is in each area, what is in progress, where open work has nobody on it.', inputSchema: S({}) },
  { name: 'who', description: 'Live agents with their branch, current task and last activity.', inputSchema: S({}) },
  { name: 'set_name', description: 'Change the name the person you work for appears under on the board (shared with everyone on the project). Only when they ask for it; an empty name goes back to the automatic alias.', inputSchema: S({ name: str('e.g. "Sam" — 1-40 letters, numbers, spaces, . - \'') }, ['name']) },
  { name: 'buildlist',description: 'The build list: planned outputs, files tracked outside git, per-folder totals and the most recent files.', inputSchema: S({}) },
];
async function mcp() {
  // Some tools start MCP servers outside the project folder: fall back to the repo this copy lives in.
  const w = where() || where(path.dirname(KIT)); const sid = `mcp-${process.pid}`;
  const write = (o) => process.stdout.write(JSON.stringify(o) + '\n');
  let buf = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) {
    buf += chunk; let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const lineText = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!lineText) continue;
      let m; try { m = JSON.parse(lineText); } catch { continue; }
      if (m.id === undefined) continue;
      const ok = (result) => write({ jsonrpc: '2.0', id: m.id, result });
      try {
        if (m.method === 'initialize') ok({ protocolVersion: m.params?.protocolVersion || '2025-06-18', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'switchboard', version: '2.0.0' }, instructions: 'Switchboard: the shared board for everyone working on this project. Take or plan a task before working, claim paths before editing, keep status current, record interfaces with contract, finish with done. Coordination and logging only.' });
        else if (m.method === 'ping') ok({});
        else if (m.method === 'tools/list') ok({ tools: TOOLS });
        else if (m.method === 'tools/call') {
          if (!w || !(await ensure(w))) { ok({ content: [{ type: 'text', text: 'Switchboard could not start here. It only works inside the repository it is installed in, with git access to that repository.' }], isError: true }); continue; }
          const r = await call(w, '/rpc/tool', { name: m.params?.name, args: m.params?.arguments || {}, top: w.top, branch: w.branch }, 40_000);
          ok({ content: [{ type: 'text', text: r.text }], ...(r.isError ? { isError: true } : {}) });
        } else if (m.method === 'resources/list') ok({ resources: [] });
        else if (m.method === 'prompts/list') ok({ prompts: [] });
        else write({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'method not found' } });
      } catch (e) { ok({ content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true }); }
    }
  }
  void sid;
}

// ---------------- CLI tools for agents without MCP ----------------
async function toolCli(name, args) { const w = need(); if (!(await ensure(w))) throw new Error('companion could not start'); if (opt('agent')) args = { ...args, agent: opt('agent') }; const r = await call(w, '/rpc/tool', { name, args, top: w.top, branch: w.branch }, 40_000); console.log(r.text); if (r.isError) process.exitCode = 1; }
const num = (v) => (v === undefined ? undefined : Number(v));
const toolCmds = {
  board: () => toolCli('hello', {}), rundown: () => toolCli('rundown', {}), streams: () => toolCli('workstreams', {}), inbox: () => toolCli('inbox', {}), who: () => toolCli('who', {}), buildlist: () => toolCli('buildlist', {}),
  take: () => toolCli('take', { task_id: Number(positionals()[0]), force: !!flag('force') }),
  done: () => toolCli('done', { task_id: Number(positionals()[0]), summary: positionals().slice(1).join(' ') || 'done' }),
  doing: () => toolCli('status', { doing: positionals().join(' '), task_id: num(opt('task')) }),
  file: () => toolCli('file', { path: positionals()[0] }),
  claim: () => toolCli('claim', { paths: positionals(), reason: opt('why'), task_id: num(opt('task')) }),
  release: () => toolCli('release', flag('all') ? { all: true } : { paths: positionals() }),
  plan: () => toolCli('plan', { tasks: [{ title: positionals().join(' '), body: opt('body'), area: list(opt('area')), depends_on: list(opt('after')), priority: num(opt('priority')), accept: opt('accept') }] }),
  post: () => toolCli('post', { body: positionals().join(' '), file: opt('file'), kind: opt('kind'), to: opt('to'), task_id: num(opt('task')) }),
  contract: () => toolCli('contract', { name: positionals()[0], spec: opt('spec'), kind: opt('kind'), status: opt('status'), consumers: list(opt('consumers')) }),
};

// ---------------- roots (files outside git) ----------------
async function rootCmd() {
  const w = need(); if (!(await ensure(w))) throw new Error('companion could not start');
  const [sub, name, dir] = positionals(); const cur = (await call(w, '/rpc/roots', {})).roots;
  if (sub === 'add') {
    if (!/^[a-z0-9][a-z0-9._-]{0,39}$/.test(name || '')) throw new Error('root name: lower-case letters, digits, . _ - (e.g. assets)');
    const abs = path.resolve(dir || ''); if (!dir || !fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) throw new Error(`folder not found: ${dir}`);
    await call(w, '/rpc/roots', { set: { ...cur, [name]: abs } });
    console.log(`@${name} -> ${abs}  (this machine only; watching it now)\nRegister what is already there:  node .switchboard/switchboard.mjs scan ${name}`);
  } else if (sub === 'remove') { const n = { ...cur }; delete n[name]; await call(w, '/rpc/roots', { set: n }); console.log(`removed @${name}`); }
  else { const names = Object.keys(cur); if (!names.length) console.log('(no roots mapped — add one: root add assets D:\\path\\to\\assets)'); for (const n of names) console.log(`@${n}  ${cur[n]}`); }
}
async function scan() { const w = need(); if (!(await ensure(w))) throw new Error('companion could not start'); const n = positionals()[0]; console.log(`scanning @${n} (names, sizes and times only)…`); const r = await call(w, '/rpc/scan', { root: n }, 600_000); console.log(`registered ${r.files} files in ${r.shards} manifest parts`); }

// ---------------- companion lifecycle ----------------
async function start() { const w = need(); console.log((await ensure(w)) ? `companion running on http://127.0.0.1:${daemonInfo(w).port}` : 'could not start the companion (see .git/switchboard/daemon.log)'); }
async function stop() {
  const w = need();
  if (await alive(w)) { try { await call(w, '/rpc/stop', {}, 3000); } catch { /* gone */ } } // only ever stops a process that proved it is the companion
  await sleep(200); for (const f of ['daemon.json']) fs.rmSync(path.join(w.base, f), { force: true });
  if (!pidAlive(lockHolder(w))) fs.rmSync(path.join(w.base, 'daemon.lock'), { force: true });
  console.log('stopped');
}
async function ignore() { const w = need(); if (!(await ensure(w))) throw new Error('companion could not start'); const h = positionals()[0]; const r = await call(w, '/rpc/ignore', { handle: h, on: !flag('off') }); console.log(r.ignore.length ? `Reservations from these handles no longer block edits on this machine: ${r.ignore.map((x) => '@' + x).join(', ')}  (undo: ignore <handle> --off)` : 'No handles are ignored.'); }
// ---------------- join: everything a new developer needs, in one command ----------------
/** Can this machine's command-line git push to the repo? Asks GitHub with the person's own saved sign-in
 *  (from git's credential helper; it only ever goes to api.github.com and is never stored or printed). */
async function githubAccess(top) {
  const origin = git(top, 'remote', 'get-url', 'origin');
  const m = origin.match(/^https:\/\/(?:([^@/]+)@)?github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/i);
  if (!m) return { known: false };
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' };
  let tok = ''; let user = m[1] || '';
  try {
    const out = execFileSync('git', ['credential', 'fill'], { cwd: top, env, input: `protocol=https\nhost=github.com\n${user ? `username=${user}\n` : ''}\n`, encoding: 'utf8', timeout: 20_000, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    tok = (out.match(/^password=(.*)$/m) || [])[1] || ''; user = (out.match(/^username=(.*)$/m) || [])[1] || user;
  } catch { return { known: true, signedIn: false }; }
  if (!tok) return { known: true, signedIn: false };
  try {
    const r = await fetch(`https://api.github.com/repos/${m[2]}`, { headers: { Authorization: `Bearer ${tok}`, Accept: 'application/vnd.github+json', 'User-Agent': 'switchboard-join' }, signal: AbortSignal.timeout(15_000) });
    if (r.status === 401) return { known: true, signedIn: false, user };
    if (r.status === 404) return { known: true, signedIn: true, user, read: false, write: false, repo: m[2] };
    const j = await r.json(); return { known: true, signedIn: true, user, read: true, write: !!j.permissions?.push, repo: m[2] };
  } catch { return { known: false }; }
}
async function join() {
  const w = need(); const say = (s = '') => console.log(s);
  say('Joining the Switchboard board for this project.\n');
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' };
  const reach = () => { try { execFileSync('git', ['ls-remote', '--heads', 'origin'], { cwd: w.top, env, stdio: 'ignore', timeout: 30_000, windowsHide: true }); return true; } catch { return false; } };
  if (!git(w.top, 'remote', 'get-url', 'origin')) say('1. No GitHub remote: the board stays on this machine.');
  else {
    let acc = await githubAccess(w.top);
    if (!reach() || (acc.known && !acc.signedIn)) {
      say('1. Sign in to GitHub: a browser window opens. Use the GitHub account that was invited to this repo.');
      let gcm = true; try { execFileSync('git', ['credential-manager', '--version'], { stdio: 'ignore', windowsHide: true }); } catch { gcm = false; }
      if (gcm) { try { execFileSync('git', ['credential-manager', 'github', 'login'], { cwd: w.top, stdio: 'inherit' }); } catch { /* checked below */ } }
      else { // no Git Credential Manager (common on Linux and macOS): GitHub's own CLI does the same job
        let gh = true; try { execFileSync('gh', ['--version'], { stdio: 'ignore', windowsHide: true }); } catch { gh = false; }
        if (!gh) { console.error('\nx To sign in, install the GitHub CLI (https://cli.github.com), then run join again.'); process.exitCode = 1; return; }
        try { execFileSync('gh', ['auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https', '--web'], { stdio: 'inherit' }); execFileSync('gh', ['auth', 'setup-git'], { stdio: 'inherit' }); } catch { /* checked below */ }
      }
      acc = await githubAccess(w.top);
      if (!reach()) { console.error('\nx Still cannot reach the repository. Check that you accepted the invite to it on GitHub, then run join again.'); process.exitCode = 1; return; }
    }
    if (acc.known && acc.signedIn && !acc.write) { console.error(`\nx Signed in as ${acc.user || 'your account'}, which can ${acc.read ? 'read' : 'not see'} ${acc.repo} but cannot push to it.\n  Ask the repo owner to give that account the Write role (Settings -> Collaborators), or sign in with another account:\n  git credential-manager github login\n  then run join again.`); process.exitCode = 1; return; }
    say(`1. GitHub: signed in${acc.user ? ` as ${acc.user}` : ''}${acc.known ? ', can push' : ''}.`);
  }
  if (!(await ensure(w))) { console.error('x Switchboard could not start (see .git/switchboard/daemon.log)'); process.exitCode = 1; return; }
  let name = opt('name');
  if (name === undefined && process.stdin.isTTY && !flag('yes')) {
    const rl = (await import('node:readline/promises')).createInterface({ input: process.stdin, output: process.stdout });
    const cur = (await call(w, '/rpc/name', {})).name;
    name = (await rl.question(`2. Name to show on the board (Enter keeps "${cur}"): `)).trim(); rl.close();
  }
  const r = await call(w, '/rpc/name', name ? { name } : {}, 30_000);
  if (r.error) say(`   ${r.error} You can set it later: name "Your Name"`);
  say(`2. You appear on the board as "${r.name}". Change it any time in the dashboard or with: name "Your Name"`);
  const s = await call(w, '/rpc/sync', {}, 30_000);
  say(`3. Switchboard is running${s.offline ? ' (offline for now: it keeps trying)' : ' and in sync with the team'}.`);
  if (!flag('no-ui')) { say('4. Opening your dashboard…'); await ui(); }
  say('\nDone. Now open Claude Code in this folder, approve the project\'s hooks and MCP server once, and ask:\n  "Give me a rundown on how this project currently works and where I can start without overlapping."');
}
// ---------------- dev: what DEV.cmd / DEV.sh run — one double-click to start working ----------------
const RUNDOWN = 'Give me a rundown on how this project currently works, what is in progress, and where I can start without overlapping.';
async function dev() {
  const w = need(); const say = (s = '') => console.log(s);
  say('Getting you ready to work on this project.\n');
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' };
  const br = git(w.top, 'branch', '--show-current');
  try { execFileSync('git', ['pull', '--ff-only', '--quiet'], { cwd: w.top, env, stdio: 'ignore', timeout: 180_000, windowsHide: true }); say(`- Latest code pulled${br ? ` (${br})` : ''}.`); }
  catch { say('- Could not pull the latest code automatically (local changes, a branch without upstream, or offline). Carrying on with what you have.'); }
  if (git(w.top, 'config', '--get', 'switchboard.joined') !== 'true') {
    say('- First time on this machine: joining the board.\n');
    await join(); if (process.exitCode) return;
    git(w.top, 'config', 'switchboard.joined', 'true');
  } else {
    if (!(await ensure(w))) { console.error('x Switchboard could not start (see .git/switchboard/daemon.log)'); process.exitCode = 1; return; }
    const r = await call(w, '/rpc/name', {}); const s = await call(w, '/rpc/sync', {}, 30_000);
    say(`- Switchboard is running${s.offline ? ' (offline for now: it keeps trying)' : ' and in sync'}; you appear as "${r.name}".`);
    if (!flag('no-ui')) { say('- Opening your dashboard…'); await ui(); }
  }
  if (flag('no-claude') || flag('no-tool')) return;
  // Which AI tool? Asked once per repo per machine (DEV --pick asks again); remembered in local git config.
  const T = await import('./lib/tools.mjs');
  T.projectConfigs(w.top); // keeps every tool's MCP config present here, even where the repo does not carry it
  let id = opt('tool') || (flag('pick') ? '' : git(w.top, 'config', '--get', 'switchboard.tool'));
  let tool = T.TOOLS.find((t) => t.id === id);
  if (!tool) {
    const avail = T.TOOLS.map((t) => ({ t, ok: T.installed(t) }));
    if (!process.stdin.isTTY) tool = (avail.find((a) => a.t.id === 'claude' && a.ok) || avail.find((a) => a.t.id === 'none')).t;
    else {
      say('\nWhich AI tool do you work with? Switchboard connects to all of these.');
      avail.forEach((a, i) => say(`  ${i + 1}. ${a.t.name}${a.t.cmd ? (a.ok ? '' : '   (not installed)') : ''}`));
      const rl = (await import('node:readline/promises')).createInterface({ input: process.stdin, output: process.stdout });
      const def = Math.max(0, avail.findIndex((a) => a.ok && a.t.cmd)) + 1;
      for (;;) {
        const ans = (await rl.question(`Pick a number [${def}]: `)).trim() || String(def); const n = Number(ans);
        const a = avail[n - 1]; if (!a) { say('  Type one of the numbers above.'); continue; }
        if (!a.ok) { say(`  ${a.t.name} is not installed here. Get it: ${a.t.get}  (or pick another)`); continue; }
        tool = a.t; break;
      }
      rl.close();
    }
    git(w.top, 'config', 'switchboard.tool', tool.id);
    if (tool.id !== 'none') say(`  Saved: DEV starts ${tool.name} from now on (DEV --pick to change).`);
  } else if (!T.installed(tool)) { say(`\n${tool.name} is not installed on this machine (get it: ${tool.get}). Run DEV --pick to choose another tool.`); return; }
  if (tool.hooks) say(`\nStarting ${tool.name} here. Approve the project's hooks and MCP server if it asks (first time only).\n`);
  else if (tool.id !== 'none') say(`\nStarting ${tool.name}. Switchboard's board tools come through MCP; edits are not checked automatically outside Claude Code, so take or claim work before editing.\n`);
  T.start(tool, w.top, RUNDOWN, say);
}
async function nameCmd() {
  const w = need(); if (!(await ensure(w))) throw new Error('companion could not start');
  const v = positionals().join(' ').trim();
  const r = await call(w, '/rpc/name', flag('reset') ? { reset: true } : v ? { name: v } : {}, 30_000);
  if (r.error) { console.error('x ' + r.error); process.exitCode = 1; return; }
  console.log(v || flag('reset') ? `You now appear on the board as "${r.name}" (this repo, this machine).` : `You appear on the board as "${r.name}"${r.custom ? '' : ' (the automatic alias)'}.\nChange it:  name "Your Name"     back to the alias:  name --reset`);
}
async function info() { const w = need(); const up = await alive(w); console.log(up ? `running: http://127.0.0.1:${daemonInfo(w).port}` : 'not running'); if (up) console.log(JSON.stringify(await call(w, '/rpc/sync', {}, 30_000))); }
async function ui() {
  const w = need(); if (!(await ensure(w))) throw new Error('companion could not start');
  const t = await call(w, '/rpc/ticket', {}); const url = `http://127.0.0.1:${t.port}/open?t=${t.ticket}`; // one-time link, valid for a minute
  console.log(`Dashboard: http://127.0.0.1:${t.port}/  (opening your browser)`);
  if (!flag('no-open')) { const [c, a] = process.platform === 'win32' ? ['cmd.exe', ['/d', '/s', '/c', 'start', '""', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]]; try { spawn(c, a, { detached: true, stdio: 'ignore', windowsHide: true }).unref(); } catch { console.log(url); } } else console.log(url);
}
async function daemon() { const { runDaemon } = await import('./lib/daemon.mjs'); await runDaemon(process.cwd(), { uiDir: fs.existsSync(path.join(KIT, 'ui')) ? path.join(KIT, 'ui') : null, port: Number(process.env.SWITCHBOARD_PORT || 0) }); }
async function prompt() {
  const w = need(); if (!(await ensure(w))) throw new Error('companion could not start');
  const r = await call(w, '/rpc/prompt', {}, 8000);
  const out = opt('out');
  if (!out) return void process.stdout.write(r.text);
  const file = path.resolve(out); const cur = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const block = `<!-- switchboard:prompt (generated; refresh with: node .switchboard/switchboard.mjs prompt --out ${path.basename(file)}) -->\n${r.text}<!-- /switchboard:prompt -->`;
  fs.writeFileSync(file, /<!-- switchboard:prompt[\s\S]*?<!-- \/switchboard:prompt -->/.test(cur) ? cur.replace(/<!-- switchboard:prompt[\s\S]*?<!-- \/switchboard:prompt -->/, block) : (cur ? cur.trimEnd() + '\n\n' : '') + block + '\n');
  console.log(`wrote ${file}`);
}

const main = { hook, mcp, daemon, start, stop, info, ignore, ui, prompt, root: rootCmd, scan, name: nameCmd, join, dev, ...toolCmds,
  init: async () => (await import('./lib/init.mjs')).init({ KIT, argv, flag, opt }),
  ci: async () => (await import('./lib/ci.mjs')).ci(argv.slice(1)),
  help: async () => console.log(fs.readFileSync(SELF, 'utf8').split('\n').slice(1, 20).join('\n').replace(/^\/\/ ?/gm, '')) }[cmd];
if (!main) { console.error(`unknown command: ${cmd}`); process.exit(2); }
main().catch((e) => { if (cmd === 'hook') process.exit(0); console.error('x ' + e.message); process.exit(1); });
