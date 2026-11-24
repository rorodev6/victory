// The local companion: one small process per repo per machine. It keeps the board in memory (edit checks
// in milliseconds), is the ONLY writer to GitHub for every agent on this machine (changes are bundled
// into one commit + push every few seconds), watches the big folders outside git, and serves the
// dashboard on 127.0.0.1. Agents reach it through the hook and MCP shims in switchboard.mjs.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as E from './state.mjs';
import * as AS from './assets.mjs';
import * as WS from './streams.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const now = () => Date.now();
const gitA = (cwd, args, timeout = 20_000) => new Promise((res) => execFile('git', args, { cwd, encoding: 'utf8', timeout, windowsHide: true, env: E.gitEnv() }, (err, out) => res(err ? null : String(out).trim())));

export async function runDaemon(cwd, { port = 0, uiDir = null, quiet = false } = {}) {
  const L = E.ensureState(E.locate(cwd));
  const log = (...a) => { if (!quiet) console.log(new Date().toISOString().slice(11, 19), ...a); };
  const remote = E.hasRemote(L);
  const cfgFile = path.join(L.top, '.switchboard', 'project.json');
  const proj = (() => { try { return JSON.parse(fs.readFileSync(cfgFile, 'utf8')); } catch { return {}; } })();
  const origin = E.git(L.top, ['remote', 'get-url', 'origin'], { quiet: true }) || '';
  const slugM = origin.replace(/\.git$/, '').match(/[:/]([\w.-]+\/[\w.-]+)$/);
  const project = E.line(proj.project, 120) || (slugM ? slugM[1].toLowerCase() : path.basename(L.top).toLowerCase());
  const mainRepo = E.line(proj.main_repo, 120) || (slugM ? slugM[1] : null);
  let human = E.displayName(L.top); // an alias by default, never the git name unless the person sets one (`name`)
  const gitEmail = E.line(process.env.SWITCHBOARD_EMAIL || E.git(L.top, ['config', 'user.email'], { quiet: true }) || '', 200);
  const label = AS.okLabel(E.hostLabel(L.top));
  const secret = crypto.randomBytes(32).toString('base64url'); // shared with the shims through daemon.json; requests are SIGNED with it, it is never transmitted
  const uiToken = crypto.randomBytes(32).toString('base64url'); // dashboard cookie; cannot call /rpc/*
  const tickets = new Map(); // one-time, 60 s links for opening the dashboard
  const hmac = (msg) => crypto.createHmac('sha256', secret).update(msg).digest('base64url');
  const ownerKey = E.ownerKey(gitEmail);
  const safe = (x, n = 200) => (E.line(x, n) || '').replace(/<(\/?)switchboard-/gi, '‹$1switchboard-');
  // single instance per repo: a second companion would race the first one on the same checkout
  const lockFile = path.join(L.base, 'daemon.lock');
  for (let i = 0; ; i++) {
    try { fs.writeFileSync(lockFile, String(process.pid), { flag: 'wx' }); break; } catch {
      let holder = 0; try { holder = Number(fs.readFileSync(lockFile, 'utf8')); } catch { /* unreadable */ }
      let alive = false; if (holder && holder !== process.pid) { try { process.kill(holder, 0); alive = true; } catch (e) { alive = e.code === 'EPERM'; } }
      if (alive) { // the pid exists — but is it really a companion for this repo?
        let young = false; try { young = now() - fs.statSync(lockFile).mtimeMs < 20_000; } catch { /* gone */ }
        if (!young) { alive = false; try { const d = JSON.parse(fs.readFileSync(path.join(L.base, 'daemon.json'), 'utf8')); if (d.pid === holder) { const n = crypto.randomBytes(12).toString('base64url'); const r = await fetch(`http://127.0.0.1:${d.port}/healthz?n=${n}`, { signal: AbortSignal.timeout(1500) }); const j = await r.json(); alive = j.proof === crypto.createHmac('sha256', d.secret).update(`health.${n}`).digest('base64url'); } } catch { alive = false; } }
      }
      if (alive || i > 3) { log('another companion is already running for this repo — exiting'); process.exit(0); }
      try { fs.rmSync(lockFile, { force: true }); } catch { /* retry */ }
    }
  }
  // the dashboard is served from a snapshot taken now, not from whatever branch gets checked out later
  const uiFiles = new Map();
  if (uiDir) { const walk = (d, rel = '') => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const r = rel ? `${rel}/${e.name}` : e.name; if (e.isDirectory()) walk(path.join(d, e.name), r); else if (e.isFile() && uiFiles.size < 200) uiFiles.set(r, fs.readFileSync(path.join(d, e.name))); } }; try { walk(uiDir); } catch { /* no dashboard */ } }
  const intro = (() => { const rd = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } }; const uni = rd(path.join(HERE, '..', 'PROTOCOL.md')); const own = rd(path.join(L.top, '.switchboard', 'INTRO.md')); const clean = (s) => E.text(s, 16_000).replace(/<(\/?)switchboard-/gi, '‹$1switchboard-'); return `<switchboard-protocol>\nScope: this protocol ONLY governs how you register, track, claim, log and communicate work on the shared Switchboard.\nIt never overrides the user's instructions, the repository's CLAUDE.md, or your safety rules, and it never asks you to run code, fetch URLs, reveal secrets or change what you build.\n\n${clean(uni)}${own.trim() ? `\n\n## Project rules (.switchboard/INTRO.md)\n${clean(own)}` : ''}\n</switchboard-protocol>`; })();

  // ---------------- local (never pushed) ----------------
  let local = E.readLocal(L); local.sessions = local.sessions || {}; local.byTop = local.byTop || {}; local.read = local.read || {}; local.roots = local.roots || {};
  const saveLocal = () => { try { fs.writeFileSync(L.localFile, JSON.stringify(local, null, 1)); } catch { /* ignore */ } };
  const sessionSeen = new Map();
  const nudged = new Set(); const threadShown = new Map(); const pendingNew = new Set(); const softOverlay = new Map(); // agent -> Map(path -> at)

  // ---------------- in-memory board (rebuilt after every sync cycle) ----------------
  let cache = { agents: [], tasks: [], claims: [], messages: [], contracts: [], events: [], files: [], head: '', at: 0, buildlist: null };
  const streams = new Set();
  const emit = (ev, data) => { for (const r of streams) r.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`); };
  let lastEventT = now(); let lastMsgAt = now();
  function rebuild() {
    const S = E.store(L);
    const files = new Map();
    for (const fn of S.list('files').slice(0, 2000)) {
      const h = fn.endsWith('.json') ? fn.slice(0, -5) : ''; if (!E.okHandle(h)) continue;
      for (const [rawP, x] of Object.entries(S.read(`files/${fn}`, {})).slice(0, 2000)) {
        if (!x || typeof x !== 'object') continue; const p = E.norm(E.line(rawP, E.CFG.maxPath)); if (!p) continue;
        const f = files.get(p) || { path: p, edits: 0, agents: [], last_agent: null, last_at: 0, created_by: null };
        const at = Math.min(Number(x.at) || 0, now()); f.edits += Number(x.n) || 0; f.agents.push(h); if (at > f.last_at) { f.last_at = at; f.last_agent = h; } if (x.new === true) f.created_by = h; files.set(p, f);
      }
    }
    const next = { agents: E.agents(S), tasks: E.tasks(S), claims: E.claims(S), messages: E.messages(S), contracts: E.contracts(S), events: E.events(S), files: [...files.values()].sort((a, b) => b.last_at - a.last_at).slice(0, 400), head: E.git(L.state, ['rev-parse', 'HEAD'], { quiet: true }) || '', at: now(), buildlist: null };
    // an agent's "current task" only counts while that task is really theirs and open
    for (const a of next.agents) { const t = a.task && next.tasks.find((x) => x.id === a.task); if (a.task && (!t || t.owner !== a.id || ['done', 'dropped', 'open'].includes(t.status))) { a.task = null; } }
    const changed = next.head !== cache.head;
    cache = next;
    for (const e of next.events) if (e.t > lastEventT) emit('event', uiEvent(e));
    for (const m of next.messages) if (m.at > lastMsgAt) emit('message', uiMsg(m));
    lastEventT = Math.max(lastEventT, ...next.events.map((e) => e.t), 0); lastMsgAt = Math.max(lastMsgAt, ...next.messages.map((m) => m.at), 0);
    return changed;
  }
  const buildlist = () => (cache.buildlist ||= AS.buildList(E.store(L)));

  // ---------------- single-writer sync cycle ----------------
  let queue = []; let cycling = false; let again = false; let lastCycle = 0; let offline = false; let backoff = 0;
  /** Queue a change. hard = answer only after GitHub accepted it; lazy = bundled into the next push. */
  function change(labelText, fn, { lazy = false } = {}) {
    return new Promise((resolve, reject) => { queue.push({ label: labelText, fn, lazy, resolve, reject }); if (!lazy) setImmediate(cycle); });
  }
  async function cycle() {
    if (cycling) { again = true; return; }
    cycling = true;
    const batch = queue.splice(0);
    try {
      let done = false; let results = [];
      for (let attempt = 0; attempt < 6 && !done; attempt++) {
        if (remote) {
          if ((await gitA(L.state, ['fetch', '--quiet', 'origin', E.BRANCH], 15_000)) === null) { offline = true; throw new Error('offline'); }
          offline = false;
          if ((await gitA(L.state, ['reset', '--quiet', '--hard', `origin/${E.BRANCH}`])) === null) throw new Error('checkout');
          await gitA(L.state, ['clean', '-fdq']);
        }
        const S = E.store(L);
        results = batch.map((op) => { try { return { v: op.fn(S) }; } catch (e) { return { e }; } });
        if (!(await gitA(L.state, ['status', '--porcelain']))) { done = true; break; }
        if ((await gitA(L.state, ['add', '-A'])) === null) throw new Error('checkout');
        const labels = [...new Set(batch.map((o) => o.label))].slice(0, 6).join(', ');
        await gitA(L.state, ['commit', '--quiet', '-m', `sb: ${E.line(labels, 160) || 'sync'}`]);
        if (!remote) { done = true; break; }
        if ((await gitA(L.state, ['push', '--quiet', 'origin', `HEAD:${E.BRANCH}`], 20_000)) !== null) done = true;
        else await new Promise((r) => setTimeout(r, 150 + Math.random() * 400 * (attempt + 1))); // someone else pushed first: re-read, re-apply
      }
      if (!done) { await gitA(L.state, ['reset', '--quiet', '--hard', `origin/${E.BRANCH}`]); throw new Error('busy'); }
      softOverlay.clear();
      rebuild(); backoff = 0;
      batch.forEach((op, i) => (results[i].e ? op.reject(results[i].e) : op.resolve(results[i].v)));
    } catch (e) {
      // nothing was pushed: hard changes fail loudly, lazy ones wait for the next cycle
      backoff = Math.min(60_000, (backoff || 2000) * 2);
      for (const op of batch) { if (op.lazy && queue.length < 20_000) queue.push(op); else op.reject(new E.UserError(e.message === 'offline' ? 'cannot reach the project remote right now — nothing was changed. If this machine was never signed in to GitHub, the person should run: node .switchboard/switchboard.mjs join' : e.message === 'checkout' ? 'the shared board could not be checked out on this machine (an invalid file name was pushed) — the security check will remove it; try again in a few minutes' : 'the board is very busy — try again')); }
      try { rebuild(); } catch { /* keep old cache */ }
    } finally {
      cycling = false; lastCycle = now();
      if (again || queue.some((o) => !o.lazy)) { again = false; setImmediate(cycle); }
    }
  }
  // steady heartbeat: bundle lazy changes + pick up other machines' pushes
  setInterval(() => { const idle = !streams.size && !cache.agents.some((a) => E.isLive(a) && a.host === label); const every = backoff || (queue.length ? 3000 : idle ? 30_000 : 5000); if (now() - lastCycle >= every) cycle(); }, 1000).unref();

  // ---------------- identity ----------------
  const sessionTop = new Map(); // session id -> worktree, to notice several live sessions sharing one folder
  const shared = (top) => { const t = norm(top || ''); let n = 0; for (const [sid, tp] of sessionTop) if (tp === t && (sessionSeen.get(sid) || 0) > now() - 30 * 60_000) n++; return n > 1; };
  const meOf = (b) => { const h = (b.agent && String(b.agent).replace(/^@/, '')) || local.sessions[b.session_id] || (shared(b.top) ? null : local.byTop[norm(b.top || '')]); return E.okHandle(h) && cache.agents.find((a) => a.id === h && (!a.owner_key || !ownerKey || a.owner_key === ownerKey)) ? h : null; };
  const norm = (p) => E.norm(p).toLowerCase();
  const topOf = (b) => (b.top ? path.resolve(b.top) : L.top);
  const rootsMap = () => local.roots || {};
  function toRel(top, abs) {
    const a = path.resolve(String(abs));
    for (const [name, dir] of Object.entries(rootsMap())) { const rel = path.relative(path.resolve(dir), a); if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return `@${name}/${rel.replace(/\\/g, '/')}`; }
    return E.relPath(top, a);
  }
  const conflictsNow = (me, rels) => {
    const out = [];
    const ignored = new Set(local.ignore || []);
    for (const c of cache.claims) if (c.agent !== me && !ignored.has(c.agent)) for (const p of rels) if (E.overlaps(p, c.path)) out.push({ path: p, claim: c.path, agent: c.agent, mode: c.mode, task: c.task, reason: c.reason, offline: c.offline });
    for (const [ag, m] of softOverlay) if (ag !== me) for (const [cp, at] of m) if (now() - at < E.CFG.softTtlMs) for (const p of rels) if (E.overlaps(p, cp)) out.push({ path: p, claim: cp, agent: ag, mode: 'soft' });
    return out;
  };
  function inbox(me, { important = true, limit = 8 } = {}) {
    const cur = local.read[me] || 0;
    const rows = cache.messages.filter((m) => m.at > cur && m.sender !== me && (m.to === me || String(m.body).includes('@' + me) || (m.to == null && (!important || m.kind !== 'chat' || String(m.sender).startsWith('human:'))))).slice(-limit);
    if (rows.length || cache.messages.length) { local.read[me] = Math.max(cur, ...cache.messages.map((m) => m.at), 0); saveLocal(); }
    return rows;
  }
  const inboxText = (me) => { const un = inbox(me); return un.length ? E.boardBlock(`📨 Switchboard messages for @${me}:\n${un.map(E.fmtMsg).join('\n')}\n(Reply with the switchboard post tool; reply_to the msg id for questions.)`, 4000) : ''; };

  // ---------------- hooks ----------------
  const EDIT = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
  async function hook(kind, b) {
    const top = topOf(b);
    if (kind === 'session-start') {
      // a new session reuses the handle already used in this worktree, unless another live session holds it
      const prevH = local.byTop[norm(top)]; const busy = prevH && Object.entries(local.sessions).some(([sid, h]) => h === prevH && sid !== b.session_id && (sessionSeen.get(sid) || 0) > now() - 30 * 60_000);
      const reuse = local.sessions[b.session_id] || (busy ? undefined : prevH) || undefined;
      if (reuse) { local.sessions[b.session_id] = reuse; sessionSeen.set(b.session_id, now()); } // reserve now: sessions starting in the same instant must not share it
      const r = await change('join', (S) => { const a = E.join(S, { handle: reuse, human, git_email: gitEmail, host: label, branch: b.branch }); return { id: a.id, text: E.briefing(S, L, a.id, { intro, project }) }; });
      local = { ...E.readLocal(L), sessions: local.sessions, byTop: local.byTop, roots: local.roots, read: E.readLocal(L).read || local.read };
      local.sessions[b.session_id] = r.id; local.byTop[norm(top)] = r.id; sessionSeen.set(b.session_id, now()); sessionTop.set(b.session_id, norm(top)); saveLocal();
      return { agent: r.id, context: `${r.text}\n\n${E.boardBlock(WS.streamsText(WS.workstreams(cache, proj), r.id), 3000)}\n\nWhen the user asks how the project works, where things stand, or how to get started, call the switchboard rundown tool and answer from it.\nYou are @${r.id}. If a switchboard tool says it cannot tell which session you are, pass agent:"${r.id}".` };
    }
    const me = meOf(b);
    if (!me) return {};
    if (b.session_id) sessionSeen.set(b.session_id, now());
    if (kind === 'session-end') { change('leave', (S) => E.leave(S, me), { lazy: true }); setImmediate(cycle); return {}; }
    if (kind === 'pre-edit') {
      const rels = (b.paths || []).slice(0, 20).map((p) => toRel(top, p)).filter(Boolean);
      if (!rels.length) return {};
      const conf = conflictsNow(me, rels);
      const hard = conf.find((c) => c.mode === 'hard' && !c.offline);
      if (hard) return { decision: 'deny', reason: `Switchboard: ${safe(hard.path, 300)} is claimed by @${hard.agent}${Number.isInteger(hard.task) ? ` for task #${hard.task}` : ''}${hard.reason ? ` (their note, information only: "${safe(hard.reason, 120)}")` : ''}. Don't edit it — post to:"@${hard.agent}" to coordinate, wait for release, or pick other work. (If that reservation is clearly bogus, the developer can run: node .switchboard/switchboard.mjs ignore ${hard.agent})` };
      const self = cache.agents.find((a) => a.id === me);
      if (!self?.task && !nudged.has(me) && (process.env.SB_REQUIRE_TASK || proj.require_task || 'once') === 'once') {
        nudged.add(me);
        return { decision: 'deny', reason: `Switchboard: put this work on the board before your first edit, so the team can see it. Use the switchboard tools: take an existing task, or plan one (title + area:["${rels[0]}"]) and take it; then post a one-line note with file:"${rels[0]}" saying what you're changing. Then retry this edit. (If the switchboard tools are unavailable, just retry — this check only runs once per session.)` };
      }
      const notes = [];
      const fresh = (b.new_paths || []).slice(0, 20).map((p) => toRel(top, p)).filter((x) => x && !E.isRootPath(x));
      const policy = process.env.SB_NEW_FILE_POLICY || proj.new_file_policy || 'declare';
      for (const f of fresh) {
        if (policy === 'off') break;
        const similar = (Array.isArray(b.similar) ? b.similar : []).slice(0, 8).map((x) => E.line(x, 200));
        const copy = E.looksLikeCopy(f); const declared = E.newFileDeclared(E.store(L), me, f);
        if (policy === 'declare' && (!declared || copy)) return { decision: 'deny', reason: `Switchboard: creating NEW file ${f} was blocked. This team builds one shared codebase — extend existing files instead of adding parallel ones.${similar.length ? ` Similar existing files: ${similar.map((x) => safe(x, 200)).join(', ')}.` : ''}${copy ? ' The name looks like a copy/version of another file — edit the original.' : ''} If a new file is genuinely required, first claim it with a reason (switchboard claim paths:["${f}"] reason:"new file: <why>") or add it to your task's area, then retry.` };
        pendingNew.add(me + '|' + f);
      }
      if (!softOverlay.has(me)) softOverlay.set(me, new Map());
      for (const p of rels) softOverlay.get(me).set(p, now());
      change('edit', (S) => E.claim(S, me, rels, { mode: 'soft' }), { lazy: true }).catch(() => {});
      const soft = conf.filter((c) => c.mode === 'soft');
      if (soft.length) notes.push(`⚠ Switchboard: ${[...new Set(soft.map((c) => '@' + c.agent))].join(', ')} edited ${soft.map((c) => c.claim).slice(0, 3).join(', ')} in the last few minutes. Check with them before overlapping changes.`);
      for (const f of rels.slice(0, 5)) {
        const k = me + '|' + f; if ((threadShown.get(k) || 0) > now() - 30 * 60_000) continue;
        const th = cache.messages.filter((m) => m.file === f && m.sender !== me && m.at > now() - 72 * 3600_000).slice(-3);
        if (th.length) { threadShown.set(k, now()); notes.push(`Switchboard notes on ${f}:\n${th.map(E.fmtMsg).join('\n')}\n(Add yours: switchboard post file:"${f}")`); }
      }
      const ib = inbox(me); if (ib.length) notes.push(`📨 Messages for @${me}:\n${ib.map(E.fmtMsg).join('\n')}`);
      return notes.length ? { context: E.boardBlock(notes.join('\n'), 5000) } : {};
    }
    if (kind === 'activity') {
      if (EDIT.has(b.tool) && Array.isArray(b.paths)) {
        const edits = b.paths.slice(0, 20).map((p) => toRel(top, p)).filter(Boolean).map((p) => ({ path: p, at: now(), isNew: pendingNew.delete(me + '|' + p) }));
        if (edits.length) { change('edits', (S) => E.recordEdits(S, me, edits), { lazy: true }).catch(() => {}); emit('event', { agent: me, type: 'touch', data: { paths: edits.map((e) => e.path) }, created_at: now(), ephemeral: true, project }); }
      } else if (b.tool === 'Bash' && typeof b.command === 'string') {
        const c = b.command.slice(0, 500); const m = c.match(/git\s+commit\b[^\n]*?-m\s+(?:"([^"]{1,200})|'([^']{1,200}))/);
        const type = /\bgit\s+commit\b/.test(c) ? 'commit' : /\bgit\s+push\b/.test(c) ? 'push' : /\bgh\s+pr\s+create\b/.test(c) ? 'pr' : null;
        if (type) change(type, (S) => S.append(`events/${new Date().toISOString().slice(0, 10)}/${me}.jsonl`, { t: now(), agent: me, type, data: { message: m ? E.line(m[1] || m[2], 200) : null } }), { lazy: true }).catch(() => {});
      }
      const t = inboxText(me); return t ? { context: t } : {};
    }
    if (kind === 'prompt') { const t = inboxText(me); return t ? { context: t } : {}; }
    return {};
  }

  // ---------------- tools (MCP + CLI) ----------------
  const fmtConf = (c) => c.map((x) => `  ${x.path} overlaps ${x.claim} — @${x.agent} (${x.mode}${x.task ? ` #${x.task}` : ''}${x.reason ? `: ${E.line(x.reason, 120)}` : ''})`).join('\n');
  async function tool(name, args = {}, b = {}) {
    const top = topOf(b);
    if (name === 'hello') {
      const known = meOf({ ...b, agent: args.agent });
      const r = await change('join', (S) => { const a = E.join(S, { handle: known || undefined, name: args.name, human, git_email: gitEmail, host: label, branch: args.branch || b.branch }); return { id: a.id, text: E.briefing(S, L, a.id, { intro, project }) }; });
      local.byTop[norm(top)] = r.id; if (b.session_id) local.sessions[b.session_id] = r.id; saveLocal();
      return `${r.text}\n\n(You are @${r.id}.)`;
    }
    let me = meOf({ ...b, agent: args.agent });
    if (!me && shared(top)) throw new E.UserError('Several sessions share this folder, so I cannot tell which one you are. Pass agent:"<your handle>" — it is in your session briefing ("You are @…").');
    if (!me) { const r = await change('join', (S) => E.join(S, { human, git_email: gitEmail, host: label, branch: b.branch })); me = r.id; local.byTop[norm(top)] = me; saveLocal(); }
    const rel = (p) => toRel(top, path.isAbsolute(String(p)) ? p : String(p).startsWith('@') ? p : path.join(top, String(p))) || (E.isRootPath(p) ? E.relPath(top, p) : '');
    const relKeep = (p) => (E.isRootPath(String(p)) || hasWild(String(p)) ? E.relPath(top, String(p)) : rel(p));
    const hasWild = (p) => /[*?]/.test(p);
    const withInbox = (out, shared = true) => { const body = shared ? E.boardBlock(out, 10_000) : out; const un = inbox(me, { important: false, limit: 10 }); return un.length ? `${body}\n\n${E.boardBlock(`📨 New messages:\n${un.map(E.fmtMsg).join('\n')}`, 4000)}` : body; };
    switch (name) {
      case 'set_name': { const n = await setName(args.name); return withInbox(`You now appear on the board as "${safe(n, 60)}" (this repo, this machine).`, false); }
      case 'status': change('status', (S) => E.setStatus(S, me, { doing: args.doing, task: args.task_id, branch: args.branch }), { lazy: true }).catch(() => {}); return withInbox(`ok — @${me}: ${E.line(args.doing, 200)}`, false);
      case 'board': {
        const all = cache.tasks; const sec = (h, l) => `${h} (${l.length}):\n${l.map(E.fmtTask).join('\n') || '  (none)'}`;
        const rd = all.filter((t) => t.status === 'open' && !(t.depends_on || []).some((d) => all.find((x) => x.id === d)?.status !== 'done'));
        const active = all.filter((t) => ['taken', 'blocked', 'review'].includes(t.status)); const mineT = all.filter((t) => t.owner === me && !['done', 'dropped'].includes(t.status));
        return withInbox(args.filter === 'ready' ? sec('Ready', rd) : args.filter === 'mine' ? sec('Mine', mineT) : args.filter === 'active' ? sec('In progress', active) : args.filter === 'all' ? sec('All', all.slice(0, 200)) : [sec('Mine', mineT), sec('In progress', active), sec('Ready', rd)].join('\n'));
      }
      case 'plan': { const ts = await change('plan', (S) => E.plan(S, me, (args.tasks || []).map((t) => ({ ...t, area: (t.area || []).map(relKeep) })), top)); return withInbox(`Created ${ts.length} task(s):\n${ts.map(E.fmtTask).join('\n')}\nTake one with take(task_id).`); }
      case 'take': {
        const r = await change(`take #${Number(args.task_id)}`, (S) => E.take(S, me, args.task_id, { force: !!args.force }));
        if (!r.ok) return withInbox(`NOT taken: ${r.why}${r.conflicts ? '\n' + fmtConf(r.conflicts) : ''}`);
        return withInbox(`Taken:\n${E.fmtTask(r.task)}${r.task.body ? '\n  ' + r.task.body : ''}${r.task.accept ? '\n  Acceptance: ' + r.task.accept : ''}${r.pending_deps.length ? `\nWARNING: dependencies not done yet: ${r.pending_deps.map((d) => '#' + d).join(', ')}` : ''}${r.conflicts.length ? `\nSoft overlaps:\n${fmtConf(r.conflicts)}` : ''}`);
      }
      case 'update_task': { const t = await change(`task #${Number(args.task_id)}`, (S) => E.updateTask(S, me, args.task_id, { ...args, area: Array.isArray(args.area) ? args.area.map(relKeep) : undefined }, top)); return withInbox(`Updated:\n${E.fmtTask(t)}`); }
      case 'done': {
        const t = await change(`done #${Number(args.task_id)}`, (S) => { const x = E.updateTask(S, me, args.task_id, { status: 'done', note: args.summary }, top); E.post(S, me, { kind: 'log', task: x.id, body: `Done #${x.id} "${x.title}": ${args.summary}` }); return x; });
        const next = cache.tasks.filter((x) => x.status === 'open').slice(0, 5);
        return withInbox(`Done #${t.id}. Claims released.\nOpen next:\n${next.map(E.fmtTask).join('\n') || '  (none)'}`);
      }
      case 'check': { const c = conflictsNow(me, (args.paths || []).map(relKeep).filter(Boolean)); return withInbox(c.length ? `Overlaps:\n${fmtConf(c)}` : 'Clear — nobody else holds these paths.'); }
      case 'claim': {
        const r = await change('claim', (S) => E.claim(S, me, (args.paths || []).map(relKeep).filter(Boolean), { mode: 'hard', task: args.task_id, reason: args.reason, force: !!args.force }));
        return withInbox(r.ok ? `Claimed: ${r.claimed.join(', ')}${r.conflicts.length ? `\nNote overlaps:\n${fmtConf(r.conflicts)}` : ''}` : `NOT claimed — held by others:\n${fmtConf(r.conflicts)}\nMessage the holder (post to:"@handle") or pick other work.`);
      }
      case 'release': return withInbox(`Released ${await change('release', (S) => E.release(S, me, { paths: (args.paths || []).map(relKeep), task: args.task_id, all: !!args.all }))} claim(s).`, false);
      case 'post': { const m = await change('message', (S) => E.post(S, me, { body: args.body, to: args.to, kind: args.kind, task: args.task_id, reply_to: args.reply_to, file: args.file ? relKeep(args.file) : null }, top)); return withInbox(`Posted msg ${m.id}.`, false); }
      case 'inbox': { const un = inbox(me, { important: false, limit: 30 }); const recent = cache.messages.slice(-Math.min(50, args.recent || 10)); return E.boardBlock(`Unread (${un.length}):\n${un.map(E.fmtMsg).join('\n') || '  (none)'}\nRecent channel:\n${recent.map(E.fmtMsg).join('\n') || '  (quiet)'}`, 10_000); }
      case 'file': {
        const r = relKeep(args.path); const f = E.fileInfo(E.store(L), r);
        const Ln = [`${r} — ${f.edits} edit(s)${f.agents.length ? ` by ${f.agents.map((x) => '@' + x).join(', ')}` : ''}${f.created_by ? `; created by @${f.created_by}` : ''}`];
        if (f.claims.length) Ln.push('Claims:', ...f.claims.map((c) => `  ${c.path} — @${c.agent} ${c.mode}${c.task ? ` #${c.task}` : ''}`));
        if (f.tasks.length) Ln.push('Open tasks covering it:', ...f.tasks.map((t) => `  #${t.id} ${t.title} (${t.status}${t.owner ? ` @${t.owner}` : ''})`));
        Ln.push(`Thread (${f.thread.length}):`, ...(f.thread.length ? f.thread.map(E.fmtMsg) : [`  (no notes yet — add one with post file:"${r}")`]));
        return withInbox(Ln.join('\n'));
      }
      case 'contract': { const c = await change('contract', (S) => E.contract(S, me, args)); return withInbox(`Contract "${safe(c.name, 120)}" ${safe(c.status, 20)} v${Number(c.version) || 1}.`, true); }
      case 'contracts': { const cs = cache.contracts; if (args.name) { const c = cs.find((x) => x.name === args.name); return withInbox(c ? `"${c.name}" (${c.kind}) ${c.status} v${c.version} owner @${c.owner}\nconsumers: ${(c.consumers || []).join(', ') || '-'}\n---\n${c.spec || '(no spec yet)'}` : 'not found'); } return withInbox(cs.map((c) => `  "${c.name}" ${c.kind} — ${c.status} v${c.version}, owner @${c.owner}`).join('\n') || '(no contracts yet)'); }
      case 'who': return withInbox(cache.agents.filter(E.isLive).map((a) => `  @${a.id}${a.human ? ` (${E.line(a.human, 40)})` : ''} [${a.branch || '?'}] ${E.line(a.doing, 160) || (a.last_file ? 'editing ' + a.last_file : '—')} · ${Math.round((now() - a.last_seen) / 1000)}s ago`).join('\n') || '(nobody live)');
      case 'rundown': {
        const rd = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
        const readme = ['README.md', 'readme.md', 'Readme.md'].map((f) => rd(path.join(top, f))).find(Boolean) || '';
        const about = E.text(readme.slice(0, 20_000).replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/).filter((l) => !l.includes('![')).join('\n').split(/\r?\n/).filter((l) => l.trim() && !/^\s*(\[!\[|<)/.test(l)).slice(0, 12).join('\n'), 1200);
        const rules = E.text(rd(path.join(top, '.switchboard', 'INTRO.md')).replace(/<!--[\s\S]*?-->/g, '').trim(), 1500);
        const all = cache.tasks; const live = cache.agents.filter((a) => E.isLive(a) && !['human', 'watcher'].includes(a.kind));
        const inProg = all.filter((t) => ['taken', 'blocked', 'review'].includes(t.status));
        const free = all.filter((t) => t.status === 'open' && !(t.depends_on || []).some((d) => all.find((x) => x.id === d)?.status !== 'done'));
        const waiting = all.filter((t) => t.status === 'open' && !free.includes(t));
        const done = all.filter((t) => t.status === 'done').sort((a, b) => (b.done_at || 0) - (a.done_at || 0)).slice(0, 6);
        const decisions = cache.messages.filter((m) => m.kind === 'decision').slice(-6);
        const questions = cache.messages.filter((m) => m.kind === 'question' && !cache.messages.some((x) => x.reply_to === m.id)).slice(-5);
        const hard = cache.claims.filter((c) => c.mode === 'hard'); const hot = cache.files.filter((f) => f.last_at > now() - 24 * 3600_000).slice(0, 8);
        const bl = buildlist(); const roots = Object.entries(proj.roots || {}); const mapped = rootsMap();
        const gb = (n) => (n >= 1e9 ? (n / 1e9).toFixed(1) + ' GB' : (n / 1e6).toFixed(1) + ' MB');
        const Ln = [`# ${project} — where things stand`, '', '## What this project is', about || '(no README yet)', ''];
        if (rules) Ln.push('## Project rules', rules, '');
        Ln.push(`## Who is working right now (${live.length})`, ...(live.length ? live.map((a) => `- @${a.id}${a.human ? ` (${E.line(a.human, 40)})` : ''}${a.branch ? ` on ${E.line(a.branch, 60)}` : ''}: ${E.line(a.doing, 160) || (a.last_file ? 'editing ' + a.last_file : 'no task set')}`) : ['- nobody else']), '');
        Ln.push('## What is being worked on, by area', WS.streamsText(WS.workstreams(cache, proj), me), '');
        Ln.push(`## In progress — do not duplicate (${inProg.length})`, ...(inProg.length ? inProg.slice(0, 25).map(E.fmtTask) : ['  (nothing)']), '');
        Ln.push(`## Free to take now (${free.length})`, ...(free.length ? free.slice(0, 15).map(E.fmtTask) : ['  (nothing planned — propose work with plan)']), '');
        if (waiting.length) Ln.push(`## Waiting on other tasks (${waiting.length})`, ...waiting.slice(0, 10).map(E.fmtTask), '');
        if (hard.length) Ln.push('## Reserved paths', ...hard.slice(0, 25).map((c) => `  ${c.path} — @${c.agent}${c.task ? ` #${c.task}` : ''}`), '');
        if (hot.length) Ln.push('## Files changed in the last day', ...hot.map((f) => `  ${f.path} — ${f.agents.map((x) => '@' + x).join(', ')}`), '');
        if (roots.length || bl.totals.files) Ln.push('## Large files outside git', ...roots.map(([k, v]) => `  @${k}/ — ${E.line(v, 120)}${mapped[k] ? '' : '  (not on this machine: you can still plan and claim by name)'}`), `  ${bl.totals.files} files · ${gb(bl.totals.bytes)} tracked; ${bl.deliverables.filter((d) => d.state !== 'done').length} planned outputs open (see buildlist)`, '');
        if (decisions.length) Ln.push('## Recent decisions', ...decisions.map(E.fmtMsg), '');
        if (questions.length) Ln.push('## Open questions', ...questions.map(E.fmtMsg), '');
        if (cache.contracts.length) Ln.push('## Integration contracts', ...cache.contracts.filter((c) => c.status !== 'retired').slice(0, 12).map((c) => `  "${E.line(c.name, 100)}" — ${E.line(c.status, 20)} v${c.version}, owner @${E.line(c.owner, 40)}`), '');
        if (done.length) Ln.push('## Recently finished', ...done.map((t) => `  #${t.id} ${E.line(t.title, 120)}${t.note ? ` — ${E.line(t.note, 140)}` : ''}`), '');
        const howTo = ['## How to start without overlapping', `You are @${me}.`, '1. Pick something under "Free to take now" and take it — or plan a new task with the paths it will touch, then take it.', '2. Before editing, check the file (file <path>) and leave a one-line note on it saying what you are changing.', "3. Stay out of reserved paths and other people's in-progress tasks; message the owner (post to:\"@handle\") if you need something there.", '4. Record interfaces others depend on with contract. Finish with done and a one-line summary.'].join('\n');
        return `${E.boardBlock(Ln.join('\n'), 14_000)}\n\n${howTo}`;
      }
      case 'workstreams': return withInbox(WS.streamsText(WS.workstreams(cache, proj), me));
      case 'buildlist': return withInbox(AS.markdown(buildlist(), project).split('\n').slice(0, 120).join('\n'));
      default: throw new E.UserError(`unknown tool ${name}`);
    }
  }

  // ---------------- watcher for files outside git ----------------
  const watchers = new Map(); const pendingFs = new Map(); let fsTimer = null;
  function flushFs() {
    fsTimer = null; const batch = [...pendingFs.values()]; pendingFs.clear();
    const changes = batch.map(({ root, rel, abs }) => { try { const st = fs.statSync(abs); return st.isFile() ? { root, rel, op: 'change', size: st.size, mtime: st.mtimeMs } : null; } catch { return { root, rel, op: 'delete' }; } }).filter(Boolean);
    if (!changes.length) return;
    change('files', (S) => { const r = AS.apply(S, label, changes); if (r.add + r.change + r.delete) S.append(`events/${new Date().toISOString().slice(0, 10)}/files-${label}.jsonl`, { t: now(), agent: `files-${label}`, type: 'files.changed', data: r }); return r; }, { lazy: true }).catch(() => {});
  }
  function watchRoots() {
    for (const [n, w] of watchers) if (!rootsMap()[n]) { w.close(); watchers.delete(n); }
    for (const [name, dir] of Object.entries(rootsMap())) {
      if (watchers.has(name) || !AS.okRoot(name) || !fs.existsSync(dir)) continue;
      try {
        watchers.set(name, fs.watch(dir, { recursive: true }, (_e, file) => {
          if (!file) return; const rel = String(file).replace(/\\/g, '/');
          if (AS.SKIP_FILE.test(rel) || rel.split('/').some((s) => s.startsWith('.') || s === 'node_modules')) return;
          pendingFs.set(`${name}/${rel}`, { root: name, rel, abs: path.join(dir, rel) });
          if (!fsTimer) fsTimer = setTimeout(flushFs, 2500);
        }));
        log(`watching @${name} -> ${dir}`);
      } catch (e) { log(`cannot watch @${name}: ${e.message}`); }
    }
  }
  // Roots from the dashboard: declared (project.json, shared) + connected (this machine only, never pushed).
  const scanning = new Set();
  const rootsInfo = () => {
    const declared = proj.roots && typeof proj.roots === 'object' ? proj.roots : {}; const mapped = rootsMap();
    return [...new Set([...Object.keys(declared), ...Object.keys(mapped)])].filter(AS.okRoot).sort().map((name) => ({ name, about: E.line(declared[name], 160) || null, declared: name in declared, folder: mapped[name] || null, exists: !!mapped[name] && fs.existsSync(mapped[name]), scanning: scanning.has(name) }));
  };
  function checkRootFolder(dir) {
    const abs = path.resolve(String(dir || '').trim().replace(/^"(.*)"$/, '$1'));
    let st; try { st = fs.statSync(abs); } catch { throw new E.UserError(`Folder not found: ${abs}`); }
    if (!st.isDirectory()) throw new E.UserError(`Not a folder: ${abs}`);
    if (path.dirname(abs) === abs) throw new E.UserError('Pick a folder, not a whole drive.');
    const rel = path.relative(L.top, abs); if (!rel || (!rel.startsWith('..') && !path.isAbsolute(rel))) throw new E.UserError('That folder is inside the repository: files in git are tracked already. Pick the folder that holds the large files.');
    return abs;
  }
  function connectRoot(name, dir) {
    if (!AS.okRoot(name)) throw new E.UserError('A root name is lower-case letters, digits, dots, dashes or underscores (e.g. assets).');
    const abs = checkRootFolder(dir);
    if (Object.keys(rootsMap()).length >= 20 && !rootsMap()[name]) throw new E.UserError('At most 20 roots per machine.');
    local.roots = { ...rootsMap(), [name]: abs }; saveLocal(); watchRoots();
    scanInBackground(name);
    return rootsInfo();
  }
  function scanInBackground(name) {
    if (scanning.has(name)) return; scanning.add(name); emit('roots', {});
    setTimeout(() => { scanRoot(name).then((r) => log(`scanned @${name}: ${r?.files ?? '?'} files`), (e) => log(`scan @${name} failed: ${e.message}`)).finally(() => { scanning.delete(name); emit('roots', {}); }); }, 50);
  }
  /** The operating system's own folder picker, on this machine (the dashboard is local). Resolves to a path or ''. */
  function pickFolder(name) {
    const title = `Choose the folder for @${AS.okRoot(name) ? name : 'files'} (only names, sizes and times are shared)`;
    const run = (cmd, args) => new Promise((resolve) => execFile(cmd, args, { encoding: 'utf8', timeout: 10 * 60_000, windowsHide: true }, (err, out) => resolve(err ? '' : String(out).trim())));
    if (process.platform === 'win32') return run('powershell.exe', ['-NoProfile', '-STA', '-Command', `Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false }; $d = New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description = '${title.replace(/'/g, "''")}'; $d.UseDescriptionForTitle = $true; if ($d.ShowDialog($f) -eq 'OK') { [Console]::Out.Write($d.SelectedPath) }`]);
    if (process.platform === 'darwin') return run('osascript', ['-e', `POSIX path of (choose folder with prompt "${title.replace(/"/g, '')}")`]);
    return run('zenity', ['--file-selection', '--directory', `--title=${title}`]);
  }
  async function scanRoot(name) {
    const dir = rootsMap()[name]; if (!dir) throw new E.UserError(`@${name} is not mapped on this machine`);
    const rels = AS.walk(dir); const files = [];
    for (const r of rels) { try { const st = fs.statSync(path.join(dir, r)); files.push({ rel: r, size: st.size, mtime: st.mtimeMs }); } catch { /* vanished */ } }
    return change(`scan @${name}`, (S) => AS.replaceRoot(S, label, name, files));
  }

  // ---------------- dashboard API (same shapes the web UI already uses) ----------------
  const uiMsg = (m) => ({ id: m.id, project, sender: m.sender, recipient: m.to, kind: m.kind, body: m.body, task_id: m.task, reply_to: m.reply_to, file: m.file, created_at: m.at, resolved: m.kind === 'question' && cache.messages.some((x) => x.reply_to === m.id) ? 1 : 0 });
  const uiEvent = (e) => ({ id: `${e.t}-${e.agent}-${e.type}`, project, agent: e.agent, type: e.type, data: e.data || {}, created_at: e.t });
  function uiState() {
    const tracked = Number(E.git(L.top, ['ls-files'], { quiet: true })?.split('\n').filter(Boolean).length || 0);
    return {
      project, now: now(), cfg: { idleMs: 3 * 60_000, offlineMs: E.CFG.liveMs }, mode: 'github',
      projects: [{ id: project, name: project, main_repo: mainRepo, live: cache.agents.filter(E.isLive).length, open_tasks: cache.tasks.filter((t) => !['done', 'dropped'].includes(t.status)).length }],
      agents: cache.agents.filter((a) => a.kind !== 'human').map((a) => ({ id: a.id, project, human: a.human, host: a.host, branch: a.branch, doing: a.doing, task_id: a.task || null, status: E.isLive(a) ? 'active' : 'offline', last_seen: a.last_seen, joined_at: a.joined_at, edits: a.edits || 0, last_file: a.last_file, kind: a.kind === 'agent' ? 'claude' : a.kind })),
      tasks: cache.tasks.map((t) => ({ ...t, project })),
      claims: [...cache.claims.map((c) => ({ agent: c.agent, path: c.path, mode: c.mode, task_id: c.task || null, reason: c.reason, created_at: c.at, project })), ...[...softOverlay].flatMap(([ag, m]) => [...m].map(([p, at]) => ({ agent: ag, path: p, mode: 'soft', task_id: null, created_at: at, project })))],
      messages: cache.messages.slice(-200).map(uiMsg), contracts: cache.contracts.map((c) => ({ ...c, project })),
      events: cache.events.slice(-200).map(uiEvent), files: cache.files, baseline: { n: tracked, at: null },
      protocol: { source: 'repo:.switchboard', sha: crypto.createHash('sha256').update(intro).digest('hex').slice(0, 12), updated_at: null, error: offline ? 'offline — showing the last synced board' : null, project: null },
      project_info: { id: project, name: project, remote: null, main_repo: mainRepo, main_ref: null, issues_sync: 1 },
      workstreams: WS.workstreams(cache, proj),
      sync: { head: cache.head.slice(0, 10), at: cache.at, offline, pending: queue.length, remote },
    };
  }
  async function humanOp(fn, labelText) {
    return change(labelText, (S) => { if (!S.read(`agents/${humanSlug}.json`)) { S.write(`agents/${humanSlug}.json`, { id: humanSlug, kind: 'human', human, owner_key: ownerKey, host: label, status: 'offline', joined_at: now(), last_seen: 0, edits: 0 }); } return fn(S); });
  }
  const slugOf = (n) => `h-${(n || 'dev').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'dev'}`;
  let humanSlug = slugOf(human);
  // The name this person appears under. Saved per repo (git config switchboard.name, never pushed as config);
  // agents of this machine that are on the board are renamed right away.
  const NAME_OK = /^[\p{L}\p{N}][\p{L}\p{N} ._'-]{0,39}$/u;
  const customName = () => !!E.git(L.top, ['config', '--get', 'switchboard.name'], { quiet: true });
  async function setName(raw) {
    const v = String(raw ?? '').trim().replace(/\s+/g, ' ');
    if (v && !NAME_OK.test(v)) throw new E.UserError('A name is 1-40 letters, numbers, spaces, dots, dashes or apostrophes (no @, no email addresses).');
    if (process.env.SWITCHBOARD_HUMAN) throw new E.UserError('SWITCHBOARD_HUMAN is set for this companion and wins over a saved name: unset it, then restart (stop, start).');
    if (v) E.git(L.top, ['config', '--local', '--replace-all', 'switchboard.name', v]); else E.git(L.top, ['config', '--local', '--unset-all', 'switchboard.name'], { quiet: true });
    human = E.displayName(L.top); humanSlug = slugOf(human);
    E.git(L.state, ['config', '--replace-all', 'user.name', human], { quiet: true });
    const mine = [...new Set([...Object.values(local.byTop || {}), ...Object.values(local.sessions || {})])].filter((h) => E.okHandle(h));
    await change('name', (S) => { for (const id of mine) { const a = S.read(`agents/${id}.json`); if (a && a.human !== human) S.write(`agents/${id}.json`, { ...a, human }); } return true; });
    log('name set to', human);
    return human;
  }
  const meInfo = () => ({ email: gitEmail || 'local', name: human, custom_name: customName(), role: 'member', auth: 'local', sso: false, base: '/', public_url: null, mode: 'github' });

  // ---------------- HTTP (loopback only) ----------------
  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8' };
  const SEC = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'" };
  const send = (res, status, body, h = {}) => { const obj = typeof body === 'object' && !Buffer.isBuffer(body); res.writeHead(status, { ...SEC, ...(obj ? { 'Content-Type': 'application/json; charset=utf-8' } : {}), ...h }); res.end(obj ? JSON.stringify(body) : body); };
  const readJson = (req) => new Promise((resolve, reject) => { let n = 0; const ch = []; req.on('data', (c) => { n += c.length; if (n > 1024 * 1024) { reject(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); } else ch.push(c); }); req.on('end', () => { try { resolve(ch.length ? JSON.parse(Buffer.concat(ch).toString('utf8')) : {}); } catch { reject(Object.assign(new Error('invalid JSON'), { status: 400 })); } }); req.on('error', reject); });
  const eq = (a, b) => { const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || '')); return x.length === y.length && crypto.timingSafeEqual(x, y); };
  const seenNonces = new Map();
  let COOKIE = 'sb_ui'; // per-port name, set once the port is known: other local servers' cookies never collide
  const cookie = (req) => (String(req.headers.cookie || '').split(/;\s*/).map((c) => c.split('=')).find((c) => c[0] === COOKIE) || [])[1];
  const readRaw = (req) => new Promise((resolve, reject) => { let n = 0; const ch = []; req.on('data', (c) => { n += c.length; if (n > 2 * 1024 * 1024) { reject(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); } else ch.push(c); }); req.on('end', () => resolve(Buffer.concat(ch))); req.on('error', reject); });
  const parse = (buf) => { try { const v = buf.length ? JSON.parse(buf.toString('utf8')) : {}; return v && typeof v === 'object' ? v : {}; } catch { throw Object.assign(new Error('invalid JSON'), { status: 400 }); } };
  const server = http.createServer(async (req, res) => {
    try {
      // DNS-rebinding guard: only literal loopback hosts are served
      const host = String(req.headers.host || '').replace(/:\d+$/, '');
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) return send(res, 403, { error: 'forbidden' });
      const u = new URL(req.url, 'http://x'); const p = u.pathname;
      // proves to a shim that it is talking to the real companion (which knows the secret) without revealing anything
      if (p === '/healthz') { const n = String(u.searchParams.get('n') || '').slice(0, 64); return send(res, 200, { ok: true, code: codeSig, ...(n ? { proof: hmac(`health.${n}`) } : {}) }); }
      if (p === '/open') { const t = String(u.searchParams.get('t') || ''); const exp = tickets.get(t); tickets.delete(t); if (!exp || exp < now()) return send(res, 403, 'This link has expired. Run: node .switchboard/switchboard.mjs ui', { 'Content-Type': 'text/plain; charset=utf-8' }); return send(res, 302, '', { Location: '/', 'Set-Cookie': `${COOKIE}=${uiToken}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000` }); }
      let rawBody = null; let viaShim = false;
      if (p.startsWith('/rpc/')) {
        rawBody = await readRaw(req);
        const ts = Number(req.headers['x-sb-ts']); const nonce = String(req.headers['x-sb-nonce'] || '');
        viaShim = Math.abs(now() - ts) < 60_000 && /^[\w-]{16,64}$/.test(nonce) && !seenNonces.has(nonce) && eq(req.headers['x-sb-sig'], hmac(`${ts}.${nonce}.${p}.${crypto.createHash('sha256').update(rawBody).digest('hex')}`));
        if (!viaShim) return send(res, 401, { error: 'unauthorized' });
        seenNonces.set(nonce, now()); if (seenNonces.size > 5000) for (const [k, t0] of seenNonces) if (t0 < now() - 120_000) seenNonces.delete(k);
        res.setHeader('x-sb-proof', hmac(`proof.${nonce}`));
      }
      const viaUi = eq(cookie(req), uiToken);
      if (p.startsWith('/api/') || p.startsWith('/rpc/')) {
        if (p === '/api/brand') return send(res, 200, { name: null, sso_label: null, sso: false });
        if (!viaShim && !viaUi) return send(res, 401, { error: 'open the dashboard with: node .switchboard/switchboard.mjs ui' });
        if (p.startsWith('/rpc/')) {
          const b = parse(rawBody);
          if (p === '/rpc/hook') return send(res, 200, await hook(String(b.kind), b));
          if (p === '/rpc/tool') { try { return send(res, 200, { text: await tool(String(b.name), b.args && typeof b.args === 'object' ? b.args : {}, b) }); } catch (e) { if (e instanceof E.UserError) return send(res, 200, { text: `Error: ${e.message}`, isError: true }); throw e; } }
          if (p === '/rpc/roots') { if (b.set && typeof b.set === 'object') { local.roots = Object.fromEntries(Object.entries(b.set).filter(([k, v]) => AS.okRoot(k) && typeof v === 'string').slice(0, 20)); saveLocal(); watchRoots(); } return send(res, 200, { roots: rootsMap() }); }
          if (p === '/rpc/scan') return send(res, 200, await scanRoot(String(b.root)));
          if (p === '/rpc/sync') { await new Promise((r) => { change('sync', () => true).then(r, r); }); return send(res, 200, uiState().sync); }
          if (p === '/rpc/prompt') return send(res, 200, { project, text: agentPrompt() });
          if (p === '/rpc/ticket') { const t = crypto.randomBytes(24).toString('base64url'); tickets.set(t, now() + 60_000); for (const [k, exp] of tickets) if (exp < now()) tickets.delete(k); return send(res, 200, { ticket: t, port: server.address().port }); }
          if (p === '/rpc/stop') { await Promise.race([queue.length ? change('flush', () => true).catch(() => {}) : Promise.resolve(), new Promise((r) => setTimeout(r, 6000))]); send(res, 200, { ok: true }); setTimeout(stop, 50); return; }
          if (p === '/rpc/name') { try { if (b.reset || b.name !== undefined) await setName(b.reset ? '' : String(b.name)); } catch (e) { if (e instanceof E.UserError) return send(res, 200, { error: e.message }); throw e; } return send(res, 200, { name: human, custom: customName() }); }
          if (p === '/rpc/ignore') { const h = String(b.handle || '').replace(/^@/, ''); local.ignore = (local.ignore || []).filter((x) => x !== h); if (b.on && E.okHandle(h)) local.ignore.push(h); saveLocal(); return send(res, 200, { ignore: local.ignore }); }
          return send(res, 404, { error: 'not found' });
        }
        if (req.method !== 'GET' && !viaShim && req.headers['x-sb'] !== '1') return send(res, 403, { error: 'missing X-SB header' });
        if (p === '/api/me') return send(res, 200, meInfo());
        if (p === '/api/roots') return send(res, 200, { roots: rootsInfo() });
        if (req.method === 'POST' && p === '/api/roots/pick') { const b = await readJson(req); const dir = await pickFolder(String(b.name || '')); return send(res, 200, { folder: dir || null }); }
        if (req.method === 'POST' && p === '/api/roots/connect') { const b = await readJson(req); return send(res, 200, { roots: connectRoot(String(b.name || '').trim().replace(/^@/, '').toLowerCase(), b.folder) }); }
        if (req.method === 'POST' && p === '/api/roots/scan') { const b = await readJson(req); if (!rootsMap()[b.name]) throw new E.UserError('Connect a folder first.'); scanInBackground(String(b.name)); return send(res, 200, { roots: rootsInfo() }); }
        if (req.method === 'POST' && p === '/api/roots/disconnect') { const b = await readJson(req); const n = { ...rootsMap() }; delete n[b.name]; local.roots = n; saveLocal(); watchRoots(); return send(res, 200, { roots: rootsInfo() }); }
        if (req.method === 'POST' && p === '/api/me/name') { const b = await readJson(req); await setName(b.reset ? '' : b.name); return send(res, 200, meInfo()); }
        if (p === '/api/projects') return send(res, 200, uiState().projects);
        if (p === '/api/state') return send(res, 200, uiState());
        if (p === '/api/buildlist') { const bl = { project, ...buildlist() }; return u.searchParams.get('format') === 'md' ? send(res, 200, AS.markdown(bl, project), { 'Content-Type': 'text/markdown; charset=utf-8' }) : send(res, 200, bl); }
        if (p === '/api/file') { const f = E.fileInfo(E.store(L), E.norm(u.searchParams.get('path') || '')); return send(res, 200, { ...f, tracked: true, thread: f.thread.map(uiMsg) }); }
        if (p === '/api/prompt') return send(res, 200, { project, text: agentPrompt() });
        if (p === '/api/stream') { res.writeHead(200, { ...SEC, 'Content-Type': 'text/event-stream', Connection: 'keep-alive' }); res.write('retry: 3000\n\n'); streams.add(res); res.write(`event: hello\ndata: ${JSON.stringify({ project })}\n\n`); req.on('close', () => streams.delete(res)); return; }
        if (req.method === 'POST' && p === '/api/human/post') { const b = await readJson(req); return send(res, 200, uiMsg(await humanOp((S) => ({ ...E.post(S, humanSlug, { body: b.body, to: b.to, kind: b.kind, task: b.task_id, reply_to: b.reply_to, file: b.file }, L.top), sender: `human:${humanSlug.slice(2)}` }), 'message'))); }
        if (req.method === 'POST' && p === '/api/human/plan') { const b = await readJson(req); return send(res, 200, await humanOp((S) => E.plan(S, humanSlug, b.tasks, L.top), 'plan')); }
        if (req.method === 'POST' && p === '/api/human/task') { const b = await readJson(req); return send(res, 200, await humanOp((S) => E.updateTask(S, humanSlug, b.id, b, L.top), `task #${Number(b.id)}`)); }
        return send(res, 404, { error: 'not available in GitHub-only mode' });
      }
      const name = p === '/' ? 'index.html' : p.replace(/^\/+/, '');
      if (req.method !== 'GET' || !uiFiles.has(name)) return send(res, 404, { error: 'not found' });
      return send(res, 200, uiFiles.get(name), { 'Content-Type': MIME[path.extname(name)] || 'application/octet-stream' });
    } catch (e) { const status = e.status || (e instanceof E.UserError ? 400 : 500); if (status >= 500) log('error', e.message); if (!res.headersSent) send(res, status, { error: status >= 500 ? 'internal error' : e.message }); else res.end(); }
  });
  setInterval(() => { for (const r of streams) r.write(': ping\n\n'); }, 20_000).unref();
  function agentPrompt() {
    const rd = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
    const tpl = rd(path.join(HERE, '..', 'AGENT-PROMPT.md')); const own = rd(path.join(L.top, '.switchboard', 'INTRO.md')).trim();
    const fill = { project, main_repo: mainRepo || '(local only)', roots: Object.entries(proj.roots || {}).map(([k, v]) => `- \`@${k}/…\` — ${E.line(v, 160)}`).join('\n') || '- (none declared)', project_rules: own ? `## Project rules\n${E.text(own, 16_000)}` : '', intro: rd(path.join(HERE, '..', 'PROTOCOL.md')).trim(), contracts: cache.contracts.filter((c) => c.status !== 'retired').slice(0, 25).map((c) => `- "${E.line(c.name, 120)}" (${E.line(c.kind, 20)}) — ${E.line(c.status, 20)} v${c.version}, owner @${E.line(c.owner, 40)}`).join('\n') || '- none yet' };
    return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => String(fill[k] ?? '')).replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }

  // which code is this? the shims restart the companion when the kit files change (a pull, a branch switch)
  const codeSig = (() => { const h = crypto.createHash('sha256'); try { const ui = path.join(HERE, '..', 'ui'); const uiFiles = fs.existsSync(ui) ? fs.readdirSync(ui).filter((n) => /\.(js|css|html)$/.test(n)).sort().map((n) => path.join(ui, n)) : []; for (const f of [path.join(HERE, '..', 'switchboard.mjs'), ...fs.readdirSync(HERE).filter((n) => n.endsWith('.mjs')).sort().map((n) => path.join(HERE, n)), ...uiFiles]) { h.update(path.basename(f)); h.update(fs.readFileSync(f)); } } catch { /* ignore */ } return h.digest('hex').slice(0, 16); })();
  const stop = () => { for (const f of ['daemon.json', 'daemon.lock']) { try { fs.rmSync(path.join(L.base, f), { force: true }); } catch { /* ignore */ } } process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  try {
    if (remote) await gitA(L.state, ['fetch', '--quiet', 'origin', E.BRANCH], 15_000).then((r) => r !== null && gitA(L.state, ['reset', '--quiet', '--hard', `origin/${E.BRANCH}`]));
    rebuild();
  } catch (e) { log('could not read the board:', e.message); stop(); }
  lastEventT = now(); lastMsgAt = now();
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  COOKIE = `sb_ui_${server.address().port}`;
  const info = { port: server.address().port, secret, pid: process.pid, started: now(), project, code: codeSig };
  const infoFile = path.join(L.base, 'daemon.json');
  try { fs.rmSync(infoFile, { force: true }); } catch { /* new */ }
  fs.writeFileSync(infoFile, JSON.stringify(info), { mode: 0o600, flag: 'wx' });
  if (process.platform === 'win32') { try { const u = `${process.env.USERDOMAIN ? process.env.USERDOMAIN + '\\' : ''}${process.env.USERNAME}`; if (process.env.USERNAME) execFile('icacls', [infoFile, '/inheritance:r', '/grant:r', `${u}:F`], { windowsHide: true }, () => {}); } catch { /* best effort */ } }
  watchRoots();
  log(`Switchboard companion for "${project}" on http://127.0.0.1:${info.port}  (${remote ? 'syncing with origin/' + E.BRANCH : 'local only — nothing leaves this machine'})`);
  // exit quietly when idle for a long time (hooks start it again on demand)
  setInterval(() => { if (!streams.size && !watchers.size && !queue.length && !cache.agents.some((a) => E.isLive(a) && a.host === label) && now() - info.started > 30 * 60_000) stop(); }, 60_000).unref();
  return { info, stop: () => server.close(), cycle, state: uiState, tool, hook };
}
