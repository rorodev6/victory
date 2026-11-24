// Workstreams: the board groups itself by WHAT is being worked on, with nobody labelling anything.
// A workstream is derived from where work lives (path -> area) and its nature is inferred from file types
// and task wording. Optional named areas in .switchboard/project.json override the automatic ones:
//   "areas": { "Renderer": ["src/gpu/**", "shaders/**"], "Docs": ["docs/**", "*.md"] }
import * as E from './state.mjs';

const CONTAINERS = new Set(['src', 'lib', 'libs', 'app', 'apps', 'packages', 'crates', 'services', 'modules', 'components', 'internal', 'pkg', 'cmd', 'dlls', 'programs', 'tools', 'plugins', 'drivers', 'include', 'source', 'sources', 'test', 'tests', 'docs', 'scripts', 'examples']);
const MEDIA = /\.(png|jpe?g|gif|webp|svg|exr|tiff?|psd|mp4|mov|mkv|avi|wav|mp3|flac|ogg|aif|fbx|obj|gltf|glb|blend|usd[acz]?|abc|bin|dat|pak|iso|zip|7z|tar|gz)$/i;
const cleanName = (s) => (E.line(s, 60) || '').replace(/[<>`|]/g, '');

/** Named areas from the project file, validated: [{name, patterns[]}] */
export function namedAreas(proj) {
  const a = proj && typeof proj.areas === 'object' && !Array.isArray(proj.areas) ? proj.areas : {};
  return Object.entries(a).slice(0, 60).map(([name, pats]) => ({ name: cleanName(name), patterns: (Array.isArray(pats) ? pats : [pats]).filter((p) => typeof p === 'string' && p.length <= 300).slice(0, 20) })).filter((x) => x.name && x.patterns.length);
}
/** Which workstream a path belongs to. */
export function areaOf(p, named = []) {
  const s = E.norm(String(p || '')); if (!s) return 'Unsorted';
  for (const a of named) if (a.patterns.some((pt) => E.overlaps(pt, s))) return a.name;
  const parts = s.replace(/[*?[].*$/, '').replace(/\/$/, '').split('/').filter(Boolean); // globs: use their fixed part
  if (!parts.length) return 'Whole project';
  if (parts[0].startsWith('@')) return parts.length > 1 && !/\.[a-z0-9]{1,6}$/i.test(parts[1]) ? `${parts[0]}/${parts[1]}` : parts[0];
  const isFile = (x) => /\.[a-z0-9]{1,8}$/i.test(x);
  if (parts.length === 1) return isFile(parts[0]) ? 'Project files' : parts[0];
  if (CONTAINERS.has(parts[0].toLowerCase()) && !isFile(parts[1])) return `${parts[0]}/${parts[1]}`;
  return parts[0];
}
/** What kind of work a path implies. */
export function natureOfPath(p) {
  const s = String(p || '').toLowerCase();
  if (s.startsWith('@') || MEDIA.test(s)) return 'assets';
  if (/(^|\/)(tests?|__tests__|e2e)(\/|$)|\.(test|spec)\.[a-z]+$|_test\.[a-z]+$/.test(s)) return 'tests';
  if (/(^|\/)docs?(\/|$)|\.(md|mdx|rst|adoc|txt)$/.test(s)) return 'docs';
  if (/(^|\/)(\.github|ci|\.circleci|deploy|infra|docker|k8s|helm)(\/|$)|(^|\/)(dockerfile|makefile|cmakelists\.txt)$|\.(ya?ml|toml|ini|cfg|conf|lock|json)$/.test(s)) return 'config';
  if (/(^|\/)(scripts?|tools?|build)(\/|$)|\.(sh|ps1|bat|cmd)$/.test(s)) return 'tooling';
  return 'code';
}
/** What kind of work a task title implies (null when it does not say). */
export function natureOfTitle(t) {
  const s = ` ${String(t || '').toLowerCase()} `;
  if (/\b(fix|bug|crash|regression|broken|hotfix|patch)\b/.test(s)) return 'fix';
  if (/\b(tests?|coverage|e2e|spec)\b/.test(s)) return 'tests';
  if (/\b(docs?|document|readme|guide|changelog)\b/.test(s)) return 'docs';
  if (/\b(refactor|cleanup|clean up|rename|restructure|simplify|tidy)\b/.test(s)) return 'refactor';
  if (/\b(perf|performance|optimi[sz]e|speed up|faster|latency)\b/.test(s)) return 'performance';
  if (/\b(render|export|encode|bake|capture|record)\b(?!-)/.test(s)) return 'assets'; // "render-target" is code, not output
  if (/\b(add|implement|support|create|build|introduce|enable|new)\b/.test(s)) return 'feature';
  return null;
}

/** The live grouping. cache = the companion's in-memory board; proj = .switchboard/project.json */
export function workstreams(cache, proj, now = Date.now()) {
  const named = namedAreas(proj); const groups = new Map();
  const get = (name) => { let g = groups.get(name); if (!g) { g = { name, named: named.some((a) => a.name === name), agents: new Set(), tasks: [], in_progress: 0, open: 0, blocked: 0, review: 0, done_24h: 0, files: new Set(), edits_24h: 0, reserved: [], last_at: 0, hot: false, natures: {} }; groups.set(name, g); } return g; };
  const bump = (g, nature, n = 1) => { g.natures[nature] = (g.natures[nature] || 0) + n; };
  const liveIds = new Set(cache.agents.filter((a) => E.isLive(a) && a.kind === 'agent').map((a) => a.id));
  for (const t of cache.tasks) {
    const recentDone = t.status === 'done' && (t.done_at || 0) > now - 24 * 3600_000;
    if (['dropped'].includes(t.status) || (t.status === 'done' && !recentDone)) continue;
    const areas = [...new Set((t.area.length ? t.area : ['']).map((p) => (p ? areaOf(p, named) : 'Unsorted')))];
    const nature = natureOfTitle(t.title) || (t.area.length ? natureOfPath(t.area[0]) : 'feature');
    for (const an of areas) {
      const g = get(an);
      g.tasks.push({ id: t.id, title: t.title, status: t.status, owner: t.owner, priority: t.priority, nature });
      if (t.status === 'taken') g.in_progress++; else if (t.status === 'open') g.open++; else if (t.status === 'blocked') g.blocked++; else if (t.status === 'review') g.review++; else if (recentDone) g.done_24h++;
      if (t.owner && liveIds.has(t.owner) && ['taken', 'blocked', 'review'].includes(t.status)) g.agents.add(t.owner);
      if (t.status !== 'done') bump(g, nature);
      g.last_at = Math.max(g.last_at, t.updated_at || 0);
    }
  }
  for (const c of cache.claims) {
    const g = get(areaOf(c.path, named));
    if (c.mode === 'hard') g.reserved.push({ path: c.path, agent: c.agent, task: c.task });
    if (liveIds.has(c.agent)) g.agents.add(c.agent);
    g.last_at = Math.max(g.last_at, c.at || 0);
  }
  for (const f of cache.files) {
    if ((f.last_at || 0) < now - 24 * 3600_000) continue;
    const g = get(areaOf(f.path, named));
    g.files.add(f.path); g.edits_24h += f.edits || 0; bump(g, natureOfPath(f.path));
    g.last_at = Math.max(g.last_at, f.last_at || 0);
    if (f.last_at > now - 15 * 60_000) { g.hot = true; if (f.last_agent && liveIds.has(f.last_agent)) g.agents.add(f.last_agent); }
  }
  return [...groups.values()].map((g) => {
    const top = Object.entries(g.natures).sort((a, b) => b[1] - a[1]);
    return { name: g.name, named: g.named, paths: g.named ? (named.find((x) => x.name === g.name)?.patterns || []) : [g.name], nature: top[0]?.[0] || 'code', natures: Object.fromEntries(top.slice(0, 4)), agents: [...g.agents].sort(), tasks: g.tasks.sort((a, b) => (a.priority - b.priority) || (a.id - b.id)).slice(0, 40), in_progress: g.in_progress, open: g.open, blocked: g.blocked, review: g.review, done_24h: g.done_24h, files_24h: g.files.size, edits_24h: g.edits_24h, reserved: g.reserved.slice(0, 20), last_at: g.last_at, hot: g.hot, active: g.agents.size > 0 || g.in_progress > 0 };
  }).sort((a, b) => (b.agents.length - a.agents.length) || (Number(b.hot) - Number(a.hot)) || (b.in_progress - a.in_progress) || ((b.open + b.blocked + b.review) - (a.open + a.blocked + a.review)) || (b.last_at - a.last_at) || a.name.localeCompare(b.name));
}

/** Short text for agents: what is being worked on right now, grouped. */
export function streamsText(ws, me) {
  const live = ws.filter((g) => g.active || g.hot).slice(0, 14); const idle = ws.filter((g) => !g.active && !g.hot && g.open > 0).slice(0, 8);
  const L = [`Workstreams right now (${live.length} active):`];
  for (const g of live) {
    L.push(`  ${g.name} [${g.nature}] — ${g.agents.length ? g.agents.map((a) => (a === me ? `@${a} (you)` : '@' + a)).join(', ') : 'nobody live'}; ${g.in_progress} in progress, ${g.open} open${g.blocked ? `, ${g.blocked} blocked` : ''}${g.edits_24h ? `; ${g.edits_24h} edits today` : ''}`);
    for (const t of g.tasks.filter((x) => x.status === 'taken').slice(0, 4)) L.push(`      #${t.id} ${E.line(t.title, 90)}${t.owner ? ` — @${t.owner}` : ''}`);
  }
  if (!live.length) L.push('  (nothing active)');
  if (idle.length) L.push('Workstreams with open work and nobody on them:', ...idle.map((g) => `  ${g.name} [${g.nature}] — ${g.open} open`));
  return L.join('\n');
}
