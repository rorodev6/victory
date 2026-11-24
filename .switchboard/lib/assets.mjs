// Files outside git (hundreds of GB of renders/media/data) under named roots: "@assets/ep01/shot04.exr".
// Each machine publishes a manifest of what IT has — names, sizes, times only — split into many small
// shard files so one changed file rewrites a few KB, not the whole list:
//   assets/<machine>/<root>/<shard>.tsv      lines: relpath \t size \t mtimeMs      (sorted)
// The build list is the union over machines + planned outputs (task areas under @roots).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as E from './state.mjs';

const SKIP_DIR = new Set(['node_modules', '.git', '__pycache__', '.cache', '.venv', 'venv', '.idea', '.vs']);
export const SKIP_FILE = /(^|[\\/])(\.DS_Store|Thumbs\.db|desktop\.ini)$|\.(tmp|part|crdownload|swp|lock)$|~$/i;
export const okRoot = (n) => /^[a-z0-9][a-z0-9._-]{0,39}$/.test(String(n || '')); // lower case only: no two names that differ by case
export const okLabel = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'machine';
/** Shard = first two folder levels (bounded, filesystem-safe). Deep trees spread over many small files. */
export function shardOf(rel) {
  const parts = rel.split('/'); const dir = parts.slice(0, Math.min(2, parts.length - 1)).join('/') || '_top';
  const safe = dir.replace(/[^\w.-]+/g, '_').slice(0, 60);
  return `${safe.toLowerCase()}.${crypto.createHash('sha1').update(dir).digest('hex').slice(0, 8)}`; // the hash (of the exact name) keeps case-different folders apart
}
const cleanRel = (r) => { const s = E.norm(E.line(r, 400)); return !s || /(^|\/)\.\.(\/|$)/.test(s) || s.includes('\t') ? '' : s; };

export function walk(dir, rel = '', acc = [], cap = 1_000_000) {
  let ents = []; try { ents = fs.readdirSync(path.join(dir, rel), { withFileTypes: true }); } catch { return acc; }
  for (const e of ents) {
    if (acc.length >= cap) break;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) { if (!SKIP_DIR.has(e.name) && !e.name.startsWith('.')) walk(dir, r, acc, cap); }
    else if (e.isFile() && !SKIP_FILE.test(e.name) && !e.name.startsWith('.env')) acc.push(r);
  }
  return acc;
}
const parse = (raw) => { const m = new Map(); for (const l of raw.split('\n')) { if (!l) continue; const [p, s, t] = l.split('\t'); if (p) m.set(p, [Number(s) || 0, Number(t) || 0]); } return m; };
const render = (m) => [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([p, [s, t]]) => `${p}\t${s}\t${Math.round(t)}`).join('\n') + (m.size ? '\n' : '');

/** Apply file changes to this machine's manifest shards (inside a transaction). changes: [{root, rel, op, size, mtime}] */
export function apply(S, label, changes) {
  const byShard = new Map(); const counts = { add: 0, change: 0, delete: 0 }; const sample = []; const roots = new Set();
  for (const c of changes) {
    const rel = cleanRel(c.rel); if (!rel || !okRoot(c.root)) continue;
    const f = `assets/${okLabel(label)}/${c.root}/${shardOf(rel)}.tsv`;
    if (!byShard.has(f)) byShard.set(f, parse(S.raw(f)));
    const m = byShard.get(f);
    if (c.op === 'delete') { if (m.delete(rel)) counts.delete++; }
    else { counts[m.has(rel) ? 'change' : 'add']++; m.set(rel, [c.size || 0, c.mtime || Date.now()]); }
    roots.add(c.root); if (sample.length < 6) sample.push(`@${c.root}/${rel}`);
  }
  for (const [f, m] of byShard) { if (m.size) S.writeRaw(f, render(m)); else S.remove(f); }
  return { ...counts, roots: [...roots], sample };
}
/** Replace a root's whole manifest for this machine (initial scan / rescan). files: [{rel,size,mtime}] */
export function replaceRoot(S, label, root, files) {
  const dir = `assets/${okLabel(label)}/${root}`;
  for (const f of S.list(dir)) S.remove(`${dir}/${f}`);
  const shards = new Map();
  for (const x of files) { const rel = cleanRel(x.rel); if (!rel) continue; const k = shardOf(rel); if (!shards.has(k)) shards.set(k, new Map()); shards.get(k).set(rel, [x.size || 0, x.mtime || 0]); }
  for (const [k, m] of shards) S.writeRaw(`${dir}/${k}.tsv`, render(m));
  return { files: files.length, shards: shards.size };
}
/** Union of every machine's manifest: Map("@root/rel" -> {size, mtime, machines}) */
export function union(S) {
  const all = new Map();
  for (const label of S.list('assets')) for (const root of S.list(`assets/${label}`)) {
    if (!okRoot(root)) continue;
    for (const f of S.list(`assets/${label}/${root}`)) for (const [rel, [size, mtime]] of parse(S.raw(`assets/${label}/${root}/${f}`))) {
      const k = `@${root}/${rel}`; const ex = all.get(k);
      if (!ex) all.set(k, { size, mtime, machines: 1 }); else { ex.machines++; if (mtime > ex.mtime) { ex.mtime = mtime; ex.size = size; } }
    }
  }
  return all;
}
export function buildList(S, { limit = 300 } = {}) {
  const all = union(S);
  const paths = [...all.keys()];
  const deliverables = E.tasks(S).filter((t) => (t.area || []).some(E.isRootPath)).map((t) => {
    const pats = t.area.filter(E.isRootPath);
    const hits = paths.filter((p) => pats.some((pt) => E.overlaps(pt, p)));
    const state = t.status === 'done' ? (hits.length ? 'done' : 'done (no files)') : t.status === 'open' ? (hits.length ? 'started' : 'planned') : t.status === 'dropped' ? 'dropped' : 'in progress';
    return { task: t.id, title: t.title, owner: t.owner, status: t.status, state, patterns: pats, files: hits.length, bytes: hits.reduce((s, p) => s + all.get(p).size, 0), last_at: hits.reduce((m, p) => Math.max(m, all.get(p).mtime), 0) || null };
  });
  const folders = new Map(); let bytes = 0;
  for (const [p, v] of all) {
    bytes += v.size; const parts = p.split('/'); const key = parts.slice(0, Math.min(3, parts.length - 1)).join('/') || parts[0];
    const g = folders.get(key) || { folder: key, files: 0, bytes: 0, last_at: 0 }; g.files++; g.bytes += v.size; if (v.mtime > g.last_at) g.last_at = v.mtime; folders.set(key, g);
  }
  const recent = [...all.entries()].sort((a, b) => b[1].mtime - a[1].mtime).slice(0, limit).map(([p, v]) => ({ path: p, size: v.size, last_at: v.mtime, mtime: v.mtime, state: 'present', machines: v.machines }));
  return { generated_at: Date.now(), totals: { files: all.size, bytes, deleted: 0 }, deliverables, folders: [...folders.values()].sort((a, b) => b.last_at - a.last_at), recent };
}
const human = (n) => { if (!n) return '0 B'; const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; } return `${n.toFixed(n < 10 && i ? 1 : 0)} ${u[i]}`; };
const when = (t) => (t ? new Date(t).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '—');
const cell = (s) => (E.line(String(s ?? ''), 160) || '').replace(/\|/g, '\\|');
export function markdown(bl, project) {
  const L = [`# Build list — ${cell(project)}`, '', `**${bl.totals.files} files · ${human(bl.totals.bytes)}** tracked outside git. Updated ${when(bl.generated_at)}.`, '', '## Deliverables', ''];
  if (bl.deliverables.length) { L.push('| Task | State | Owner | Files | Size | Paths |', '|---|---|---|---:|---:|---|'); for (const d of bl.deliverables) L.push(`| #${d.task} ${cell(d.title)} | ${d.state} | ${d.owner ? '@' + cell(d.owner) : '—'} | ${d.files} | ${human(d.bytes)} | ${d.patterns.map((p) => '`' + cell(p) + '`').join(' ')} |`); }
  else L.push('_No planned outputs yet. Give a task an area under a root, e.g. `@assets/ep01/**`._');
  L.push('', '## Folders', '', '| Folder | Files | Size | Last change |', '|---|---:|---:|---|');
  for (const g of bl.folders.slice(0, 200)) L.push(`| \`${cell(g.folder)}\` | ${g.files} | ${human(g.bytes)} | ${when(g.last_at)} |`);
  L.push('', '## Most recent files', '', '| File | Size | Changed |', '|---|---:|---|');
  for (const f of bl.recent.slice(0, 100)) L.push(`| \`${cell(f.path)}\` | ${human(f.size)} | ${when(f.last_at)} |`);
  return L.join('\n') + '\n';
}
