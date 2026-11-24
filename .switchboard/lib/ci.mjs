// CI side (GitHub Actions, run from the default branch): security checks on the state branch, the
// tasks <-> Issues mirror, and the rendered board.   switchboard.mjs ci run --state <dir> --ci-state <file>
//
// Trust model: everyone with write access can push anything to the state branch, and can also run their own
// workflow with the Actions token — so nothing on that branch, and no commit author or "bot" identity, is
// trusted. What IS trusted:
//   * the code (this file runs from the default branch, behind review),
//   * GitHub's push log (who authenticated each push),
//   * the CI's private memory (--ci-state: last validated commit, handle owners, issue links), kept in the
//     Actions cache of the default branch, which workflows on other branches cannot write.
// Checks compare TREES (validated commit -> each push), so merges, renames and history shapes cannot hide a
// change. When something cannot be attributed or anchored the run reports and changes nothing (fails closed).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as E from './state.mjs';
import * as AS from './assets.mjs';
import * as WS from './streams.mjs';

export const BOT = 'github-actions[bot]';
const LIMITS = { json: 256 * 1024, jsonl: 2 * 1024 * 1024, tsv: 4 * 1024 * 1024, md: 512 * 1024, files: 1024 * 1024 };
const TOTAL = { files: 100_000, bytes: 500 * 1024 * 1024 };
const SECRETS = [/gh[pousr]_[A-Za-z0-9]{30,}/, /github_pat_[A-Za-z0-9_]{40,}/, /glpat-[A-Za-z0-9_-]{20,}/, /AKIA[0-9A-Z]{16}/, /\bsk-[A-Za-z0-9_-]{24,}/, /\bsk_live_[A-Za-z0-9]{20,}/, /\bnpm_[A-Za-z0-9]{36}/, /\bhf_[A-Za-z0-9]{30,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /xox[baprs]-[A-Za-z0-9-]{10,}/, /AIza[0-9A-Za-z_-]{35}/, /\beyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/];
const H = '[a-z0-9][a-z0-9-]{1,39}';

/** Which files may exist on the state branch, and (for per-agent records) whose they are. */
export function classify(p) {
  let m;
  if (typeof p !== 'string' || p.length > 400 || /[^\x20-\x7e]/.test(p)) return { ok: false };
  if (p === 'README.md' || p === 'BUILD-LIST.md' || p === 'board.svg') return { ok: true, generated: true };
  if ((m = p.match(new RegExp(`^(agents|claims|files)/(${H})\\.json$`))) && E.okHandle(m[2])) return { ok: true, owner: m[2], kind: m[1] };
  if ((m = p.match(new RegExp(`^events/\\d{4}-\\d\\d-\\d\\d/(${H})\\.jsonl$`))) && E.okHandle(m[1])) return { ok: true, owner: m[1], kind: 'events' };
  if (/^events\/\d{4}-\d\d-\d\d\/files-[a-z0-9-]{1,40}\.jsonl$/.test(p)) return { ok: true, kind: 'events' };
  if ((m = p.match(new RegExp(`^messages/\\d{4}-\\d\\d-\\d\\d/\\d{13}-(${H})-[a-f0-9]{4}\\.json$`))) && E.okHandle(m[1])) return { ok: true, owner: m[1], appendOnly: true, kind: 'message' };
  if (/^tasks\/[1-9]\d{0,6}\.json$/.test(p)) return { ok: true, kind: 'task' };
  if (/^contracts\/[a-z0-9-]{1,40}\.json$/.test(p)) return { ok: true, kind: 'contract' };
  if (/^assets\/[a-z0-9-]{1,40}\/[a-z0-9][a-z0-9._-]{0,39}\/[a-z0-9._-]{1,80}\.tsv$/.test(p)) return { ok: true, kind: 'assets' };
  return { ok: false };
}
const gitRaw = (dir, args) => { try { return execFileSync('git', args, { cwd: dir, maxBuffer: 64 * 1024 * 1024, timeout: 120_000, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }); } catch { return null; } };
const g = (dir, args) => { const b = gitRaw(dir, args); return b === null ? null : b.toString('utf8').trim(); };
const isCommit = (dir, x) => typeof x === 'string' && /^[0-9a-f]{40}$/.test(x) && g(dir, ['cat-file', '-t', x]) === 'commit';
const ancestor = (dir, a, b) => gitRaw(dir, ['merge-base', '--is-ancestor', a, b]) !== null;
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/** Tree-to-tree changes: [{st, path, mode, sha}] (new side). */
function changes(dir, from, to) {
  const out = gitRaw(dir, ['diff', '--raw', '-z', '--no-renames', '--no-abbrev', from || EMPTY_TREE, to]);
  if (out === null) return null;
  const parts = out.toString('utf8').split('\0'); const res = [];
  for (let i = 0; i + 1 < parts.length; i += 2) { const m = parts[i].match(/^:(\d{6}) (\d{6}) ([0-9a-f]{40}) ([0-9a-f]{40}) ([A-Z])/); if (m) res.push({ st: m[5], path: parts[i + 1], mode: m[2], sha: m[4] }); }
  return res;
}
const staticPart = (p) => { const n = E.norm(p); const i = n.search(/[*?[]/); return (i < 0 ? n : n.slice(0, i)).replace(/\/$/, ''); };
/** Content rules for one blob. Returns a reason string or null. */
function checkBlob(dir, p, c, sha) {
  const size = Number(g(dir, ['cat-file', '-s', sha])); const ext = p.split('.').pop();
  if (!Number.isFinite(size)) return 'unreadable';
  if (size > (c.kind === 'files' ? LIMITS.files : LIMITS[ext] || 64 * 1024)) return 'file too large';
  const buf = gitRaw(dir, ['cat-file', 'blob', sha]); if (buf === null) return 'unreadable';
  const txt = buf.toString('utf8');
  if (SECRETS.some((re) => re.test(txt))) return 'looks like a credential or private key';
  const soon = Date.now() + 24 * 3600_000; // tolerate wrong clocks; clients clamp anyway
  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
  if (ext === 'json') {
    let v; try { v = JSON.parse(txt); } catch { return 'not valid JSON'; }
    if (!isObj(v)) return 'must be a JSON object';
    if (c.kind === 'agents' && Number(v.last_seen) > soon) return 'timestamp in the future';
    if (c.kind === 'agents' && c.owner.startsWith('h-') !== (v.kind === 'human')) return 'handles starting with h- are for dashboard users only';
    if (c.kind === 'claims') {
      if (!Array.isArray(v.claims) || v.claims.length > 300) return 'claims must be a list (at most 300)';
      for (const x of v.claims) { if (!isObj(x) || typeof x.path !== 'string' || x.path.length > 300) return 'malformed claim'; if (Number(x.at) > soon) return 'timestamp in the future'; if (x.mode === 'hard' && (!staticPart(x.path) || /[*?[]/.test(E.norm(x.path).split('/')[0]))) return 'a reservation must name its top folder (no wildcards there)'; }
      if (v.claims.filter((x) => x.mode === 'hard').length > 60) return 'too many reservations (at most 60)';
    }
    if (c.kind === 'message' && (typeof v.body !== 'string' || v.body.length > 4000)) return 'malformed message';
    if (c.kind === 'task' && (typeof v.title !== 'string' || (v.area !== undefined && !Array.isArray(v.area)))) return 'malformed task';
    if (c.kind === 'files' && Object.keys(v).length > 2500) return 'too many entries';
  } else if (ext === 'jsonl') { for (const l of txt.split('\n')) { if (!l) continue; try { if (!isObj(JSON.parse(l))) return 'malformed event line'; } catch { return 'malformed event line'; } } }
  else if (ext === 'tsv') { for (const l of txt.split('\n')) { if (!l) continue; const f = l.split('\t'); if (f.length !== 3 || /(^|\/)\.\.(\/|$)/.test(f[0]) || f[0].startsWith('/') || !/^\d+$/.test(f[1]) || !/^\d+$/.test(f[2])) return 'malformed manifest line'; } }
  return null;
}

/** Pushes to the state branch, oldest first, with the AUTHENTICATED pusher. Walks pages until `until` is seen. */
export async function pushLog(repo, until, branch = E.BRANCH, maxPages = 30) {
  const out = []; let url = `/repos/${repo}/activity?ref=${encodeURIComponent('refs/heads/' + branch)}&per_page=100`;
  for (let page = 0; page < maxPages && url; page++) {
    const { data, next } = await ghPage(url);
    for (const a of data) { out.push({ actor: a.actor?.login || '?', before: a.before, after: a.after, forced: a.activity_type === 'force_push' }); if (until && a.after === until) return { pushes: out.reverse(), complete: true }; }
    url = next;
  }
  return { pushes: out.reverse(), complete: !until };
}

/** Validate everything between `base` (last validated commit, or null on the first run) and HEAD.
 *  pushes: oldest-first [{actor, before, after}], or null when no push log is available (local runs: ownership
 *  is then not checked). Returns { head, base, bad:[{path, by, why, repair}], owners, unattributed, proven, files } */
export function validate(dir, { base = null, pushes = null, owners = {} } = {}) {
  const head = g(dir, ['rev-parse', 'HEAD']);
  const start = isCommit(dir, base) ? base : null; // tree-to-tree: works even if history was rewritten
  const linear = !!start && ancestor(dir, start, head);
  owners = { ...owners, github: BOT };
  const bad = []; let unattributed = false;
  const steps = [];
  if (pushes) {
    // Without a trusted anchor, start where the push log starts: history before it cannot be attributed to anyone,
    // so nobody is registered as an owner from it and ownership findings are reported, never repaired.
    let prev = start || (isCommit(dir, pushes[0]?.before) && ancestor(dir, pushes[0].before, head) ? pushes[0].before : null);
    if (start && !linear) { // history was rewritten: everything since the anchor is on whoever pushed last
      steps.push({ from: start, to: head, actor: pushes.length ? pushes[pushes.length - 1].actor : null }); prev = head;
      bad.push({ path: '(branch)', by: pushes.length ? `@${pushes[pushes.length - 1].actor}` : 'unknown', why: 'the state branch was force-pushed (add a ruleset that blocks force pushes)', repair: false, synthetic: true });
    }
    for (const p of start && !linear ? [] : pushes) { if (!isCommit(dir, p.after) || !ancestor(dir, p.after, head) || p.after === prev || (prev && !ancestor(dir, prev, p.after))) continue; steps.push({ from: prev, to: p.after, actor: p.actor }); prev = p.after; }
    if (prev !== head) steps.push({ from: prev, to: head, actor: null });
  } else steps.push({ from: start, to: head, actor: undefined });
  for (const s of steps) {
    const ch = changes(dir, s.from, s.to); if (ch === null) { bad.push({ path: '(history)', by: s.actor || '?', why: 'could not compare trees', repair: false, synthetic: true }); continue; }
    for (const { st, path: p, mode, sha } of ch) {
      const c = classify(p); const by = s.actor ? `@${s.actor}` : s.actor === null ? 'unknown pusher' : 'local';
      const flag = (why, fix = true) => bad.push({ path: p, by, why, repair: fix });
      if (!c.ok) { flag('path is not part of the Switchboard state layout'); continue; }
      if (c.generated) continue; // regenerated on every run anyway
      if (c.owner && s.actor !== undefined) {
        if (s.actor === null) { unattributed = true; flag('could not determine who pushed this change', false); continue; }
        if (!owners[c.owner]) { if (!start) continue; // no trusted starting point: nobody gains or loses ownership from old history
          if (c.owner.startsWith('h-') && Object.entries(owners).some(([h, who]) => h.startsWith('h-') && who === s.actor)) { flag('one dashboard identity per person'); continue; }
          owners[c.owner] = s.actor; } // the first pusher of a handle owns it
        else if (owners[c.owner] !== s.actor) { flag(`@${c.owner}'s record ${st === 'D' ? 'deleted' : 'changed'} by @${s.actor} (it belongs to @${owners[c.owner]})`, !!start); continue; }
      }
      if (st === 'D') { if (c.appendOnly) flag('messages cannot be deleted'); continue; }
      if (c.appendOnly && st !== 'A') { flag('messages cannot be rewritten'); continue; }
      if (mode !== '100644') { flag('not a regular file (links and executables are not allowed)'); continue; }
      const why = checkBlob(dir, p, c, sha); if (why) flag(why);
    }
  }
  // whole-tree rules that do not depend on history
  const ls = gitRaw(dir, ['ls-tree', '-r', '-z', '--long', head]); let files = 0, bytes = 0;
  if (ls) for (const e of ls.toString('utf8').split('\0')) {
    const m = e.match(/^(\d{6}) (\w+) ([0-9a-f]{40})\s+(\S+)\t([\s\S]*)$/); if (!m) continue;
    files++; bytes += Number(m[4]) || 0; if (bad.some((b) => b.path === m[5])) continue;
    const c = classify(m[5]);
    if (!c.ok) bad.push({ path: m[5], by: 'unknown', why: 'path is not part of the Switchboard state layout', repair: true });
    else if (m[1] !== '100644') bad.push({ path: m[5], by: 'unknown', why: 'not a regular file (links and executables are not allowed)', repair: true });
    else if (!start && !c.generated) { const why = checkBlob(dir, m[5], c, m[3]); if (why) bad.push({ path: m[5], by: 'unknown', why, repair: true }); }
  }
  if (files > TOTAL.files || bytes > TOTAL.bytes) bad.push({ path: '(branch)', by: '-', why: `the state branch is too large (${files} files, ${Math.round(bytes / 1e6)} MB)`, repair: false, synthetic: true });
  return { head, base: start, bad, owners, unattributed, proven: !!pushes, files, rewritten: !!start && !linear };
}
/** Put violating paths back to their last validated content (or remove them). Refuses to act when it would touch
 *  a large part of the branch — that means the anchor is wrong, not that everyone misbehaved. */
export function repair(dir, v) {
  const paths = [...new Set(v.bad.filter((b) => b.repair && !b.synthetic).map((b) => b.path))];
  if (!paths.length) return { restored: [], refused: false };
  if (!v.base && paths.length > Math.max(50, Math.floor((v.files || 0) * 0.3))) return { restored: [], refused: true };
  for (const p of paths) {
    const existed = v.base && gitRaw(dir, ['cat-file', '-e', `${v.base}:${p}`]) !== null && classify(p).ok;
    if (existed) gitRaw(dir, ['checkout', v.base, '--', p]);
    else { gitRaw(dir, ['rm', '-q', '-f', '--cached', '--', p]); try { const abs = path.join(dir, p); if (path.resolve(abs).startsWith(path.resolve(dir) + path.sep)) { const st = fs.lstatSync(abs); if (st.isDirectory()) fs.rmSync(abs, { recursive: true, force: true }); else fs.unlinkSync(abs); } } catch { /* already gone */ } }
  }
  return { restored: paths, refused: false };
}

// ---------------- board rendering ----------------
const ZW = String.fromCharCode(0x200b);
const when = (t) => (t ? new Date(t).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '-');
const cell = (s) => (E.line(String(s ?? ''), 140) || '').replace(/\|/g, '\\|').replace(/</g, '&lt;').replace(/`/g, "'").replace(/@/g, '@' + ZW);
/** The board as the companion sees it (agents, tasks, claims, recently edited files), for grouping. */
export function boardCache(S, now = Date.now()) {
  const files = new Map();
  for (const fn of S.list('files').slice(0, 2000)) {
    const h = fn.endsWith('.json') ? fn.slice(0, -5) : ''; if (!E.okHandle(h)) continue;
    for (const [rawP, x] of Object.entries(S.read(`files/${fn}`, {})).slice(0, 2000)) {
      if (!x || typeof x !== 'object') continue; const p = E.norm(E.line(rawP, E.CFG.maxPath)); if (!p) continue;
      const f = files.get(p) || { path: p, edits: 0, last_agent: null, last_at: 0 };
      const at = Math.min(Number(x.at) || 0, now); f.edits += Number(x.n) || 0; if (at > f.last_at) { f.last_at = at; f.last_agent = h; } files.set(p, f);
    }
  }
  return { agents: E.agents(S), tasks: E.tasks(S), claims: E.claims(S), files: [...files.values()] };
}
export function boardMarkdown(S, project, proj = {}) {
  const ag = E.agents(S).filter((a) => a.kind !== 'human'); const ts = E.tasks(S); const cl = E.claims(S).filter((c) => c.mode === 'hard');
  const live = ag.filter(E.isLive);
  const col = (st) => ts.filter((t) => t.status === st);
  const L = [`# Switchboard - ${cell(project)}`, '', `_Generated ${when(Date.now())}. Live view: \`node .switchboard/switchboard.mjs ui\`._`, '',
    `**${live.length} live** · ${col('taken').length} in progress · ${col('open').length} open · ${col('blocked').length} blocked · ${col('review').length} in review · ${col('done').length} done`, ''];
  const ws = WS.workstreams(boardCache(S), proj).filter((g) => g.active || g.hot || g.open || g.blocked || g.review || g.done_24h);
  if (ws.length) {
    L.push('## Workstreams', '', '_Grouped automatically by area of the project and kind of work._', '', '| Workstream | Kind | Who | In progress | Open | Blocked | Done today |', '|---|---|---|---:|---:|---:|---:|');
    for (const g of ws.slice(0, 40)) L.push(`| ${cell(g.name)} | ${g.nature} | ${g.agents.map(cell).join(', ') || '-'} | ${g.in_progress} | ${g.open} | ${g.blocked} | ${g.done_24h} |`);
    L.push('');
  }
  L.push('## Who is working', '');
  if (live.length) { L.push('| Agent | Person | Branch | Doing | Seen |', '|---|---|---|---|---|'); for (const a of live) L.push(`| ${a.id} | ${cell(a.human)} | ${cell(a.branch)} | ${cell(a.doing || (a.last_file ? 'editing ' + a.last_file : ''))} | ${when(a.last_seen)} |`); } else L.push('_Nobody right now._');
  for (const [st, title] of [['taken', 'In progress'], ['blocked', 'Blocked'], ['review', 'In review'], ['open', 'Open']]) {
    const rows = col(st); if (!rows.length) continue;
    L.push('', `## ${title}`, '', '| # | Task | Owner | P | Paths | Issue |', '|---:|---|---|---|---|---|');
    for (const t of rows.slice(0, 200)) L.push(`| ${t.id} | ${cell(t.title)} | ${t.owner || '-'} | P${t.priority} | ${t.area.slice(0, 4).map((a) => '`' + cell(a) + '`').join(' ')} | ${t.gh_issue ? '#' + t.gh_issue : ''} |`);
  }
  if (cl.length) { L.push('', '## Reserved paths', '', '| Path | Agent | Task |', '|---|---|---|'); for (const c of cl.slice(0, 200)) L.push(`| \`${cell(c.path)}\` | ${c.agent} | ${c.task ? 'task ' + c.task : ''} |`); }
  const recent = col('done').sort((a, b) => (b.done_at || 0) - (a.done_at || 0)).slice(0, 15);
  if (recent.length) { L.push('', '## Recently done', ''); for (const t of recent) L.push(`- task ${t.id}: ${cell(t.title)}${t.owner ? ` - ${t.owner}` : ''}${t.note ? `: ${cell(t.note)}` : ''}`); }
  L.push('', '---', 'Files tracked outside git: see [BUILD-LIST.md](BUILD-LIST.md).');
  return L.join('\n') + '\n';
}

/** A picture of the board for the project's README: workstreams with who is on them and how much is in flight.
 *  Plain SVG (no scripts, no external fonts or links), drawn on its own dark card so it reads on light and
 *  dark GitHub alike. */
export function boardSvg(S, project, proj = {}, now = Date.now()) {
  const x = (s, n = 60) => { const t = String(E.line(String(s ?? ''), 400) || ''); return (t.length > n ? t.slice(0, n - 1) + '…' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); };
  const ts = E.tasks(S); const live = E.agents(S).filter((a) => a.kind !== 'human' && E.isLive(a));
  const n = (st) => ts.filter((t) => t.status === st).length;
  const all = WS.workstreams(boardCache(S, now), proj, now).filter((g) => g.active || g.hot || g.open || g.blocked || g.review || g.done_24h);
  const rows = all.slice(0, 10); const more = all.length - rows.length;
  const maxTotal = Math.max(1, ...rows.map((g) => g.in_progress + g.blocked + g.review + g.open));
  const W = 860, top = 96, rowH = 56, body = Math.max(1, rows.length) * rowH + (more > 0 ? 28 : 0), H = top + body + 52;
  const C = { bg: '#1a1830', bg2: '#221f3d', line: '#3a3560', ink: '#f2f1f7', ink2: '#c9c6da', ink3: '#9d99b5', accent: '#b296f7', solid: '#8257e6', live: '#4ade80', hot: '#fbbf24', block: '#f87171', review: '#fbbf24', open: '#57527d' };
  const F = "font-family=\"-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif\"";
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Switchboard: what is being worked on in ${x(project, 80)}">`,
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${C.bg2}"/><stop offset="1" stop-color="${C.bg}"/></linearGradient></defs>`,
    `<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="16" fill="url(#g)" stroke="${C.line}"/>`,
    `<text x="28" y="38" ${F} font-size="11" font-weight="700" letter-spacing="1.6" fill="${C.accent}">SWITCHBOARD · LIVE WORK</text>`,
    `<text x="28" y="66" ${F} font-size="20" font-weight="650" fill="${C.ink}">${x(project, 50)}</text>`,
    `<text x="${W - 28}" y="44" text-anchor="end" ${F} font-size="14" fill="${C.ink2}"><tspan fill="${live.length ? C.live : C.ink3}">●</tspan> ${live.length} live</text>`,
    `<text x="${W - 28}" y="66" text-anchor="end" ${F} font-size="13" fill="${C.ink3}">${n('taken')} in progress · ${n('open')} open · ${n('blocked')} blocked · ${n('review')} in review · ${n('done')} done</text>`,
    `<line x1="28" y1="${top - 14}" x2="${W - 28}" y2="${top - 14}" stroke="${C.line}"/>`];
  if (!rows.length) out.push(`<text x="28" y="${top + 26}" ${F} font-size="14" fill="${C.ink3}">Nothing planned yet. Plan work with your agent and it appears here, grouped by area.</text>`);
  rows.forEach((g, i) => {
    const y = top + i * rowH; const dot = g.active ? C.live : g.hot ? C.hot : C.open;
    const who = g.agents.length ? g.agents.map((a) => '@' + a).join(', ') : 'nobody on it right now';
    out.push(`<circle cx="34" cy="${y + 15}" r="4.5" fill="${dot}"/>`,
      `<text x="48" y="${y + 20}" ${F} font-size="15" font-weight="600" fill="${C.ink}">${x(g.name, 46)}</text>`,
      `<text x="48" y="${y + 40}" ${F} font-size="12.5" fill="${C.ink3}">${x(g.nature, 20)} · ${x(who, 64)}</text>`);
    const total = g.in_progress + g.blocked + g.review + g.open; const bx = 560, full = W - 28 - bx;
    const bw = total ? Math.max(24, Math.round(full * total / maxTotal)) : full; // longer bar = more work in that stream
    const parts = [[g.in_progress, C.solid], [g.review, C.review], [g.blocked, C.block], [g.open, C.open]];
    out.push(`<rect x="${bx}" y="${y + 30}" width="${full}" height="8" rx="4" fill="${C.bg}" stroke="${C.line}"/>`);
    let cx = bx; for (const [v, color] of parts) { if (!v || !total) continue; const w = Math.max(6, Math.round((v / total) * bw)); out.push(`<rect x="${cx}" y="${y + 30}" width="${Math.min(w, bx + bw - cx)}" height="8" rx="4" fill="${color}"/>`); cx += w; if (cx >= bx + bw) break; }
    const label = [g.in_progress && `${g.in_progress} in progress`, g.review && `${g.review} in review`, g.blocked && `${g.blocked} blocked`, g.open && `${g.open} open`, g.done_24h && `${g.done_24h} done today`].filter(Boolean).join(' · ') || 'recent edits';
    out.push(`<text x="${W - 28}" y="${y + 20}" text-anchor="end" ${F} font-size="12.5" fill="${C.ink2}">${x(label, 70)}</text>`);
    if (i < rows.length - 1) out.push(`<line x1="28" y1="${y + rowH - 4}" x2="${W - 28}" y2="${y + rowH - 4}" stroke="${C.line}" stroke-opacity="0.55"/>`);
  });
  if (more > 0) out.push(`<text x="48" y="${top + rows.length * rowH + 14}" ${F} font-size="12.5" fill="${C.ink3}">+ ${more} more workstream${more === 1 ? '' : 's'} on the board</text>`);
  out.push(`<text x="28" y="${H - 22}" ${F} font-size="12" fill="${C.ink3}">Updated ${when(now)} · grouped automatically by area and kind of work · click for the full board</text>`, '</svg>');
  return out.join('\n') + '\n';
}

// ---------------- GitHub API ----------------
async function ghPage(url, method = 'GET', body) {
  const api = (process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/+$/, '');
  const full = url.startsWith('http') ? url : api + url;
  if (!full.startsWith(api + '/')) throw new Error('refusing to call a different host');
  const r = await fetch(full, { method, headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'switchboard-ci', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw Object.assign(new Error(`GitHub ${method} ${full.slice(api.length).split('?')[0]} -> ${r.status}`), { status: r.status });
  const next = (r.headers.get('link') || '').match(/<([^>]+)>;\s*rel="next"/)?.[1] || null;
  return { data: r.status === 204 ? null : await r.json(), next };
}
const gh = async (method, url, body) => (await ghPage(url, method, body)).data;

// ---------------- tasks <-> GitHub Issues ----------------
const labelsFor = (t) => ['switchboard', `sb:${t.status}`, `P${t.priority}`];
const sig = (t) => JSON.stringify([t.title, t.status, t.priority, t.owner, t.note]);
const plain = (s, n) => (E.line(s, n) || '').replace(/@/g, '@' + ZW); // board text never notifies anyone
const fenced = (s) => '```text\n' + String(s || '').replace(/```/g, "'''").slice(0, 6000) + '\n```';
function issueBody(t) {
  return [t.body ? fenced(t.body) : '', t.accept ? `\n**Acceptance**\n${fenced(t.accept)}` : '', t.area.length ? `\n**Paths:** ${t.area.map((a) => '`' + a.replace(/`/g, "'") + '`').join(', ')}` : '', t.depends_on.length ? `\n**Depends on tasks:** ${t.depends_on.join(', ')}` : '',
    `\n---\nSwitchboard task ${t.id}. Status and owner sync here as labels and comments; closing or reopening this issue updates the board.`, `<!-- switchboard:task:${t.id} -->`].filter(Boolean).join('\n').trim();
}
/** Two-way mirror. `map` is CI-private memory {tasks:{id:{issue,sig}}, since} and is the ONLY source of issue
 *  numbers for API calls (nothing on the branch can aim the bot at another issue). Each task is independent:
 *  one failure never repeats or blocks the others. Returns ops to apply to the board. */
export async function mirrorIssues(S, repo, map) {
  map.tasks = map.tasks && typeof map.tasks === 'object' ? map.tasks : {}; const ops = []; const ts = E.tasks(S);
  const started = new Date(Date.now() - 60_000).toISOString();
  let remote = []; try { remote = await gh('GET', `/repos/${repo}/issues?labels=switchboard&state=all&per_page=100&sort=updated&direction=desc${map.since ? `&since=${encodeURIComponent(map.since)}` : ''}`); } catch (e) { console.log(`issues: could not list (${e.message})`); return ops; }
  const byNum = new Map(remote.filter((i) => !i.pull_request).map((i) => [i.number, i]));
  let created = 0;
  for (const t of ts) {
    const m = Object.hasOwn(map.tasks, t.id) ? map.tasks[t.id] : null; const closed = ['done', 'dropped'].includes(t.status);
    try {
      if (!m) {
        if (closed || created >= 5) continue; // at most 5 new issues per run
        const r = await gh('POST', `/repos/${repo}/issues`, { title: plain(t.title, 200), body: issueBody(t), labels: labelsFor(t) });
        if (!Number.isInteger(r?.number)) continue;
        map.tasks[t.id] = { issue: r.number, sig: sig(t) }; created++; ops.push({ kind: 'link', id: t.id, issue: r.number }); continue;
      }
      if (!Number.isInteger(m.issue)) continue;
      const is = byNum.get(m.issue);
      if (m.sig !== sig(t)) {
        await gh('PATCH', `/repos/${repo}/issues/${m.issue}`, { title: plain(t.title, 200), labels: labelsFor(t), state: closed ? 'closed' : 'open', ...(closed ? { state_reason: t.status === 'done' ? 'completed' : 'not_planned' } : {}) });
        let prev = []; try { prev = JSON.parse(m.sig); } catch { /* first */ }
        if (prev[1] !== t.status || prev[3] !== t.owner) await gh('POST', `/repos/${repo}/issues/${m.issue}/comments`, { body: `Switchboard: **${t.status}**${t.owner ? ` - ${t.owner}` : ''}${t.note ? `\n\n${fenced(t.note)}` : ''}` });
        m.sig = sig(t);
      } else if (is) { // unchanged on the board: GitHub may have changed it
        const by = plain(is.closed_by?.login || is.user?.login || 'someone', 40);
        if (is.state === 'closed' && !closed) ops.push({ kind: 'status', id: t.id, status: is.state_reason === 'not_planned' ? 'dropped' : 'done', note: `closed on GitHub by ${by}` });
        else if (is.state === 'open' && closed) ops.push({ kind: 'status', id: t.id, status: 'open', note: 'reopened on GitHub' });
        else if (E.line(is.title, 200) && plain(t.title, 200) !== E.line(is.title, 200) && t.title !== E.line(is.title, 200)) ops.push({ kind: 'title', id: t.id, title: E.line(is.title, 200).split(ZW).join('') });
      }
    } catch (e) { console.log(`issues: task ${t.id} skipped (${e.message})`); }
  }
  const linked = new Set(Object.values(map.tasks).map((x) => x.issue));
  for (const is of byNum.values()) {
    if (linked.has(is.number) || is.state !== 'open' || /<!-- switchboard:task:\d+ -->/.test(is.body || '')) continue;
    if (!['OWNER', 'MEMBER', 'COLLABORATOR'].includes(is.author_association)) continue; // only people who can push anyway
    ops.push({ kind: 'import', issue: is.number, title: E.line(is.title, 200), body: `${E.text(is.body || '', 3000)}\n\n(From GitHub issue ${is.number} by ${plain(is.user?.login || 'someone', 40)})`, priority: Number(((is.labels || []).map((l) => l.name).find((n) => /^P[0-4]$/.test(n)) || 'P2').slice(1)) });
  }
  map.since = started;
  return ops;
}
export function applyIssueOps(S, ops, map) {
  const ME = 'github';
  if (!S.read(`agents/${ME}.json`)) S.write(`agents/${ME}.json`, { id: ME, kind: 'human', human: 'GitHub', status: 'offline', joined_at: Date.now(), last_seen: 0, edits: 0 });
  for (const o of ops) {
    try {
      if (o.kind === 'link') { const raw = S.read(`tasks/${o.id}.json`); if (raw) { raw.gh_issue = o.issue; S.write(`tasks/${o.id}.json`, raw); } }
      else if (o.kind === 'status') { const t = E.updateTask(S, ME, o.id, { status: o.status, note: o.note }); if (map.tasks[o.id]) map.tasks[o.id].sig = sig(t); }
      else if (o.kind === 'title') { const t = E.updateTask(S, ME, o.id, { title: o.title }); if (map.tasks[o.id]) map.tasks[o.id].sig = sig(t); }
      else if (o.kind === 'import' && !Object.values(map.tasks).some((x) => x.issue === o.issue)) { const [t] = E.plan(S, ME, [{ title: o.title, body: o.body, priority: o.priority }]); const raw = S.read(`tasks/${t.id}.json`); raw.gh_issue = o.issue; S.write(`tasks/${t.id}.json`, raw); map.tasks[t.id] = { issue: o.issue, sig: sig(E.task(S, t.id)) }; }
    } catch (e) { console.log(`issues: could not apply ${o.kind} (${e.message})`); }
  }
}

// ---------------- entry ----------------
export async function ci(args) {
  const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
  const sub = args[0]; const dir = path.resolve(opt('state', '_state')); const memFile = path.resolve(opt('ci-state', '.sb-ci/state.json'));
  const repo = process.env.GITHUB_REPOSITORY || ''; const project = repo.toLowerCase() || 'project';
  const cfg = (() => { try { return JSON.parse(fs.readFileSync(path.join(process.cwd(), '.switchboard', 'project.json'), 'utf8')); } catch { return {}; } })();
  const mem = (() => { try { const v = JSON.parse(fs.readFileSync(memFile, 'utf8')); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; } })();
  mem.owners = mem.owners && typeof mem.owners === 'object' ? mem.owners : {}; mem.issues = mem.issues && typeof mem.issues === 'object' ? mem.issues : {};
  if (sub === 'validate') { const v = validate(dir, { base: mem.validated, owners: mem.owners }); console.log(JSON.stringify(v, null, 1)); process.exitCode = v.bad.length ? 1 : 0; return; }
  if (sub !== 'run') throw new Error('usage: ci run|validate --state <dir> [--ci-state <file>]');
  const online = !!(process.env.GITHUB_TOKEN && repo);
  const L = { top: process.cwd(), state: dir, base: fs.mkdtempSync(path.join(os.tmpdir(), 'sbci-')) }; L.lock = path.join(L.base, 'lock'); L.localFile = path.join(L.base, 'local.json');
  for (const [k, v] of [['user.name', BOT], ['user.email', '41898282+github-actions[bot]@users.noreply.github.com'], ['core.symlinks', 'false'], ['core.hooksPath', '/dev/null']]) g(dir, ['config', '--replace-all', k, v]);
  // The anchor commit is kept in a tiny private repo next to the CI memory, so it stays available even if the
  // branch is force-pushed and GitHub no longer serves it.
  const vault = path.join(path.dirname(memFile), 'anchor.git');
  if (fs.existsSync(vault)) g(dir, ['fetch', '--quiet', vault, '+refs/heads/anchor:refs/sb/anchor']);
  let report = null; const notes = new Set();
  for (let attempt = 0; attempt < 4; attempt++) {
    if (g(dir, ['remote']) && g(dir, ['fetch', '--quiet', 'origin', E.BRANCH]) !== null) { g(dir, ['reset', '--quiet', '--hard', `origin/${E.BRANCH}`]); g(dir, ['clean', '-fdq']); }
    const head = g(dir, ['rev-parse', 'HEAD']);
    const haveAnchor = isCommit(dir, mem.validated);
    if (mem.validated && !haveAnchor) notes.add('The last validated commit is no longer available (the CI memory was reset): this run only checks file rules and does not change ownership.');
    let log = null; let logOk = false;
    if (online) { try { log = await pushLog(repo, haveAnchor && ancestor(dir, mem.validated, head) ? mem.validated : null); logOk = log.complete; } catch (e) { notes.add(`Push log unavailable (${e.message}).`); } }
    if (online && haveAnchor && log && !log.complete) notes.add('More pushes than the push log covers since the last check.');
    // Without a complete push log nobody can be attributed: check file rules only, and do NOT move the anchor,
    // so the same range is examined again (with ownership) on the next run.
    const attributable = !online || (log && (logOk || !ancestor(dir, mem.validated || head, head)));
    const v = validate(dir, { base: haveAnchor ? mem.validated : null, pushes: online ? (attributable && log ? log.pushes : null) : null, owners: mem.owners });
    console.log(`checked ${v.base ? v.base.slice(0, 10) + '..' : '(whole branch) '}${v.head.slice(0, 10)} [${v.proven ? 'pusher identity from GitHub' : 'ownership not checked this run'}]: ${v.bad.length} problem(s)`);
    const fix = v.bad.length ? repair(dir, v) : { restored: [], refused: false };
    if (fix.refused) notes.add(`${v.bad.length} paths look invalid at once with no trusted starting point: nothing was changed.`);
    const S = E.store(L);
    if (!v.bad.length && online && cfg.issues !== false) { const ops = await mirrorIssues(S, repo, mem.issues); if (ops.length) applyIssueOps(S, ops, mem.issues); }
    try { S.writeRaw('README.md', boardMarkdown(S, project, cfg)); S.writeRaw('board.svg', boardSvg(S, project, cfg)); S.writeRaw('BUILD-LIST.md', AS.markdown(AS.buildList(S), project)); } catch (e) { notes.add(`Board could not be rendered (${e.message}).`); }
    g(dir, ['add', '-A']);
    if (g(dir, ['status', '--porcelain'])) g(dir, ['commit', '--quiet', '-m', fix.restored.length ? 'sb-ci: restored invalid changes' : 'sb-ci: board rendered']);
    const mine = g(dir, ['rev-parse', 'HEAD']);
    if (g(dir, ['remote']) && mine !== head && g(dir, ['push', '--quiet', 'origin', `HEAD:${E.BRANCH}`]) === null) { console.log('someone pushed during the run: checking again'); continue; }
    // New anchor = the commit this run produced (the head it examined + its own repairs and renders). It is known
    // by SHA, so no pusher identity is trusted for it. It only moves when the whole range could be attributed.
    const settled = (online ? v.proven : true) && !v.unattributed && !fix.refused;
    if (settled) {
      mem.validated = mine; mem.owners = v.owners;
      try { if (!fs.existsSync(vault)) { fs.mkdirSync(path.dirname(vault), { recursive: true }); gitRaw(path.dirname(vault), ['init', '--quiet', '--bare', vault]); } gitRaw(dir, ['push', '--quiet', '--force', vault, `${mine}:refs/heads/anchor`]); } catch { /* next run falls back to file rules */ }
    } else notes.add('The starting point for the next check was not moved: this range will be checked again.');
    report = { v, fix }; break;
  }
  fs.mkdirSync(path.dirname(memFile), { recursive: true }); fs.writeFileSync(memFile, JSON.stringify(mem));
  if (!report) { console.log('the branch kept changing: will check on the next run'); return; }
  const { v, fix } = report;
  if (v.bad.length || notes.size) {
    const body = [`Switchboard security check on \`${E.BRANCH}\`${fix.restored.length ? `: restored ${fix.restored.length} path(s)` : ''}.`, '', ...[...notes].map((n) => `- ${n}`), '',
      v.bad.length ? `| Pushed by | Path | Problem | Action |\n|---|---|---|---|\n${v.bad.slice(0, 60).map((b) => `| ${cell(b.by)} | \`${cell(b.path)}\` | ${cell(b.why)} | ${fix.restored.includes(b.path) ? 'restored' : 'reported only'} |`).join('\n')}` : '',
      '', 'If a credential was pushed, rotate it now: it remains in the branch history.'].join('\n');
    if (online && v.bad.length) {
      try { // one open report at a time: later runs add a comment instead of a new issue
        const open = await gh('GET', `/repos/${repo}/issues?labels=switchboard-security&state=open&per_page=5`);
        const mineIssue = (open || []).find((x) => !x.pull_request && x.user?.login === BOT);
        if (mineIssue) { if ((mem.lastReport || '') !== body.slice(0, 2000)) await gh('POST', `/repos/${repo}/issues/${mineIssue.number}/comments`, { body }); }
        else await gh('POST', `/repos/${repo}/issues`, { title: 'Switchboard security check needs attention', body, labels: ['switchboard-security'] });
        mem.lastReport = body.slice(0, 2000); fs.writeFileSync(memFile, JSON.stringify(mem));
      } catch (e) { console.log(`could not file the report: ${e.message}`); }
    }
    console.log(body);
    if (v.bad.length) process.exitCode = 1;
  }
}
