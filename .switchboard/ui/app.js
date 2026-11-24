// Switchboard UI. Vanilla ES module, no deps, no external requests.
// Everything the server sends is untrusted (agents write it): rendered only via textContent / createElement.

/* ================= tiny DOM kit ================= */
const $ = (s, r = document) => r.querySelector(s);
function h(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = String(text);
  return e;
}
const setText = (e, v) => { v = v == null ? '' : String(v); if (e.textContent !== v) e.textContent = v; };
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};
const reducedMq = matchMedia('(prefers-reduced-motion: reduce)');
const reduced = () => reducedMq.matches;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';
const EASE_MOVE = 'cubic-bezier(0.32, 0.72, 0, 1)';

const NS = 'http://www.w3.org/2000/svg';
const ICONS = {
  dots: ['M5 12h.01', 'M12 12h.01', 'M19 12h.01'],
  plus: ['M12 5v14', 'M5 12h14'],
  send: ['M5 12h13', 'M12 6l6 6-6 6'],
  branch: ['M6 4v11', 'M18 9a9 9 0 0 1-9 9'],
  branchDots: [],
  lock: ['M7 11V8a5 5 0 0 1 10 0v3', 'M5.5 11h13v9.5h-13z'],
  chevron: ['M6 9l6 6 6-6'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  close: ['M6 6l12 12', 'M18 6L6 18'],
  copy: ['M9 9h11v11H9z', 'M5 15H4V4h11v1'],
  warn: ['M12 9v4', 'M12 17h.01', 'M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z'],
  users: ['M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19', 'M10 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M20 19v-1.5a3.5 3.5 0 0 0-2.5-3.3', 'M15.5 5.2a3 3 0 0 1 0 5.6'],
  board: ['M4 5h4v14H4z', 'M10 5h4v9h-4z', 'M16 5h4v6h-4z'],
  chat: ['M5 5h14v10H9l-4 4z'],
  key: ['M14.5 9.5a4 4 0 1 0-3.9 4.9', 'M10.6 14.4 4 21', 'M6.5 18.5 8 20', 'M14.5 9.5h.01'],
  shield: ['M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6z'],
  out: ['M15 4h4v16h-4', 'M10 8l-4 4 4 4', 'M6 12h10'],
  merge: ['M6 7.7v8.6', 'M6 7.7c0 4.3 3.4 4.3 9.8 4.3'],
  eye: ['M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z', 'M12 14.6a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2z'],
  folder: ['M3.5 6.5a1.5 1.5 0 0 1 1.5-1.5h4l2 2h8a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5z'],
};
function icon(name, size = 14) {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', size); s.setAttribute('height', size);
  s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', name === 'dots' ? '3' : '1.6');
  s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
  s.setAttribute('aria-hidden', 'true'); s.setAttribute('class', 'i');
  for (const d of ICONS[name] || []) { const p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); s.append(p); }
  if (name === 'merge') for (const [cx, cy] of [[6, 5.5], [6, 18.5], [18, 12]]) { const c = document.createElementNS(NS, 'circle'); c.setAttribute('cx', cx); c.setAttribute('cy', cy); c.setAttribute('r', '2.2'); s.append(c); }
  if (name === 'branch') for (const [cx, cy] of [[6, 18], [6, 6], [18, 6]]) { const c = document.createElementNS(NS, 'circle'); c.setAttribute('cx', cx); c.setAttribute('cy', cy === 18 ? 18.5 : cy); c.setAttribute('r', '2.2'); s.append(c); }
  return s;
}

/** Switchboard's mark in Remote's idiom: an outlined jack and a filled one, patched together, in the theme accent. */
function logo() {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 22 22'); s.setAttribute('class', 'logo'); s.setAttribute('aria-hidden', 'true');
  const el = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); s.append(e); return e; };
  el('rect', { x: 1.5, y: 2.5, width: 9, height: 8, rx: 2, class: 'o' });
  el('path', { d: 'M10.5 6.5c3.5 0 1.5 9 4 9', class: 'o' });
  el('rect', { x: 11.5, y: 11.5, width: 9, height: 8, rx: 2, class: 'f' });
  el('circle', { cx: 16, cy: 15.5, r: 1.4, class: 'w' });
  return s;
}

/** Split-flap digits (Remote's signature cells); the old digit's upper leaf falls on change. */
function setFlaps(el, n) {
  const v = String(n);
  if (el._v === v) return;
  if (el._v === undefined) el.textContent = '';
  el._v = v;
  el.setAttribute('aria-label', v);
  while (el.children.length < v.length) el.append(h('span', 'flap'));
  while (el.children.length > v.length) el.lastElementChild.remove();
  [...el.children].forEach((c, i) => {
    const d = v[i]; const old = c.dataset.d;
    if (old === d) return;
    c.dataset.d = d;
    if (c.firstChild && c.firstChild.nodeType === 3) c.firstChild.data = d; else c.prepend(document.createTextNode(d));
    if (old != null && !reduced()) {
      const leaf = h('span', 'leaf'); leaf.append(h('span', null, old)); c.append(leaf);
      const a = leaf.animate([{ transform: 'rotateX(0deg)' }, { transform: 'rotateX(-90deg)' }], { duration: 180, delay: i * 45, easing: 'cubic-bezier(0.5, 0, 0.9, 0.6)', fill: 'both' });
      a.onfinish = a.oncancel = () => leaf.remove();
    }
  });
}

/* Appearance — the same model as Remote's lib/theme.ts: six themes x light/dark/system, per browser. */
const THEMES = [
  { id: 'hearth', name: 'Hearth', modes: ['dark', 'light'] },
  { id: 'glass', name: 'Glass', modes: ['dark', 'light'] },
  { id: 'soft', name: 'Soft', modes: ['dark', 'light'] },
  { id: 'graphite', name: 'Graphite', modes: ['dark', 'light'] },
  { id: 'aurora', name: 'Aurora', modes: ['dark'] },
  { id: 'signal', name: 'Signal', modes: ['dark'] },
];
const DEFAULT_THEME = 'hearth';
const darkMq = matchMedia('(prefers-color-scheme: dark)');
function loadAppearance() {
  try {
    const v = JSON.parse(localStorage.getItem('sb.appearance') || '{}') || {};
    return { theme: THEMES.some((t) => t.id === v.theme) ? v.theme : DEFAULT_THEME, mode: ['system', 'light', 'dark'].includes(v.mode) ? v.mode : 'system' };
  } catch { return { theme: DEFAULT_THEME, mode: 'system' }; }
}
const appearance = loadAppearance();
function resolveMode(theme, pref) {
  const info = THEMES.find((t) => t.id === theme) || THEMES.find((t) => t.id === DEFAULT_THEME);
  const want = pref === 'system' ? (darkMq.matches === false ? 'light' : 'dark') : pref;
  return info.modes.includes(want) ? want : info.modes[0];
}
function applyAppearance(animate) {
  const el = document.documentElement;
  const mode = resolveMode(appearance.theme, appearance.mode);
  if (el.dataset.theme === appearance.theme && el.dataset.mode === mode) return;
  const set = () => { el.dataset.theme = appearance.theme; el.dataset.mode = mode; };
  if (animate && document.startViewTransition && !reduced()) {
    const vt = document.startViewTransition(set);
    for (const k of ['ready', 'finished', 'updateCallbackDone']) vt[k]?.catch?.(() => {}); // a quicker second change skips the first; that's fine
  } else set();
  try { localStorage.setItem('sb.appearance', JSON.stringify(appearance)); } catch { /* private mode */ }
  requestAnimationFrame(() => { for (const sg of document.querySelectorAll('.seg')) placePill(sg, false); });
}
darkMq.addEventListener?.('change', () => applyAppearance(true));

/** Remote's FluidSeg: the active option is marked by a pill that slides on the spring; its label blurs briefly. */
function placePill(sg, animate) {
  const pill = sg.querySelector(':scope > .pill');
  if (!pill) return;
  const on = sg.querySelector(':scope > button[aria-pressed="true"], :scope > button[aria-selected="true"]');
  if (!on || !on.offsetWidth) { pill.hidden = !on; return; }
  pill.hidden = false;
  pill.classList.toggle('go', !!animate && !reduced());
  pill.style.width = on.offsetWidth + 'px';
  pill.style.transform = `translateX(${on.offsetLeft}px)`;
  if (animate && !reduced()) on.animate([{ filter: 'blur(0px)' }, { filter: 'blur(3px)' }, { filter: 'blur(0px)' }], { duration: 280, easing: 'ease-out' });
}

/* ================= identity, colour, time ================= */
function hue(id) {
  let x = 2166136261;
  const s = String(id || '');
  for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); }
  return (x >>> 0) % 360;
}
const isHuman = (id) => String(id || '').startsWith('human:');
const who = (id) => (id == null ? 'someone' : isHuman(id) ? String(id).slice(6) : '@' + id);
function initials(id) {
  const n = isHuman(id) ? String(id).slice(6) : String(id || '?');
  const p = n.split(/[-_\s.@]+/).filter(Boolean);
  return ((p[0]?.[0] || '?') + (p[1]?.[0] || '')).toUpperCase();
}
function avatar(id, size = 'sm') {
  const a = h('span', `av av-${size}`, initials(id));
  if (isHuman(id)) a.classList.add('human');
  a.style.setProperty('--h', hue(id));
  a.title = who(id);
  return a;
}
function agentChip(id) {
  const c = h('span', 'achip');
  c.style.setProperty('--h', hue(id));
  c.append(avatar(id, 'xs'), h('span', null, who(id)));
  return c;
}
function refBtn(id, done) {
  const b = h('button', 'ref' + (done ? ' done' : ''), '#' + id);
  b.type = 'button'; b.dataset.task = id;
  return b;
}
const srvNow = () => Date.now() + S.skew;
function rel(t) {
  if (!t) return '';
  const s = Math.max(0, Math.round((srvNow() - t) / 1000));
  if (s < 5) return 'now';
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60); if (m < 60) return m + 'm';
  const hr = Math.floor(m / 60); if (hr < 24) return hr + 'h';
  const d = Math.floor(hr / 24); if (d < 30) return d + 'd';
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function until(t) {
  const s = Math.round((t - srvNow()) / 1000);
  if (s <= 0) return 'expiring';
  if (s < 60) return `in ${s}s`;
  const m = Math.round(s / 60); return m < 60 ? `in ${m}m` : `in ${Math.round(m / 60)}h`;
}
function timeEl(t, cls) {
  const e = h('time', cls || null, rel(t));
  if (t) { e.dataset.ts = t; e.dateTime = new Date(t).toISOString(); e.title = new Date(t).toLocaleString(); }
  return e;
}
const agoText = (t) => { const r = rel(t); return r === 'now' ? 'just now' : `${r} ago`; };
function timeAgo(t) { const e = timeEl(t); e.dataset.ago = '1'; e.textContent = agoText(t); return e; }
function clockEl(t) {
  const d = new Date(t);
  const e = h('time', null, d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }));
  e.dateTime = d.toISOString(); e.title = d.toLocaleString();
  return e;
}
/** Text with @mentions and #task refs, built from text nodes only. */
function richText(el, text) {
  el.textContent = '';
  const s = String(text ?? '');
  const re = /(?<![\w@])@([a-z0-9][a-z0-9-]{0,40})|(?<![\w&])#(\d{1,7})\b/gi;
  let last = 0; let m;
  while ((m = re.exec(s))) {
    if (m.index > last) el.append(s.slice(last, m.index));
    if (m[1]) { const sp = h('span', 'mention', '@' + m[1]); sp.style.setProperty('--h', hue(m[1].toLowerCase())); el.append(sp); }
    else el.append(refBtn(m[2], S.taskById.get(Number(m[2]))?.status === 'done'));
    last = re.lastIndex;
  }
  if (last < s.length) el.append(s.slice(last));
}

/* ================= path overlap (mirror of core.js) ================= */
const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/\/+$/, '').replace(/\/{2,}/g, '/');
const hasGlob = (p) => /[*?[]/.test(p);
const staticPrefix = (p) => { const i = p.search(/[*?[]/); return i < 0 ? p : p.slice(0, i); };
const reCache = new Map();
function globRe(g) {
  let r = reCache.get(g); if (r) return r;
  let s = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') { if (g[i + 1] === '*') { i++; if (g[i + 1] === '/') { i++; s += '(?:.*/)?'; } else s += '.*'; } else s += '[^/]*'; }
    else if (c === '?') s += '[^/]';
    else s += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  try { r = new RegExp(`^${s}(?:/.*)?$`, 'i'); } catch { r = /^$/; }
  reCache.set(g, r); return r;
}
function overlaps(a, b) {
  a = norm(a).toLowerCase(); b = norm(b).toLowerCase();
  if (!a || !b || a === '**' || b === '**' || a === '*' || b === '*') return true;
  const ga = hasGlob(a), gb = hasGlob(b);
  const under = (x, y) => x === y || x.startsWith(y + '/');
  if (!ga && !gb) return under(a, b) || under(b, a);
  if (ga && !gb) return globRe(a).test(b) || under(staticPrefix(a).replace(/\/$/, ''), b) || globRe(a).test(b + '/x');
  if (!ga && gb) return overlaps(b, a);
  const pa = staticPrefix(a), pb = staticPrefix(b);
  return pa.startsWith(pb) || pb.startsWith(pa);
}

/* ================= state ================= */
const S = {
  me: null, project: null, data: null, skew: 0,
  taskById: new Map(), agentById: new Map(),
  tab: 'channel', doneOpen: false, offOpen: false, onlyQ: false, fileSort: 'recent',
  replyTo: null, conn: 'connecting', everLive: false,
  recentTouch: new Map(), // path -> Map(agent -> t), from live edit/touch events
  boardRendered: false,
};

/* ================= API ================= */
class AuthError extends Error {}
async function api(path, body) {
  const opts = { credentials: 'same-origin', headers: { Accept: 'application/json' } };
  if (body !== undefined) {
    opts.method = 'POST';
    opts.headers['Content-Type'] = 'application/json';
    opts.headers['X-SB'] = '1';
    opts.body = JSON.stringify(body);
  }
  let res;
  try { res = await fetch(path, opts); } catch { throw new Error('Can’t reach the Switchboard server.'); }
  let j = null;
  try { const t = await res.text(); j = t ? JSON.parse(t) : null; } catch { j = null; }
  if (res.status === 401) { showGate('signin'); throw new AuthError('sign in required'); }
  if (res.status === 403 && (j?.code === 'not_allowlisted' || j?.error === 'not_allowlisted')) { showGate('denied'); throw new AuthError('not allowlisted'); }
  if (!res.ok) throw new Error(j?.error || `${res.status} ${res.statusText}`);
  return j;
}
const canEdit = () => !!S.me && S.me.role !== 'viewer';
const ghMode = () => S.me?.mode === 'github' || S.data?.mode === 'github';
const isAdmin = () => !!S.me && (S.me.role === 'admin' || S.me.role === 'owner');
const myName = () => S.me?.name || (S.me?.email ? S.me.email.split('@')[0] : 'human');
function baseUrl() {
  if (S.me?.public_url) return String(S.me.public_url).replace(/\/+$/, '') + (S.me.base || '/');
  return location.origin + location.pathname.replace(/[^/]*$/, '');
}
const stateUrl = () => 'api/state' + (S.project ? '?project=' + encodeURIComponent(S.project) : '');

/* ================= toast ================= */
let toastTimer = 0;
function toast(msg, err = false) {
  const t = $('#toast');
  t.textContent = msg; t.classList.toggle('err', err);
  t.hidden = false; t.classList.add('out');
  void t.offsetWidth; t.classList.remove('out');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.classList.add('out'); toastTimer = setTimeout(() => { t.hidden = true; }, 200); }, err ? 4200 : 2400);
}
const fail = (e) => { if (!(e instanceof AuthError)) toast(e.message || String(e), true); };

/* ================= popover ================= */
const pop = $('#pop');
let popAnchor = null; let popHideT = 0;
function openPop(anchor, build, { align = 'right' } = {}) {
  if (popAnchor === anchor) { closePop(); return; }
  closePop(true);
  clearTimeout(popHideT);
  pop.replaceChildren();
  build(pop);
  pop.hidden = false; pop.classList.add('out');
  pop.style.left = '0px'; pop.style.top = '0px';
  const r = anchor.getBoundingClientRect();
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  const left = clamp(align === 'right' ? r.right - pw : r.left, 8, innerWidth - pw - 8);
  let top = r.bottom + 6; let oy = 'top';
  if (top + ph > innerHeight - 8 && r.top - ph - 6 > 8) { top = r.top - ph - 6; oy = 'bottom'; }
  pop.style.left = left + 'px'; pop.style.top = clamp(top, 8, Math.max(8, innerHeight - ph - 8)) + 'px';
  pop.style.setProperty('--origin', `${align === 'right' ? 'right' : 'left'} ${oy}`);
  popAnchor = anchor; anchor.setAttribute('aria-expanded', 'true');
  requestAnimationFrame(() => pop.classList.remove('out'));
  const f = pop.querySelector('textarea, input, button'); f?.focus({ preventScroll: true });
}
function closePop(instant) {
  if (popAnchor) { popAnchor.setAttribute('aria-expanded', 'false'); popAnchor = null; }
  if (pop.hidden) return;
  if (instant || reduced()) { pop.hidden = true; return; }
  pop.classList.add('out');
  clearTimeout(popHideT);
  popHideT = setTimeout(() => { if (!popAnchor) pop.hidden = true; }, 120);
}
function popItem(label, onClick, { iconName, checked, cls, data } = {}) {
  const b = h('button', 'item' + (cls ? ' ' + cls : ''));
  b.type = 'button'; b.setAttribute('role', 'menuitem');
  if (data) Object.assign(b.dataset, data);
  if (iconName) b.append(icon(iconName, 15));
  if (data?.s) b.append(h('span', 'cdot'));
  b.append(h('span', null, label));
  if (checked) b.append(icon('check', 14));
  b.addEventListener('click', onClick);
  return b;
}
function seg(values, current, onPick, labelFn = (v) => v) {
  const s = h('div', 'seg');
  s.append(h('span', 'pill'));
  for (const v of values) {
    const b = h('button', null, labelFn(v)); b.type = 'button';
    b.setAttribute('aria-pressed', String(v === current));
    b.addEventListener('click', () => {
      for (const x of s.querySelectorAll(':scope > button')) x.setAttribute('aria-pressed', 'false');
      b.setAttribute('aria-pressed', 'true'); placePill(s, true); onPick(v);
    });
    s.append(b);
  }
  requestAnimationFrame(() => placePill(s, false));
  return s;
}

/* ================= drawer ================= */
const drawer = $('#drawer');
let drawerT = 0; let drawerReturn = null;
function openDrawer(title, build) {
  clearTimeout(drawerT);
  closePop(true);
  setText($('#drawer-title'), title);
  const body = $('#drawer-body'); body.replaceChildren(); build(body);
  drawerReturn = document.activeElement;
  drawer.hidden = false; drawer.classList.add('out');
  void drawer.offsetWidth; drawer.classList.remove('out');
  setTimeout(() => body.querySelector('input, button, select')?.focus({ preventScroll: true }), 40);
}
function closeDrawer() {
  if (drawer.hidden) return;
  drawer.classList.add('out');
  clearTimeout(drawerT);
  drawerT = setTimeout(() => { drawer.hidden = true; $('#drawer-body').replaceChildren(); }, reduced() ? 0 : 230);
  drawerReturn?.focus?.({ preventScroll: true });
}

/* ================= feeds (keyed, capped, ordered) ================= */
class Feed {
  constructor(el, { desc = false, cap = 500 } = {}) { this.el = el; this.desc = desc; this.cap = cap; this.nodes = new Map(); this.floor = -Infinity; }
  reset() { this.el.replaceChildren(); this.nodes.clear(); this.floor = -Infinity; }
  get(k) { return this.nodes.get(k); }
  insert(k, sk, node) {
    if (this.nodes.has(k) || sk < this.floor) return null;
    node._sk = sk; node._k = k; this.nodes.set(k, node);
    if (!this.desc) {
      let after = this.el.lastElementChild;
      while (after && after._sk > sk) after = after.previousElementSibling;
      if (after) after.after(node); else this.el.prepend(node);
    } else {
      let before = this.el.firstElementChild;
      while (before && before._sk > sk) before = before.nextElementSibling;
      this.el.insertBefore(node, before);
    }
    while (this.nodes.size > this.cap) {
      const old = this.desc ? this.el.lastElementChild : this.el.firstElementChild;
      if (!old) break;
      this.floor = Math.max(this.floor, old._sk);
      this.nodes.delete(old._k); old.remove();
    }
    return node;
  }
}
const feed = new Feed($('#feed'), { cap: 500 });
const activity = new Feed($('#activity'), { desc: true, cap: 500 });

const CHANNEL_EVENTS = new Set(['agent.join', 'agent.rejoin', 'agent.leave', 'agent.offline', 'agent.released', 'task.plan', 'task.take',
  'task.done', 'task.blocked', 'task.review', 'task.open', 'task.dropped', 'claim', 'commit', 'push', 'pr', 'newfile', 'newfile.blocked', 'baseline',
  'github.merge', 'github.pr', 'github.push', 'github.release', 'project.link', 'files.changed', 'github.issue', 'github.error', 'github.sync']);
const GITHUB_EVENTS = new Set(['github.merge', 'github.pr', 'github.push', 'github.release', 'github.issue', 'github.error', 'github.sync']);

function list(arr, n = 3) {
  const a = (arr || []).filter(Boolean).map(String);
  return a.length <= n ? a.join(', ') : `${a.slice(0, n).join(', ')} +${a.length - n}`;
}
function eventText(e) {
  const d = e.data || {}; const w = who(e.agent);
  const t = d.id ? `#${d.id}${d.title ? ' ' + d.title : ''}` : '';
  switch (e.type) {
    case 'agent.join': return `${w} joined${d.branch ? ' on ' + d.branch : ''}${d.host ? ' · ' + d.host : ''}`;
    case 'agent.rejoin': return `${w} is back${d.branch ? ' on ' + d.branch : ''}`;
    case 'agent.leave': return `${w} left${d.reason ? ' (' + d.reason + ')' : ''}`;
    case 'agent.offline': return `${w} went offline`;
    case 'agent.released': return `${w}’s claims were released${d.tasks?.length ? '; reopened ' + d.tasks.map((x) => '#' + x).join(' ') : ''}`;
    case 'agent.status': return `${w} is ${d.doing || 'working'}`;
    case 'task.plan': return `${w} planned ${d.ids?.length || 0} task${d.ids?.length === 1 ? '' : 's'}${d.ids?.length ? ': ' + d.ids.slice(0, 6).map((x) => '#' + x).join(' ') : ''}`;
    case 'task.take': return `${w} took ${t}${d.from ? ' from @' + d.from : ''}`;
    case 'task.done': return `${w} finished ${t}`;
    case 'task.blocked': return `${w} marked ${t} blocked${d.note ? ' — ' + d.note : ''}`;
    case 'task.review': return `${w} sent ${t} to review`;
    case 'task.open': return `${w} reopened ${t}`;
    case 'task.dropped': return `${w} dropped ${t}`;
    case 'task.taken': return `${w} set ${t} in progress`;
    case 'task.update': return `${w} updated ${t}${d.note ? ' — ' + d.note : ''}`;
    case 'claim': return `${w} claimed ${list(d.paths)}${d.task_id ? ' for #' + d.task_id : ''}${d.forced ? ' (forced)' : ''}`;
    case 'release': return `${w} released ${d.count || ''} claim${d.count === 1 ? '' : 's'}${d.task_id ? ' of #' + d.task_id : ''}`;
    case 'touch': case 'edit': return `${w} edited ${list(d.paths || (d.path ? [d.path] : []))}`;
    case 'newfile': return `${w} created a new file ${d.path || ''}`;
    case 'newfile.blocked': return `${w} was stopped from creating ${d.path || 'a file'}${d.similar?.length ? ' — similar: ' + list(d.similar, 2) : ''}`;
    case 'commit': return `${w} committed${d.message ? ' “' + String(d.message).split('\n')[0] + '”' : ''}`;
    case 'push': return `${w} pushed${d.branch ? ' ' + d.branch : ''}${d.commits ? ` (${d.commits} commit${d.commits === 1 ? '' : 's'})` : ''}`;
    case 'pr': return `${w} opened a pull request${d.title ? ' “' + d.title + '”' : ''}${d.number ? ' (PR ' + d.number + ')' : ''}`;
    case 'contract.new': return `${w} proposed contract “${d.name || ''}”`;
    case 'contract.update': return `${w} updated contract “${d.name || ''}” → ${d.status || ''} v${d.version || ''}`;
    case 'baseline': return `${w} registered ${d.files || 0} files as the baseline`;
    case 'github.merge': case 'github.pr': case 'github.push': case 'github.release': {
      const actor = d.actor ? String(d.actor) : 'GitHub';
      const verb = { 'github.merge': 'merged', 'github.pr': 'opened a pull request', 'github.push': 'pushed', 'github.release': 'released' }[e.type];
      const sha = d.sha ? String(d.sha).slice(0, 7) : '';
      return `${actor} ${verb}${d.title ? ' “' + String(d.title).split('\n')[0] + '”' : ''}${d.ref ? ' → ' + String(d.ref).replace(/^refs\/heads\//, '') : ''}${sha ? ' · ' + sha : ''}`;
    }
    case 'files.changed': {
      const roots = (d.roots || []).map((r) => (String(r).startsWith('@') ? String(r) : '@' + r));
      return `${w} · +${d.add || 0} ~${d.change || 0} −${d.delete || 0}${roots.length ? ' in ' + list(roots, 3) : ''}`;
    }
    case 'github.issue': return `Task #${d.task ?? '?'} opened as issue #${d.issue ?? '?'}`;
    case 'github.error': return `GitHub sync problem: ${d.message || 'unknown error'}`;
    case 'github.sync': return `Synced ${d.issues ?? 0} issue${d.issues === 1 ? '' : 's'} with GitHub`;
    case 'project.link': return `Project linked to ${d.main_repo || 'its main repo'}${d.ref ? ' · ' + d.ref : ''}`;
    default: return `${w} ${e.type}`;
  }
}

function nearBottom(el) { return el.scrollHeight - el.scrollTop - el.clientHeight < 80; }
function withFeed(fn, { force = false } = {}) {
  const el = feed.el;
  const stick = force || nearBottom(el);
  const before = feed.nodes.size;
  fn();
  if (stick) { el.scrollTop = el.scrollHeight; $('#jump').hidden = true; }
  else if (feed.nodes.size !== before) $('#jump').hidden = false;
}

function msgNode(m) {
  const n = h('div', 'msg');
  const human = isHuman(m.sender);
  n._sender = m.sender; n._kind = m.kind; n._to = m.recipient || '';
  n.dataset.kind = m.kind;
  if (human) n.classList.add('from-human');
  if (m.recipient) n.classList.add('dm');
  n.append(avatar(m.sender, 'md'));
  const b = h('div', 'm-body');
  const head = h('div', 'm-head');
  const w = h('span', 'm-who', who(m.sender)); w.style.setProperty('--h', hue(m.sender));
  head.append(w);
  if (m.kind && m.kind !== 'chat') { const bd = h('span', 'badge', m.kind); bd.dataset.k = m.kind; head.append(bd); }
  if (m.recipient) head.append(h('span', 'm-to', '→ ' + (m.recipient === 'humans' ? 'humans' : '@' + m.recipient)));
  if (m.task_id) head.append(refBtn(m.task_id));
  if (m.file) { const fc = h('span', 'm-file', String(m.file)); fc.title = String(m.file); head.append(fc); n._file = norm(m.file); }
  head.append(timeEl(m.created_at));
  const tx = h('div', 'm-text'); richText(tx, m.body);
  b.append(head, tx);
  if (m.kind === 'question') {
    const act = h('div', 'm-actions'); act.dataset.edit = '';
    const ans = h('button', 'btn sm', 'Answer'); ans.type = 'button';
    ans.dataset.reply = m.id;
    act.append(ans); b.append(act); n._act = act;
  }
  n.append(b);
  return n;
}
function updateMsg(n, m) {
  const open = m.kind === 'question' && !m.resolved;
  n.classList.toggle('q-open', open);
  if (n._act) n._act.hidden = !open;
}
function addMessage(m, animate) {
  const k = 'm' + m.id;
  const ex = feed.get(k);
  if (ex) { updateMsg(ex, m); return; }
  const n = msgNode(m);
  updateMsg(n, m);
  if (n._file && S.area && !areaMatch(n._file)) n.hidden = true;
  if (!feed.insert(k, m.created_at, n)) return;
  const prev = n.previousElementSibling;
  if (prev && prev._sender === m.sender && prev._kind === 'chat' && m.kind === 'chat' && prev._to === (m.recipient || '') && m.created_at - prev._sk < 180000) n.classList.add('cont');
  if (animate && !reduced()) n.classList.add('enter');
}
function addEvent(e, animate) {
  if (!e.id) return;
  if (CHANNEL_EVENTS.has(e.type)) {
    const n = h('div', 'sys'); n.dataset.t = e.type;
    if (e.type === 'newfile.blocked' || e.type === 'github.error') n.classList.add('warn');
    const gh = GITHUB_EVENTS.has(e.type);
    const fc = e.type === 'files.changed';
    if (gh) { n.classList.add('gh'); n.append(icon('merge', 13)); }
    if (fc) { n.classList.add('gh', 'fc'); n.append(icon('folder', 13)); }
    const tx = h('span', 's-text'); if (gh || fc) tx.textContent = eventText(e); else richText(tx, eventText(e)); tx.title = tx.textContent;
    if (fc && (e.data?.sample || []).length) {
      const wrap = h('span', 's-wrap'); wrap.append(tx);
      const sm = h('span', 's-sub', (e.data.sample || []).slice(0, 6).map(String).join('  ')); sm.title = (e.data.sample || []).join('\n');
      wrap.append(sm); n.append(wrap, timeEl(e.created_at));
    } else n.append(tx, timeEl(e.created_at));
    if (feed.insert('e' + e.id, e.created_at, n) && animate && !reduced()) n.classList.add('enter');
  }
  if (!activity.get('e' + e.id)) {
    const r = h('div', 'row');
    if (GITHUB_EVENTS.has(e.type)) { const g = h('span', 'gh-av'); g.append(icon('merge', 12)); r.append(clockEl(e.created_at), g); }
    else r.append(clockEl(e.created_at), avatar(e.agent || 'switchboard', 'xs'));
    const tx = h('span', 's-text'); tx.append(h('span', 'tp', e.type));
    const rest = h('span');
    if (e.type === 'files.changed') { rest.textContent = eventText(e); if ((e.data?.sample || []).length) rest.append(h('span', 's-sub', (e.data.sample || []).slice(0, 6).map(String).join('  '))); }
    else richText(rest, eventText(e));
    tx.append(rest);
    r.append(tx);
    if (activity.insert('e' + e.id, e.created_at + (typeof e.id === 'number' ? (e.id % 1000) / 1000 : 0), r) && animate && !reduced()) r.classList.add('enter');
  }
}
function renderFeeds(st, animate) {
  withFeed(() => {
    for (const m of st.messages || []) addMessage(m, animate);
    for (const e of st.events || []) addEvent(e, animate);
  });
  const open = (st.messages || []).filter((m) => m.kind === 'question' && !m.resolved).length;
  $('#qbar').hidden = !open && !S.onlyQ;
  setText($('#qfilter'), S.onlyQ ? `Showing ${open} open question${open === 1 ? '' : 's'} · Show all` : `${open} open question${open === 1 ? '' : 's'}`);
}

/* ================= header ================= */
function startOfDay() { const d = new Date(srvNow()); d.setHours(0, 0, 0, 0); return d.getTime(); }
function renderHeader(st) {
  const live = st.agents.filter((a) => a.status !== 'offline').length;
  setFlaps($('#st-live'), live);
  setFlaps($('#st-prog'), st.tasks.filter((t) => t.status === 'taken').length);
  const sod = startOfDay();
  setFlaps($('#st-done'), st.tasks.filter((t) => t.status === 'done' && (t.done_at || 0) >= sod).length);
  const p = st.protocol; const el = $('#protocol');
  if (p && p.sha) {
    const pj = p.project || null;
    const sig = JSON.stringify([p.sha, p.source, p.updated_at, pj]);
    if (el._sig !== sig) {
      el._sig = sig; el.replaceChildren();
      el.append(h('span', null, 'Intro'), h('b', null, String(p.sha).slice(0, 7)));
      if (pj?.sha) el.append(h('span', null, '+'), h('b', null, String(pj.sha).slice(0, 7)));
      else if (p.source) el.append(h('span', null, '· ' + String(p.source).replace(/^https?:\/\//, '')));
      el.classList.toggle('warn', !!pj?.error);
      const when = (t) => (t ? new Date(t).toLocaleString() : 'unknown');
      const lines = ['Agent intro prompt', '', `Universal: ${p.source || '—'} @ ${String(p.sha).slice(0, 12)}`, `  updated ${when(p.updated_at)}${p.error ? '\n  error: ' + p.error : ''}`];
      if (pj) {
        lines.push('', `Project rules: ${pj.repo || '—'}${pj.path ? '/' + pj.path : ''}${pj.ref ? ' (' + pj.ref + ')' : ''}`);
        lines.push(pj.error ? `  error: ${pj.error}` : `  @ ${pj.sha ? String(pj.sha).slice(0, 12) : 'not fetched yet'}`);
      } else lines.push('', 'Project rules: none (no main repo linked)');
      el.title = lines.join('\n');
      el.hidden = false;
    }
  } else { el.hidden = true; }
  const pi = st.project_info; const mr = $('#main-repo');
  const msig = `${pi?.main_repo}|${pi?.main_ref}|${isAdmin() && !ghMode()}|${S.project}`;
  if (mr._sig !== msig) {
    mr._sig = msig; mr.replaceChildren();
    const canLink = isAdmin() && !ghMode();
    mr.classList.toggle('static', !canLink);
    mr.classList.toggle('link', !pi?.main_repo);
    if (pi?.main_repo) {
      mr.append(icon('branch', 12), h('span', null, `${pi.main_repo} · ${pi.main_ref || 'main'}`));
      mr.title = `Main repo: ${pi.main_repo} (${pi.main_ref || 'default branch'})${isAdmin() ? '\nClick to change it or refresh the intro' : ''}`;
      mr.hidden = false;
    } else if (canLink && S.project) {
      mr.append(icon('plus', 12), h('span', null, 'Link main repo'));
      mr.title = 'Link this project to its main repo so its .switchboard/INTRO.md reaches every agent';
      mr.hidden = false;
    } else mr.hidden = true;
  }
}
function renderProjects(st) {
  const sel = $('#project');
  const projects = (st.projects || []).slice();
  if (S.project && !projects.some((p) => p.id === S.project)) projects.push({ id: S.project, name: S.project, live: 0, open_tasks: 0 });
  const sig = projects.map((p) => `${p.id}:${p.live}`).join('|');
  if (sel._sig !== sig) {
    sel._sig = sig; sel.replaceChildren();
    if (!projects.length) sel.append(h('option', null, 'No projects yet'));
    for (const p of projects) {
      const o = h('option', null, `${p.name || p.id}${p.live ? ` · ${p.live} live` : ''}`);
      o.value = p.id; sel.append(o);
    }
  }
  if (S.project) sel.value = S.project;
}
function setConn(state) {
  S.conn = state;
  const el = $('#conn'); el.dataset.state = state;
  setText(el.querySelector('span'), { live: 'Live', reconnecting: 'Reconnecting…', connecting: 'Connecting…', offline: 'Offline' }[state] || state);
  el.title = state === 'live' ? 'Receiving live updates' : 'Live updates paused — retrying';
}
function renderMe() {
  const b = $('#me');
  if (!S.me) { b.hidden = true; return; }
  b.hidden = false; b.replaceChildren();
  const id = 'human:' + myName();
  b.append(avatar(id, 'sm'), h('span', 'me-name', myName()));
  b.setAttribute('aria-label', `Account: ${myName()}`);
  document.body.classList.toggle('viewer', !canEdit());
  document.body.classList.toggle('gh-mode', ghMode());
}

/* ================= roster ================= */
const rosterNodes = new Map();
function presence(a) {
  if (a.status === 'offline') return 'offline';
  return srvNow() - (a.last_seen || 0) < (S.data?.cfg?.idleMs || 180000) ? 'active' : 'idle';
}
function makeAgentNode(a) {
  const n = h('div', 'agent');
  const av = h('span', 'av' + (isHuman(a.id) ? ' human' : ''));
  av.style.setProperty('--h', hue(a.id));
  n.style.setProperty('--h', hue(a.id));
  const ini = h('span', null, initials(a.id));
  const ring = h('span', 'ring'); const dot = h('span', 'dot');
  av.append(ini, ring, dot);
  const body = h('div', 'a-body');
  const l1 = h('div', 'a-l1');
  const handle = h('span', 'a-handle', '@' + a.id);
  let wtag = null;
  if (a.kind === 'watcher') {
    n.classList.add('watcher');
    const tag = h('span', 'w-tag'); tag.append(icon('eye', 11), h('span', null, 'watcher'));
    tag.title = 'File watcher: reports adds, changes and deletes in mapped @roots';
    wtag = tag;
  }
  const human = h('span', 'a-human');
  const time = timeEl(a.last_seen);
  l1.append(handle);
  if (wtag) l1.append(wtag);
  l1.append(human, time);
  const doing = h('div', 'a-doing');
  const meta = h('div', 'a-meta');
  const wsChips = h('div', 'a-ws');
  body.append(l1, doing, meta, wsChips);
  n.append(av, body);
  Object.assign(n, { _ring: ring, _human: human, _time: time, _doing: doing, _meta: meta, _ws: wsChips });
  return n;
}
function updateAgentNode(n, a) {
  n.dataset.p = presence(a);
  setText(n._human, a.human || '');
  n._time.dataset.ts = a.last_seen || ''; setText(n._time, rel(a.last_seen));
  const doingText = a.doing || (a.last_file ? a.last_file : (a.status === 'offline' ? 'Offline' : a.kind === 'watcher' ? 'Watching mapped roots' : 'Getting started'));
  setText(n._doing, doingText);
  n._doing.classList.toggle('file', !a.doing && !!a.last_file);
  n._doing.title = doingText;
  n.title = `@${a.id}${a.human ? ' (' + a.human + ')' : ''} — ${doingText}`;
  const sig = `${a.task_id}|${a.branch}|${a.host}|${a.edits}|${a.model}`;
  if (n._msig !== sig) {
    n._msig = sig; n._meta.replaceChildren();
    if (a.task_id) { const s = h('span'); s.append(refBtn(a.task_id)); n._meta.append(s); }
    if (a.branch) { const s = h('span', 'branch'); s.title = a.branch; s.append(icon('branch', 12), h('b', null, a.branch)); n._meta.append(s); }
    if (a.host) n._meta.append(h('span', null, a.host));
    if (a.edits) n._meta.append(h('span', null, `${a.edits} edit${a.edits === 1 ? '' : 's'}`));
  }
}
function renderRoster(st) {
  const rank = { active: 0, idle: 1, offline: 2 };
  const isW = (a) => (a.kind === 'watcher' ? 1 : 0);
  const agents = st.agents.slice().sort((x, y) => (isW(x) - isW(y)) || (rank[presence(x)] - rank[presence(y)]) || ((x.joined_at || 0) - (y.joined_at || 0)) || String(x.id).localeCompare(y.id));
  const live = agents.filter((a) => a.status !== 'offline');
  const off = agents.filter((a) => a.status === 'offline');
  const seen = new Set();
  const place = (container, arr) => {
    arr.forEach((a, i) => {
      let n = rosterNodes.get(a.id);
      if (!n) { n = makeAgentNode(a); rosterNodes.set(a.id, n); }
      updateAgentNode(n, a); seen.add(a.id);
      if (container.children[i] !== n) container.insertBefore(n, container.children[i] || null);
    });
    while (container.children.length > arr.length) container.lastElementChild.remove();
  };
  const wsOf = new Map();
  for (const w of st.workstreams || []) for (const a of w.agents || []) (wsOf.get(a) || wsOf.set(a, []).get(a)).push(w);
  for (const a of agents) {
    let n = rosterNodes.get(a.id); if (!n) { n = makeAgentNode(a); rosterNodes.set(a.id, n); }
    const ws = wsOf.get(a.id) || [];
    const sig = ws.map((w) => w.name + ':' + w.nature).join('|') + '|' + S.area;
    if (n._wsSig !== sig) {
      n._wsSig = sig; n._ws.replaceChildren();
      for (const w of ws.slice(0, 3)) {
        const c = h('button', 'ws-chip' + (w.named ? '' : ' mono'), w.name); c.type = 'button'; c.dataset.area = w.name; c.dataset.nature = w.nature || 'code';
        c.title = `Working in ${w.name} — click to focus Files and notes on it`; c.setAttribute('aria-pressed', String(S.area === w.name));
        n._ws.append(c);
      }
      if (ws.length > 3) n._ws.append(h('span', 'more', `+${ws.length - 3}`));
    }
  }
  place($('#roster-live'), live);
  place($('#roster-off'), S.offOpen ? off : []);
  for (const [id, n] of rosterNodes) if (!seen.has(id)) { n.remove(); rosterNodes.delete(id); }
  $('#roster-empty').hidden = agents.length > 0;
  const tg = $('#offline-toggle');
  tg.hidden = !off.length;
  if (off.length) {
    const sig = `${off.length}|${S.offOpen}`;
    if (tg._sig !== sig) { tg._sig = sig; const sp = h('span', null, `Offline · ${off.length}`); sp.dataset.n = off.length; tg.replaceChildren(icon('chevron', 12), sp); tg.setAttribute('aria-expanded', String(S.offOpen)); }
  }
  $('#roster-off').hidden = !S.offOpen;
  setText($('#roster-count'), live.length ? `${live.length} live` : '');
}
function pulseAgent(id) {
  const rings = [];
  const n = rosterNodes.get(id); if (n) rings.push(n._ring);
  for (const r of wsAvRings.get(id) || []) if (r.isConnected) rings.push(r);
  for (const ring of rings) {
    for (const an of ring.getAnimations()) an.cancel();
    ring.animate(reduced()
      ? [{ opacity: 0.8 }, { opacity: 0 }]
      : [{ opacity: 0.9, transform: 'scale(0.9)' }, { opacity: 0, transform: 'scale(1.3)' }], { duration: 900, easing: EASE_OUT });
  }
}

/* ================= workstreams (auto-grouped by what is being worked on) ================= */
S.centerView = 'streams'; S.area = null;
const wsNodes = new Map(); const wsAvRings = new Map();
let wsSkel = null;
const NATURE_LABEL = { feature: 'feature', fix: 'fix', tests: 'tests', docs: 'docs', refactor: 'refactor', performance: 'perf', assets: 'assets', config: 'config', tooling: 'tooling', code: 'code' };
function setCenterView(v, remember) {
  S.centerView = v === 'status' ? 'status' : 'streams';
  if (remember) store.set('sb.centerView', S.centerView);
  for (const b of $('#view-seg').querySelectorAll('[data-cv]')) b.setAttribute('aria-selected', String(b.dataset.cv === S.centerView));
  placePill($('#view-seg'), !!remember);
  $('#streams').hidden = S.centerView !== 'streams';
  $('#cols').hidden = S.centerView !== 'status';
  if (S.data) { renderBoard(S.data); renderStreams(S.data); }
}
function resetStreams() { wsNodes.clear(); wsAvRings.clear(); wsSkel = null; $('#streams').replaceChildren(); }
const streamByName = (n) => (S.data?.workstreams || []).find((w) => w.name === n);
/** Longest workstream name that is a path prefix of p (named areas fall back to the next state refresh). */
function streamForPath(p) {
  p = norm(p); let best = null;
  for (const w of S.data?.workstreams || []) {
    if (w.named) continue;
    const n = norm(w.name);
    if ((p === n || p.startsWith(n + '/')) && (!best || n.length > best.length)) best = n;
  }
  return best;
}
function flashStream(name) {
  if (!name) return;
  const n = wsNodes.get(name); if (!n || !n.isConnected) return;
  const f = n._flash; for (const a of f.getAnimations()) a.cancel();
  f.animate([{ opacity: 1 }, { opacity: 0 }], { duration: reduced() ? 400 : 1200, easing: EASE_OUT });
}
/** Does path p fall in the selected area? Path-like streams: prefix. Named areas: their tasks' areas and reserved paths. */
function areaMatch(p) {
  if (!S.area) return true;
  p = norm(p);
  const w = streamByName(S.area);
  if (!w || !w.named) { const n = norm(S.area); return p === n || p.startsWith(n + '/'); }
  const pats = [];
  for (const t of w.tasks || []) for (const a of S.taskById.get(t.id)?.area || []) pats.push(a);
  for (const r of w.reserved || []) pats.push(r.path);
  return pats.some((pt) => overlaps(pt, p));
}
function setArea(name) {
  S.area = name || null;
  const bar = $('#area-bar');
  bar.hidden = !S.area; bar.replaceChildren();
  if (S.area) {
    const pill = h('button', 'area-pill'); pill.type = 'button';
    pill.append(h('span', null, 'Showing '), h('b', streamByName(S.area)?.named ? null : 'mono', S.area), icon('close', 12));
    pill.title = 'Show everything again';
    pill.addEventListener('click', () => setArea(null));
    bar.append(pill);
  }
  for (const n of feed.nodes.values()) if (n._file) n.hidden = !!S.area && !areaMatch(n._file);
  for (const [k, n] of wsNodes) { n.classList.toggle('selected', k === S.area); n.setAttribute('aria-pressed', String(k === S.area)); }
  if (S.data) { if (filesSkel) renderFiles(S.data, true); renderRoster(S.data); }
  if (S.area && S.tab !== 'files' && S.tab !== 'channel') setTab('files');
  requestAnimationFrame(() => moveTabInd(false));
}
function wsSkeleton() {
  const root = $('#streams'); root.replaceChildren();
  const mk = (cls, title) => { const sec = h('section', 'ws-sec ' + cls); const hd = h('h3', 'ws-sec-head'); const t = h('span', null, title); const c = h('span', 'count'); hd.append(t, c); const g = h('div', 'ws-grid'); sec.append(hd, g); sec._count = c; sec._grid = g; root.append(sec); return sec; };
  const active = mk('ws-active', 'Being worked on');
  const idle = mk('ws-idle', 'Open work nobody is on');
  const quiet = h('section', 'ws-sec ws-quiet');
  const qt = h('button', 'group-toggle'); qt.type = 'button'; qt.setAttribute('aria-expanded', 'false');
  const qg = h('div', 'ws-grid'); qg.hidden = true;
  qt.addEventListener('click', () => { const o = qg.hidden; qg.hidden = !o; qt.setAttribute('aria-expanded', String(o)); });
  quiet.append(qt, qg); quiet._toggle = qt; quiet._grid = qg; root.append(quiet);
  const empty = h('div', 'f-onboard ws-empty');
  empty.append(h('b', null, 'Nothing to group yet'));
  empty.append(h('p', null, 'Workstreams form on their own from what people and agents touch: files edited, paths claimed and the areas on tasks (e.g. src/api/**). Plan a task with an area, or start editing, and it appears here.'));
  root.append(empty);
  wsSkel = { root, active, idle, quiet, empty };
}
function countChip(n, label, cls) { const c = h('span', 'ws-count ' + (cls || ''), `${fmtN(n)} ${label}`); return c; }
function buildWsCard(n, w) {
  n.dataset.nature = w.nature || 'code';
  n.classList.toggle('hot', !!w.hot); n.classList.toggle('active', !!w.active);
  const flash = h('span', 'ws-flashlayer'); n._flash = flash;
  const head = h('div', 'ws-head');
  const nm = h('h4', 'ws-name' + (w.named ? '' : ' mono'), w.name); nm.title = w.name;
  head.append(nm);
  const tag = h('span', 'nat', NATURE_LABEL[w.nature] || w.nature || 'code'); tag.dataset.nature = w.nature || 'code';
  const mix = Object.entries(w.natures || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ');
  if (mix) tag.title = mix;
  head.append(tag);
  if (w.hot) { const hot = h('span', 'ws-hot'); hot.append(h('i'), h('span', null, 'hot')); hot.title = 'Files edited in the last 15 minutes'; head.append(hot); }
  head.append(h('span', 'spacer'));
  const avs = h('span', 'ws-avs');
  for (const id of (w.agents || []).slice(0, 6)) {
    const av = avatar(id, 'sm'); av.classList.add('ws-av'); const ring = h('span', 'ring'); av.append(ring);
    (wsAvRings.get(id) || wsAvRings.set(id, new Set()).get(id)).add(ring);
    avs.append(av);
  }
  if ((w.agents || []).length > 6) avs.append(h('span', 'more', `+${w.agents.length - 6}`));
  head.append(avs);
  const counts = h('div', 'ws-counts');
  if (w.in_progress) counts.append(countChip(w.in_progress, 'in progress', 'prog'));
  if (w.open) counts.append(countChip(w.open, 'open', 'open'));
  if (w.blocked) counts.append(countChip(w.blocked, 'blocked', 'blocked'));
  if (w.review) counts.append(countChip(w.review, 'in review', 'review'));
  if (w.done_24h) counts.append(countChip(w.done_24h, 'done today', 'done'));
  if (w.edits_24h) counts.append(countChip(w.edits_24h, `edit${w.edits_24h === 1 ? '' : 's'} today`, 'edits'));
  if (w.files_24h) counts.append(countChip(w.files_24h, `file${w.files_24h === 1 ? '' : 's'}`, 'files'));
  if (w.last_at) { const t = timeAgo(w.last_at); t.classList.add('ws-when'); counts.append(t); }
  const tasks = h('div', 'ws-tasks');
  const order = { taken: 0, blocked: 1, review: 2, open: 3, done: 4, dropped: 5 };
  const ts = (w.tasks || []).slice().sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3) || (a.priority ?? 2) - (b.priority ?? 2) || a.id - b.id);
  for (const t of ts.slice(0, 8)) {
    const r = h('div', 'ws-task'); r.dataset.status = t.status;
    r.append(h('span', 'sdot'), refBtn(t.id, t.status === 'done'));
    const ti = h('span', 'ws-ttl', t.title || ''); ti.title = t.title || ''; r.append(ti);
    if (t.nature && t.nature !== w.nature) { const nt = h('span', 'nat sm', NATURE_LABEL[t.nature] || t.nature); nt.dataset.nature = t.nature; r.append(nt); }
    if (t.owner) r.append(avatar(t.owner, 'xs'));
    tasks.append(r);
  }
  if (ts.length > 8) tasks.append(h('div', 'ws-more', `+${ts.length - 8} more`));
  const res = h('div', 'ws-res');
  for (const r of (w.reserved || []).slice(0, 6)) {
    const c = h('span', 'path res'); c.append(icon('lock', 10), h('span', null, r.path)); c.title = `${who(r.agent)} reserved ${r.path}${r.task ? ' for #' + r.task : ''}`;
    c.style.setProperty('--h', hue(r.agent)); res.append(c);
  }
  const parts = [flash, head, counts];
  if (ts.length) parts.push(tasks);
  if ((w.reserved || []).length) parts.push(res);
  n.replaceChildren(...parts);
}
function renderStreams(st) {
  if (S.centerView !== 'streams') return;
  if (!wsSkel) wsSkeleton();
  const all = st.workstreams || [];
  const active = all.filter((w) => w.active);
  const idle = all.filter((w) => !w.active && (w.open || w.blocked || w.review || w.in_progress));
  const quiet = all.filter((w) => !active.includes(w) && !idle.includes(w));
  const anim = !reduced() && wsNodes.size > 0;
  // FLIP: first
  const first = new Map();
  if (anim) for (const [k, n] of wsNodes) if (n.isConnected && n.offsetParent) first.set(k, n.getBoundingClientRect());
  // rebuild ring registry (cards rebuild their avatars when their signature changes)
  const seen = new Set();
  const place = (grid, list) => {
    list.forEach((w, i) => {
      let n = wsNodes.get(w.name); const isNew = !n;
      if (!n) { n = h('article', 'ws'); n.tabIndex = 0; n._name = w.name; wsNodes.set(w.name, n); }
      const sig = JSON.stringify(w) + '|' + S.area;
      if (n._sig !== sig) { n._sig = sig; buildWsCard(n, w); }
      n.classList.toggle('selected', S.area === w.name); n.setAttribute('aria-pressed', String(S.area === w.name));
      n.setAttribute('aria-label', `${w.name}: ${w.in_progress || 0} in progress, ${w.open || 0} open`);
      seen.add(w.name);
      if (grid.children[i] !== n) grid.insertBefore(n, grid.children[i] || null);
      if (isNew && anim) { n.classList.add('enter'); setTimeout(() => n.classList.remove('enter'), 320); }
    });
    while (grid.children.length > list.length) grid.lastElementChild.remove();
  };
  place(wsSkel.active._grid, active);
  place(wsSkel.idle._grid, idle);
  place(wsSkel.quiet._grid, quiet);
  for (const [k, n] of wsNodes) if (!seen.has(k)) { n.remove(); wsNodes.delete(k); }
  for (const [id, set] of wsAvRings) { for (const r of set) if (!r.isConnected) set.delete(r); if (!set.size) wsAvRings.delete(id); }
  wsSkel.active.hidden = !active.length; setText(wsSkel.active._count, active.length || '');
  wsSkel.idle.hidden = !idle.length; setText(wsSkel.idle._count, idle.length || '');
  wsSkel.quiet.hidden = !quiet.length;
  const qsig = `${quiet.length}`;
  if (wsSkel.quiet._toggle._sig !== qsig) { wsSkel.quiet._toggle._sig = qsig; wsSkel.quiet._toggle.replaceChildren(icon('chevron', 12), h('span', null, `Quiet · ${quiet.length}`)); }
  wsSkel.empty.hidden = all.length > 0;
  // FLIP: last + invert + play (interruptible: start from the current visual position)
  if (anim) for (const [k, r0] of first) {
    const n = wsNodes.get(k); if (!n || !n.offsetParent) continue;
    n._flip?.cancel();
    const r1 = n.getBoundingClientRect();
    const dx = r0.left - r1.left, dy = r0.top - r1.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
    n._flip = n.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 420, easing: EASE_MOVE });
  }
}

/* ================= board ================= */
const COLS = [
  { id: 'ready', label: 'Ready', empty: 'Nothing ready' },
  { id: 'waiting', label: 'Waiting', empty: '', slim: true },
  { id: 'taken', label: 'In progress', empty: 'Nobody’s on anything yet' },
  { id: 'blocked', label: 'Blocked', empty: '', slim: true },
  { id: 'review', label: 'Review', empty: '', slim: true },
  { id: 'done', label: 'Done', empty: 'Nothing finished yet' },
];
const colEls = new Map();
const cardNodes = new Map();
const DONE_PEEK = 8;
function buildCols() {
  const wrap = $('#cols'); wrap.replaceChildren(); colEls.clear();
  for (const c of COLS) {
    const col = h('section', 'col'); col.dataset.col = c.id;
    const head = h(c.id === 'done' ? 'button' : 'div', 'col-head');
    if (c.id === 'done') { head.type = 'button'; head.dataset.act = 'done-toggle'; }
    const count = h('span', 'count');
    head.append(h('span', 'cdot'), h('span', 'label', c.label), count);
    const body = h('div', 'col-body');
    const empty = h('div', 'col-empty', c.empty);
    col.append(head, empty, body);
    let foot = null;
    if (c.id === 'done') { foot = h('div', 'col-foot'); const b = h('button', 'btn sm'); b.type = 'button'; b.dataset.act = 'done-toggle'; foot.append(b); col.append(foot); }
    wrap.append(col);
    colEls.set(c.id, { col, body, count, empty, foot, def: c });
  }
}
function depsOk(t) { return (t.depends_on || []).every((d) => S.taskById.get(d)?.status === 'done'); }
function colOf(t) {
  switch (t.status) {
    case 'open': return depsOk(t) ? 'ready' : 'waiting';
    case 'taken': return 'taken';
    case 'blocked': return 'blocked';
    case 'review': return 'review';
    case 'done': return 'done';
    default: return null;
  }
}
/** GitHub issue chip: href only from validated parts (owner/repo + integer). */
function ghIssueLink(n) {
  const repo = S.data?.project_info?.main_repo;
  if (n == null || !Number.isInteger(Number(n)) || Number(n) <= 0 || typeof repo !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(repo)) return null;
  const a = h('a', 'gh-chip'); a.href = `https://github.com/${repo}/issues/${Number(n)}`; a.target = '_blank'; a.rel = 'noopener noreferrer';
  a.title = `GitHub issue #${Number(n)} in ${repo}`;
  a.append(ghMark(), h('span', null, '#' + Number(n)));
  a.addEventListener('click', (e) => e.stopPropagation());
  return a;
}
function ghMark() {
  const s = document.createElementNS(NS, 'svg'); s.setAttribute('viewBox', '0 0 16 16'); s.setAttribute('width', '11'); s.setAttribute('height', '11'); s.setAttribute('aria-hidden', 'true'); s.setAttribute('class', 'i');
  const p = document.createElementNS(NS, 'path'); p.setAttribute('fill', 'currentColor');
  p.setAttribute('d', 'M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z');
  s.append(p); return s;
}
function cardSig(t, col) {
  return [t.gh_issue, S.data?.project_info?.main_repo, t.title, t.status, t.priority, t.owner, t.note, (t.area || []).join('\u0001'), (t.depends_on || []).map((d) => d + ':' + (S.taskById.get(d)?.status || '')).join(','), t.body, t.accept, col].join('\u0002');
}
function buildCard(n, t) {
  const top = h('div', 'c-top');
  top.append(h('span', 'c-id', '#' + t.id));
  const pr = h('span', 'prio', 'P' + t.priority); pr.dataset.p = t.priority; pr.title = ['Urgent', 'High', 'Normal', 'Low', 'Someday'][t.priority] || '';
  top.append(pr);
  const mb = h('button', 'icon-btn'); mb.type = 'button'; mb.dataset.act = 'menu';
  mb.setAttribute('aria-label', `Task #${t.id} options`); mb.setAttribute('aria-haspopup', 'menu'); mb.setAttribute('aria-expanded', 'false');
  mb.append(icon('dots', 16));
  top.append(mb);
  const parts = [top, h('div', 'c-title', t.title)];
  if (t.note) parts.push(h('div', 'c-note', t.note));
  if (t.body || t.accept) {
    const more = h('div', 'c-more');
    if (t.body) more.append(t.body);
    if (t.accept) more.append(h('span', 'lbl', 'Done when'), t.accept);
    parts.push(more);
  }
  const meta = h('div', 'c-meta');
  const gh = ghIssueLink(t.gh_issue);
  if (gh) meta.append(gh);
  if (t.owner) meta.append(agentChip(t.owner));
  const area = t.area || [];
  for (const p of area.slice(0, 3)) { const c = h('span', 'path', p); c.title = p; meta.append(c); }
  if (area.length > 3) { const c = h('span', 'path', `+${area.length - 3}`); c.title = area.slice(3).join('\n'); meta.append(c); }
  if ((t.depends_on || []).length) {
    const d = h('span', 'deps', 'after');
    for (const id of t.depends_on) d.append(refBtn(id, S.taskById.get(id)?.status === 'done'));
    meta.append(d);
  }
  parts.push(meta);
  n.replaceChildren(...parts);
}
function renderBoard(st) {
  const buckets = Object.fromEntries(COLS.map((c) => [c.id, []]));
  for (const t of st.tasks) { const c = colOf(t); if (c) buckets[c].push(t); }
  for (const k of Object.keys(buckets)) {
    if (k === 'done') buckets[k].sort((a, b) => (b.done_at || b.updated_at || 0) - (a.done_at || a.updated_at || 0));
    else buckets[k].sort((a, b) => a.priority - b.priority || a.id - b.id);
  }
  const visible = {};
  for (const c of COLS) visible[c.id] = c.id === 'done' ? buckets.done.slice(0, S.doneOpen ? 200 : DONE_PEEK) : buckets[c.id];

  const animate = S.boardRendered && !reduced();
  // pass 1 — measure cards that will change column (FLIP "first")
  const moves = [];
  const keep = new Set();
  for (const c of COLS) for (const t of visible[c.id]) {
    keep.add(t.id);
    const n = cardNodes.get(t.id);
    if (n && n.isConnected && n.dataset.col !== c.id && animate) {
      const src = n._ghost || n;
      const r = src.getBoundingClientRect();
      if (r.width) moves.push({ n, first: r });
    }
  }
  // pass 2 — update + place
  for (const c of COLS) {
    const { col, body, count, empty, foot } = colEls.get(c.id);
    const arr = visible[c.id];
    arr.forEach((t, i) => {
      let n = cardNodes.get(t.id); const isNew = !n;
      if (!n) { n = h('article', 'card'); n.dataset.id = t.id; cardNodes.set(t.id, n); }
      const sig = cardSig(t, c.id);
      if (n._sig !== sig) { n._sig = sig; buildCard(n, t); }
      n.dataset.col = c.id;
      if (body.children[i] !== n) body.insertBefore(n, body.children[i] || null);
      if (isNew && animate) { n.classList.add('enter'); setTimeout(() => n.classList.remove('enter'), 300); }
    });
    while (body.children.length > arr.length) body.lastElementChild.remove();
    const total = buckets[c.id].length;
    setText(count, total || '');
    empty.hidden = total > 0 || !c.empty;
    col.classList.toggle('slim', !!c.slim && total === 0);
    if (foot) {
      foot.hidden = total <= DONE_PEEK;
      setText(foot.firstElementChild, S.doneOpen ? 'Show recent only' : `Show all ${total}`);
    }
  }
  for (const [id, n] of cardNodes) if (!keep.has(id)) { if (!S.taskById.has(id)) cardNodes.delete(id); n.remove(); }
  // pass 3 — FLIP across columns with a fixed-position ghost (columns clip overflow)
  for (const { n, first } of moves) {
    const last = n.getBoundingClientRect();
    if (!last.width) continue;
    if (n._anim) n._anim.cancel();
    const g = n.cloneNode(true);
    g.classList.add('ghost'); g.classList.remove('enter');
    Object.assign(g.style, { left: first.left + 'px', top: first.top + 'px', width: first.width + 'px' });
    document.body.append(g);
    n.style.opacity = '0';
    const dx = last.left - first.left, dy = last.top - first.top;
    const anim = g.animate([
      { transform: 'translate(0,0) scale(1)' },
      { transform: `translate(${dx * 0.5}px, ${dy * 0.5}px) scale(1.02)`, offset: 0.5 },
      { transform: `translate(${dx}px, ${dy}px) scale(1)` },
    ], { duration: 460, easing: EASE_MOVE });
    n._anim = anim; n._ghost = g;
    const done = () => { g.remove(); if (n._ghost === g) { n._ghost = null; n._anim = null; n.style.opacity = ''; } };
    anim.onfinish = done; anim.oncancel = done;
  }
  S.boardRendered = true;
  const open = st.tasks.filter((t) => !['done', 'dropped'].includes(t.status)).length;
  setText($('#board-count'), open ? `${open} open` : '');
  if (S.centerView === 'streams') setText($('#board-count'), (st.workstreams || []).length ? `${(st.workstreams || []).filter((w) => w.active).length} active` : '');
}
function focusTask(id) {
  id = Number(id);
  const t = S.taskById.get(id);
  if (!t) { toast(`Task #${id} isn’t on this board.`); return; }
  if (matchMedia('(max-width: 899px)').matches) setView('board');
  if (t.status === 'done' && !cardNodes.get(id)?.isConnected) { S.doneOpen = true; renderBoard(S.data); }
  const n = cardNodes.get(id);
  if (!n || !n.isConnected) { toast(`Task #${id} is ${t.status}.`); return; }
  n.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reduced() ? 'auto' : 'smooth' });
  n.classList.add('flash');
  setTimeout(() => n.classList.remove('flash'), 1400);
}

const STATUS = [['open', 'Open'], ['taken', 'In progress'], ['blocked', 'Blocked'], ['review', 'In review'], ['done', 'Done'], ['dropped', 'Dropped']];
async function editTask(id, patch) {
  const t = S.taskById.get(id); if (!t) return;
  const prev = { ...t };
  Object.assign(t, patch);
  if (patch.status === 'open') t.owner = null;
  if (patch.status === 'done') t.done_at = srvNow();
  renderBoard(S.data);
  try {
    await api('api/human/task', { project: S.project, name: myName(), id, ...patch });
    scheduleRefetch(0);
  } catch (e) { Object.assign(t, prev); renderBoard(S.data); fail(e); }
}
function taskMenu(t) {
  return (el) => {
    el.append(h('div', 'sec', 'Status'));
    for (const [s, label] of STATUS) el.append(popItem(label, () => { closePop(); if (s !== t.status) editTask(t.id, { status: s }); }, { checked: t.status === s, data: { s } }));
    el.append(h('hr'), h('div', 'sec', 'Priority'));
    el.append(seg([0, 1, 2, 3, 4], t.priority, (p) => { closePop(); if (p !== t.priority) editTask(t.id, { priority: p }); }, (p) => 'P' + p));
    el.append(h('hr'), h('div', 'sec', 'Note'));
    const f = h('form', 'note');
    const inp = h('input'); inp.type = 'text'; inp.value = t.note || ''; inp.placeholder = 'Add a note for the team'; inp.maxLength = 1000;
    const sv = h('button', 'btn sm', 'Save'); sv.type = 'submit';
    f.append(inp, sv);
    f.addEventListener('submit', (e) => { e.preventDefault(); closePop(); if ((inp.value || '') !== (t.note || '')) editTask(t.id, { note: inp.value.trim() }); });
    el.append(f);
    setTimeout(() => el.querySelector('.item')?.focus({ preventScroll: true }), 0);
  };
}
function addTasksPop(el) {
  const f = h('form', 'add');
  const lbl = h('label', null, 'New tasks — one per line'); lbl.htmlFor = 'qa-text';
  const ta = h('textarea'); ta.id = 'qa-text'; ta.rows = 5; ta.placeholder = 'Wire the settings API\nAdd empty state to the inbox\nWrite migration for invites';
  const hint = h('div', 'hint', 'Agents pick these up from the Ready column.');
  let prio = 2;
  const pl = h('label', null, 'Priority');
  const sg = seg([0, 1, 2, 3, 4], 2, (p) => { prio = p; }, (p) => 'P' + p);
  const al = h('label', null, 'Area (optional, comma-separated paths or globs)'); al.htmlFor = 'qa-area';
  const area = h('input'); area.id = 'qa-area'; area.type = 'text'; area.placeholder = 'src/api, web/settings/**';
  const row = h('div', 'row');
  const cancel = h('button', 'btn sm', 'Cancel'); cancel.type = 'button'; cancel.addEventListener('click', () => closePop());
  const ok = h('button', 'btn sm primary', 'Add'); ok.type = 'submit';
  row.append(cancel, ok);
  const lines = () => ta.value.split('\n').map((s) => s.trim()).filter(Boolean);
  const upd = () => { const n = lines().length; setText(ok, n > 1 ? `Add ${n} tasks` : 'Add task'); ok.disabled = !n; };
  ta.addEventListener('input', upd); upd();
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); f.requestSubmit(); } });
  f.append(lbl, ta, hint, pl, sg, al, area, row);
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const titles = lines().slice(0, 100); if (!titles.length) return;
    const ar = area.value.split(',').map((s) => s.trim()).filter(Boolean);
    ok.disabled = true;
    try {
      const out = await api('api/human/plan', { project: S.project, name: myName(), tasks: titles.map((title) => ({ title: title.slice(0, 200), priority: prio, ...(ar.length ? { area: ar } : {}) })) });
      closePop();
      toast(`Added ${titles.length} task${titles.length === 1 ? '' : 's'}`);
      scheduleRefetch(0);
      void out;
    } catch (err) { ok.disabled = false; fail(err); }
  });
  el.append(f);
}

/* ================= files + claims ================= */
const fileRows = new Map(); const fileGroups = new Map();
let filesSkel = null;
const CONTEND_MS = 30 * 60000;
function filesSkeleton() {
  const root = $('#files'); root.replaceChildren();
  const sum = h('div', 'f-sum');
  const sumText = h('span', 'f-sumtext');
  const sorter = seg(['recent', 'name'], S.fileSort, (v) => { S.fileSort = v; renderFiles(S.data, true); }, (v) => (v === 'recent' ? 'Recent' : 'A–Z'));
  sorter.classList.add('f-sort');
  sum.append(sumText, sorter);
  const base = h('div', 'f-base');
  const onboard = h('div', 'f-onboard');
  onboard.append(h('b', null, 'Make the initial commit'));
  onboard.append(h('p', null, 'Switchboard tracks work per existing file, so agents edit what exists instead of creating duplicates. Register the project’s files once — in the project folder, run:'));
  onboard.append(codeRow('node connect.mjs track'));
  onboard.append(h('p', 'muted small', 'It sends paths and content hashes only, never file contents.'));
  const groups = h('div', 'f-groups');
  const empty = h('div', 'empty', 'No files touched yet. Edits by agents show up here, grouped by folder.');
  const ch = h('h3', 'f-sec', 'Claims');
  const banner = h('div', 'banner');
  const claims = h('div', 'f-claims');
  root.append(base, onboard, sum, groups, empty, ch, banner, claims);
  filesSkel = { root, sumText, groups, empty, ch, banner, claims, base, onboard, claimSig: null };
  fileRows.clear(); fileGroups.clear();
}
const dirOf = (p) => { const i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i); };
const baseOf = (p) => { const i = p.lastIndexOf('/'); return i < 0 ? p : p.slice(i + 1); };
function recordTouch(agent, paths) {
  const t = srvNow();
  for (const raw of paths || []) {
    const p = norm(raw); if (!p) continue;
    let m = S.recentTouch.get(p); if (!m) { m = new Map(); S.recentTouch.set(p, m); }
    m.set(agent, t);
  }
  if (S.recentTouch.size > 2000) { for (const k of [...S.recentTouch.keys()].slice(0, 500)) S.recentTouch.delete(k); }
}
function contenders(f) {
  const cut = srvNow() - CONTEND_MS;
  const set = new Set();
  const m = S.recentTouch.get(norm(f.path));
  if (m) for (const [a, t] of m) if (t >= cut) set.add(a);
  if ((f.last_at || 0) >= cut && (f.agents || []).length >= 2) for (const a of f.agents) set.add(a);
  return set;
}
function claimFor(path, claims) {
  let best = null;
  for (const c of claims) if (overlaps(c.path, path)) { if (!best || (c.mode === 'hard' && best.mode !== 'hard')) best = c; }
  return best;
}
function fileRowSig(f, heat, cl, cont) {
  return [f.edits, (f.agents || []).join(','), f.last_agent, f.last_at, f.created_by, f.task_id, heat, cl ? `${cl.agent}:${cl.mode}:${cl.task_id}` : '', [...cont].join(',')].join('|');
}
function buildFileRow(n, f, heat, cl, cont) {
  n.dataset.heat = heat;
  n.classList.toggle('new', !!f.created_by);
  n.classList.toggle('contested', cont.size >= 2);
  const bar = h('span', 'heat');
  const main = h('div', 'f-main');
  const l1 = h('div', 'f-l1');
  const live = h('span', 'live');
  const rm = /^@[\w.-]{1,40}\/(.*)$/.exec(f.path);
  const name = h('span', 'f-name', rm ? rm[1] : baseOf(f.path)); name.title = f.path;
  if (rm) name.classList.add('rtl');
  l1.append(live, name);
  if (f.created_by) { const b = h('span', 'badge', 'new'); b.dataset.k = 'new'; b.title = `Created by ${who(f.created_by)}${f.created_at ? ' ' + new Date(f.created_at).toLocaleString() : ''}`; l1.append(b); }
  if (cont.size >= 2) { const b = h('span', 'badge', `${cont.size} agents`); b.dataset.k = 'alert'; b.title = 'Touched by several agents in the last 30 minutes: ' + [...cont].map(who).join(', '); l1.append(b); }
  l1.append(timeEl(f.last_at));
  const l2 = h('div', 'f-l2');
  const stack = h('span', 'stack');
  const ag = (f.agents || []).slice(0, 4);
  for (const a of ag) stack.append(avatar(a, 'xs'));
  if ((f.agents || []).length > 4) stack.append(h('span', 'more', '+' + (f.agents.length - 4)));
  l2.append(stack);
  if (cl) {
    const c = h('span', 'f-claim'); c.dataset.mode = cl.mode;
    if (cl.mode === 'hard') c.append(icon('lock', 11));
    c.append(agentChip(cl.agent));
    c.title = `${cl.mode === 'hard' ? 'Hard claim' : 'Soft claim (editing)'} on ${cl.path}${cl.reason ? ' — ' + cl.reason : ''}`;
    l2.append(c);
  }
  const tid = f.task_id || cl?.task_id;
  if (tid) l2.append(refBtn(tid));
  l2.append(h('span', 'f-edits', `${f.edits || 0} edit${f.edits === 1 ? '' : 's'}`));
  main.append(l1, l2);
  n.replaceChildren(bar, main);
  n._live = live; n._at = f.last_at;
}
function renderFiles(st, force) {
  if (!filesSkel) filesSkeleton();
  const files = (st.files || []).map((f) => ({ ...f, path: norm(f.path) })).filter((f) => !S.area || areaMatch(f.path));
  const claims = (st.claims || []).filter((c) => !S.area || areaMatch(c.path));
  const maxE = Math.max(1, ...files.map((f) => f.edits || 0));
  let contested = 0; let created = 0;
  const groups = new Map();
  for (const f of files) {
    const rootM = /^(@[\w.-]{1,40})\//.exec(f.path);
    const d = rootM ? rootM[1] : dirOf(f.path);
    let g = groups.get(d); if (!g) { g = { dir: d, files: [], last: 0, root: !!rootM }; groups.set(d, g); }
    g.files.push(f); g.last = Math.max(g.last, f.last_at || 0);
  }
  const garr = [...groups.values()];
  const rootFirst = (a, b) => (b.root ? 1 : 0) - (a.root ? 1 : 0);
  if (S.fileSort === 'name') { garr.sort((a, b) => rootFirst(a, b) || a.dir.localeCompare(b.dir)); for (const g of garr) g.files.sort((a, b) => a.path.localeCompare(b.path)); }
  else { garr.sort((a, b) => rootFirst(a, b) || b.last - a.last); for (const g of garr) g.files.sort((a, b) => (b.last_at || 0) - (a.last_at || 0)); }
  const { groups: gwrap } = filesSkel;
  const seenG = new Set(); const seenF = new Set();
  garr.forEach((g, gi) => {
    let ge = fileGroups.get(g.dir);
    if (!ge) {
      ge = h('div', 'cgroup');
      const hd = h('h3'); const nm = h('span', 'dir', g.dir ? g.dir + '/' : '(root)'); const ct = h('span', 'count');
      if (g.root) { ge.classList.add('rootgroup'); hd.prepend(icon('folder', 13)); nm.title = 'Files outside git, under the named root ' + g.dir; }
      hd.append(nm, ct);
      const body = h('div', 'f-list');
      ge.append(hd, body); ge._count = ct; ge._body = body;
      fileGroups.set(g.dir, ge);
    }
    seenG.add(g.dir);
    if (gwrap.children[gi] !== ge) gwrap.insertBefore(ge, gwrap.children[gi] || null);
    let gc = 0;
    g.files.forEach((f, i) => {
      const heat = Math.max(1, Math.ceil(4 * Math.log1p(f.edits || 0) / Math.log1p(maxE)));
      const cl = claimFor(f.path, claims);
      const cont = contenders(f);
      if (cont.size >= 2) { contested++; gc++; }
      if (f.created_by) created++;
      let n = fileRows.get(f.path);
      if (!n) { n = h('div', 'frow'); fileRows.set(f.path, n); }
      const sig = fileRowSig(f, heat, cl, cont);
      if (n._sig !== sig || force) { n._sig = sig; buildFileRow(n, f, heat, cl, cont); }
      seenF.add(f.path);
      if (ge._body.children[i] !== n) ge._body.insertBefore(n, ge._body.children[i] || null);
    });
    while (ge._body.children.length > g.files.length) ge._body.lastElementChild.remove();
    setText(ge._count, gc ? `${g.files.length} · ${gc} contested` : g.files.length);
    ge.classList.toggle('has-contest', gc > 0);
  });
  while (gwrap.children.length > garr.length) gwrap.lastElementChild.remove();
  for (const [k, n] of fileGroups) if (!seenG.has(k)) { n.remove(); fileGroups.delete(k); }
  for (const [k, n] of fileRows) if (!seenF.has(k)) { n.remove(); fileRows.delete(k); }
  filesSkel.empty.hidden = files.length > 0;
  const bl = st.baseline;
  const hasBase = !!(bl && bl.n > 0);
  filesSkel.onboard.hidden = !bl || hasBase;
  filesSkel.base.hidden = !hasBase;
  if (hasBase) {
    const bsig = `${bl.n}|${bl.at}`;
    if (filesSkel.base._sig !== bsig) {
      filesSkel.base._sig = bsig; filesSkel.base.replaceChildren();
      filesSkel.base.append(`${Number(bl.n).toLocaleString()} tracked file${bl.n === 1 ? '' : 's'}`);
      if (bl.at) { const t = h('time', null, new Date(bl.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })); t.dateTime = new Date(bl.at).toISOString(); filesSkel.base.append(' · baselined ', t); }
    }
  }
  const parts = [`${files.length} file${files.length === 1 ? '' : 's'} in play`];
  if (created) parts.push(`${created} new`);
  if (contested) parts.push(`${contested} contested`);
  setText(filesSkel.sumText, parts.join(' · '));
  tickFiles();

  // claims (rebuilt only when changed)
  const conflicts = claimConflicts(claims);
  const csig = claims.map((c) => `${c.id}:${c.mode}:${c.expires_at}`).join('|');
  if (filesSkel.claimSig !== csig || force) { filesSkel.claimSig = csig; renderClaims(claims, conflicts); }
  const tc = $('#tc-files');
  setText(tc, files.length || claims.length ? String(files.length || claims.length) : '');
  tc.classList.toggle('warn', contested > 0 || conflicts.size > 0);
}
function claimConflicts(claims) {
  const out = new Map(); // claim id -> [other claims]
  for (let i = 0; i < claims.length; i++) for (let j = i + 1; j < claims.length; j++) {
    const a = claims[i], b = claims[j];
    if (a.agent === b.agent || !overlaps(a.path, b.path)) continue;
    (out.get(a.id) || out.set(a.id, []).get(a.id)).push(b);
    (out.get(b.id) || out.set(b.id, []).get(b.id)).push(a);
  }
  return out;
}
function renderClaims(claims, conflicts) {
  const { claims: wrap, banner, ch } = filesSkel;
  wrap.replaceChildren();
  ch.hidden = !claims.length;
  if (conflicts.size) {
    banner.hidden = false; banner.className = 'banner';
    banner.replaceChildren(icon('warn', 15), h('span', null, `${conflicts.size} claim${conflicts.size === 1 ? '' : 's'} overlap another agent’s paths. Agents involved should talk before editing.`));
  } else banner.hidden = true;
  const groups = new Map();
  for (const c of claims) { const top = norm(c.path).split('/')[0] || '(root)'; (groups.get(top) || groups.set(top, []).get(top)).push(c); }
  const keys = [...groups.keys()].sort((a, b) => a.localeCompare(b));
  for (const k of keys) {
    const g = h('div', 'cgroup');
    const hd = h('h3'); hd.append(h('span', 'dir', k), h('span', 'count', groups.get(k).length));
    g.append(hd);
    const arr = groups.get(k).sort((a, b) => (conflicts.has(b.id) - conflicts.has(a.id)) || (a.mode === 'hard' ? -1 : 1) - (b.mode === 'hard' ? -1 : 1) || a.path.localeCompare(b.path));
    for (const c of arr) {
      const r = h('div', 'claim'); r.dataset.mode = c.mode;
      r.append(h('span', 'cp', c.path));
      const md = h('span', 'mode'); if (c.mode === 'hard') md.append(icon('lock', 11)); md.append(c.mode === 'hard' ? 'Hard' : 'Soft'); r.append(md);
      const meta = h('div', 'cmeta');
      meta.append(agentChip(c.agent));
      if (c.task_id) meta.append(refBtn(c.task_id));
      if (c.reason) { const rs = h('span', 'reason', c.reason); rs.title = c.reason; meta.append(rs); }
      if (c.expires_at) { const ex = h('time', null, until(c.expires_at)); ex.dataset.exp = c.expires_at; meta.append(ex); }
      r.append(meta);
      const cx = conflicts.get(c.id);
      if (cx) { r.classList.add('conflict'); r.append(h('div', 'cx', 'Overlaps ' + cx.map((o) => `${who(o.agent)} (${o.path}, ${o.mode})`).join(', '))); }
      g.append(r);
    }
    wrap.append(g);
  }
}
function tickFiles() {
  const now = srvNow();
  for (const n of fileRows.values()) n.classList.toggle('hot', now - (n._at || 0) < 90000);
}

/* ================= build list (files outside git, under @roots) ================= */
const fmtBytes = (n) => {
  n = Number(n) || 0; if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']; let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toLocaleString(undefined, { maximumFractionDigits: n < 10 && i ? 1 : 0 })} ${u[i]}`;
};
const fmtN = (n) => Number(n || 0).toLocaleString();
const BUILD = { data: null, project: null, timer: 0, busy: false, again: false, dirty: true, recentCap: 60, folderCap: 30, skel: null, rows: new Map(), drows: new Map() };
function scheduleBuild(ms = 600) {
  BUILD.dirty = true;
  if (S.tab !== 'build') return; // fetched when the tab opens
  if (BUILD.timer) return;
  BUILD.timer = setTimeout(() => { BUILD.timer = 0; loadBuild(); }, ms);
}
async function loadBuild() {
  if (!S.project) return;
  if (BUILD.busy) { BUILD.again = true; return; }
  BUILD.busy = true;
  const pj = S.project;
  try {
    const bl = await api('api/buildlist?project=' + encodeURIComponent(pj));
    if (S.project !== pj) return;
    BUILD.data = bl; BUILD.project = pj; BUILD.dirty = false;
    renderBuild();
  } catch (e) { fail(e); }
  finally { BUILD.busy = false; if (BUILD.again) { BUILD.again = false; scheduleBuild(400); } }
}
function resetBuild() { clearTimeout(BUILD.timer); BUILD.timer = 0; Object.assign(BUILD, { data: null, project: null, dirty: true, skel: null, recentCap: 60, folderCap: 30 }); BUILD.rows.clear(); BUILD.drows.clear(); $('#build').replaceChildren(); setText($('#tc-build'), ''); }
function buildSkeleton() {
  const root = $('#build'); root.replaceChildren();
  const tot = h('div', 'bl-totals');
  const big = h('div', 'bl-big'); const sub = h('div', 'bl-sub');
  tot.append(big, sub);
  const onboard = h('div', 'f-onboard bl-empty');
  onboard.append(h('b', null, 'Track files that live outside git'));
  onboard.append(h('p', null, 'Renders, media and datasets are tracked by path, size and time under named roots like @assets — never their contents, and never where they sit on your disk. Connect a folder below and it is scanned and watched from then on.'));
  const tip = h('p', 'muted small'); tip.append('Plan outputs by giving a task an area like ', h('code', 'inline', '@assets/ep01/**'), ' — it shows up here as a deliverable.');
  onboard.append(tip);
  const roots = h('section', 'roots'); roots.setAttribute('aria-label', 'Asset roots on this machine');
  root.append(roots); BUILD.rootsEl = roots; loadRoots();
  const dh = h('h3', 'f-sec', 'Deliverables'); const dl = h('div', 'bl-deliv');
  const fh = h('h3', 'f-sec', 'Folders'); const fl = h('div', 'bl-folders'); const fmore = h('button', 'btn sm bl-more'); fmore.type = 'button';
  fmore.addEventListener('click', () => { BUILD.folderCap += 50; renderBuild(); });
  const rh = h('h3', 'f-sec'); rh.append(h('span', null, 'Recent changes'), h('span', 'live-dot'));
  const rl = h('div', 'bl-recent'); const rmore = h('button', 'btn sm bl-more'); rmore.type = 'button';
  rmore.addEventListener('click', () => { BUILD.recentCap = Math.min(300, BUILD.recentCap + 80); renderBuild(); });
  root.append(tot, onboard, dh, dl, fh, fl, fmore, rh, rl, rmore);
  BUILD.skel = { big, sub, onboard, dh, dl, fh, fl, fmore, rh, rl, rmore };
}
/* ---- asset roots: connect a folder on this machine (picker or pasted path), scan, disconnect ---- */
async function loadRoots() {
  if (!BUILD.rootsEl || !ghMode()) return;
  try { const r = await api('api/roots'); renderRoots(r.roots || []); } catch (e) { fail(e); }
}
function rootsCall(path, body, btn) {
  if (btn) btn.disabled = true;
  return api(path, body).then((r) => { if (r && r.roots) renderRoots(r.roots); scheduleBuild(1500); return r; }, (e) => { fail(e); return null; }).finally(() => { if (btn) btn.disabled = false; });
}
async function pickInto(name, input, btn) {
  btn.disabled = true; const was = btn.textContent; setText(btn, 'Waiting for the folder window…');
  try { const r = await api('api/roots/pick', { name }); if (r && r.folder) { input.value = r.folder; input.focus(); } }
  catch (e) { fail(e); } finally { btn.disabled = false; setText(btn, was); }
}
function renderRoots(list) {
  const el = BUILD.rootsEl; if (!el) return;
  el.replaceChildren();
  const head = h('div', 'roots-head'); head.append(h('h3', 'f-sec', 'Asset roots'), h('span', 'muted small', 'Folders on this machine. Only names, sizes and times are shared.'));
  el.append(head);
  for (const r of list) {
    const row = h('div', 'root-row'); row.dataset.state = r.folder ? (r.exists ? 'on' : 'missing') : 'off';
    const id = h('div', 'root-id'); id.append(h('span', 'root-name', '@' + r.name));
    if (r.about) id.append(h('span', 'root-about', r.about));
    row.append(id);
    if (r.folder) {
      const st = h('div', 'root-status');
      const dot = h('span', 'dot ' + (r.scanning ? 'wait' : r.exists ? 'live' : 'ready'));
      st.append(dot, h('span', 'root-path', r.folder));
      st.append(h('span', 'muted small', r.scanning ? 'scanning…' : r.exists ? 'watching' : 'folder missing'));
      const acts = h('div', 'root-acts');
      const scan = h('button', 'btn sm', 'Scan now'); scan.type = 'button'; scan.disabled = !!r.scanning;
      scan.addEventListener('click', () => rootsCall('api/roots/scan', { name: r.name }, scan).then(() => setTimeout(loadRoots, 1500)));
      const off = h('button', 'btn sm ghost', 'Disconnect'); off.type = 'button';
      off.addEventListener('click', () => rootsCall('api/roots/disconnect', { name: r.name }, off));
      acts.append(scan, off); row.append(st, acts);
      if (r.scanning) setTimeout(loadRoots, 2000);
    } else row.append(connectForm(r.name));
    el.append(row);
  }
  const add = h('details', 'root-add'); add.append(h('summary', null, list.length ? 'Add another root' : 'Add a root'));
  add.append(connectForm(null)); el.append(add);
  if (!list.length) add.open = true;
}
function connectForm(name) {
  const f = h('form', 'root-connect'); f.noValidate = true;
  const nameIn = h('input'); nameIn.type = 'text'; nameIn.placeholder = 'name, e.g. assets'; nameIn.maxLength = 40; nameIn.spellcheck = false; nameIn.setAttribute('aria-label', 'Root name');
  const dir = h('input'); dir.type = 'text'; dir.placeholder = 'Folder on this machine'; dir.spellcheck = false; dir.setAttribute('aria-label', name ? `Folder for @${name}` : 'Folder');
  const pick = h('button', 'btn sm', 'Choose folder…'); pick.type = 'button';
  pick.addEventListener('click', () => pickInto(name || nameIn.value.trim().toLowerCase() || 'files', dir, pick));
  const go = h('button', 'btn sm primary', 'Connect'); go.type = 'submit';
  if (!name) f.append(nameIn);
  f.append(dir, pick, go);
  f.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const n = name || nameIn.value.trim().replace(/^@/, '').toLowerCase();
    if (!n) { nameIn.focus(); return; } if (!dir.value.trim()) { pick.focus(); return; }
    const r = await rootsCall('api/roots/connect', { name: n, folder: dir.value.trim() }, go);
    if (r) { toast(`@${n} connected — scanning now.`); setTimeout(loadRoots, 1500); }
  });
  return f;
}
const STATE_K = { planned: 'planned', started: 'started', 'in progress': 'progress', done: 'done', 'done (no files)': 'done-empty', dropped: 'dropped' };
const STATE_P = { planned: 0.04, started: 0.33, progress: 0.66, done: 1, 'done-empty': 1, dropped: 0 };
function renderBuild() {
  const bl = BUILD.data; if (!bl) return;
  if (!BUILD.skel) buildSkeleton();
  const k = BUILD.skel; const t = bl.totals || {};
  const empty = !t.files && !(bl.deliverables || []).length && !(bl.recent || []).length;
  setText($('#tc-build'), t.files ? fmtN(t.files) : '');
  k.onboard.hidden = !empty;
  setText(k.big, `${fmtN(t.files)} file${t.files === 1 ? '' : 's'} · ${fmtBytes(t.bytes)}`);
  k.sub.replaceChildren();
  if (t.deleted) k.sub.append(`${fmtN(t.deleted)} deleted · `);
  k.sub.append('updated ', timeAgo(bl.generated_at), ' · ');
  const md = h('a', null, 'BUILD-LIST.md'); md.href = 'api/buildlist?project=' + encodeURIComponent(S.project) + '&format=md'; md.target = '_blank'; md.rel = 'noopener';
  k.sub.append(md);

  // deliverables (keyed by task)
  const ORDER = { progress: 0, started: 1, planned: 2, done: 3, 'done-empty': 3, dropped: 4 };
  const ds = (bl.deliverables || []).slice().sort((a, b) => (ORDER[STATE_K[a.state]] ?? 2) - (ORDER[STATE_K[b.state]] ?? 2) || a.task - b.task);
  k.dh.hidden = !ds.length; k.dl.hidden = !ds.length;
  const seenD = new Set();
  ds.forEach((d, i) => {
    let n = BUILD.drows.get(d.task); const isNew = !n;
    if (!n) { n = h('div', 'deliv'); BUILD.drows.set(d.task, n); }
    const sig = JSON.stringify([d.title, d.owner, d.state, d.files, d.bytes, d.patterns, d.last_at]);
    if (n._sig !== sig) {
      const prevP = n._p ?? 0;
      n._sig = sig; const sk = STATE_K[d.state] || 'planned'; n.dataset.state = sk;
      const top = h('div', 'd-top');
      top.append(refBtn(d.task), h('span', 'd-title', d.title || ''));
      const pill = h('span', 'state-pill', d.state); pill.dataset.s = sk; top.append(pill);
      const meta = h('div', 'd-meta');
      if (d.owner) meta.append(agentChip(d.owner));
      meta.append(h('span', 'num', `${fmtN(d.files)} file${d.files === 1 ? '' : 's'}`), h('span', 'num', fmtBytes(d.bytes)));
      if (d.last_at) meta.append(timeEl(d.last_at));
      const pats = h('div', 'd-pats'); for (const pt of (d.patterns || []).slice(0, 6)) { const c = h('span', 'path', pt); c.title = pt; pats.append(c); }
      const track = h('div', 'd-track'); const fill = h('span', 'd-fill'); track.append(fill);
      n.replaceChildren(top, meta, pats, track);
      const p = STATE_P[sk] ?? 0; n._p = p;
      fill.style.transform = `scaleX(${isNew || reduced() ? p : prevP})`;
      if (!isNew && !reduced() && prevP !== p) requestAnimationFrame(() => { fill.style.transform = `scaleX(${p})`; });
    }
    seenD.add(d.task);
    if (k.dl.children[i] !== n) k.dl.insertBefore(n, k.dl.children[i] || null);
  });
  while (k.dl.children.length > ds.length) k.dl.lastElementChild.remove();
  for (const [id, n] of BUILD.drows) if (!seenD.has(id)) { n.remove(); BUILD.drows.delete(id); }

  // folders (rebuilt on change; size bars relative to the largest)
  const fsAll = bl.folders || [];
  k.fh.hidden = !fsAll.length;
  const fs = fsAll.slice(0, BUILD.folderCap);
  const fsig = JSON.stringify(fs.map((f) => [f.folder, f.files, f.bytes, f.last_at, f.last_agent]));
  if (k.fl._sig !== fsig) {
    k.fl._sig = fsig; k.fl.replaceChildren();
    const max = Math.max(1, ...fsAll.map((f) => f.bytes || 0));
    for (const f of fs) {
      const r = h('div', 'frow2');
      const l1 = h('div', 'fo-l1');
      const nm = h('span', 'fo-name', f.folder); nm.title = f.folder;
      l1.append(nm, h('span', 'num', `${fmtN(f.files)} · ${fmtBytes(f.bytes)}`));
      const bar = h('div', 'fo-bar'); const fill = h('span'); fill.style.transform = `scaleX(${Math.max(0.01, (f.bytes || 0) / max)})`; bar.append(fill);
      const l2 = h('div', 'fo-l2'); if (f.last_at) l2.append('changed ', timeAgo(f.last_at)); if (f.last_agent) { l2.append(' by '); l2.append(agentChip(f.last_agent)); }
      r.append(l1, bar, l2); k.fl.append(r);
    }
  }
  k.fmore.hidden = fsAll.length <= fs.length;
  setText(k.fmore, `Show more folders (${fmtN(fsAll.length - fs.length)})`);

  // recent changes: keyed, newest first; new rows slide in, deletions are struck through
  const recAll = bl.recent || [];
  k.rh.hidden = !recAll.length;
  const rec = recAll.slice(0, BUILD.recentCap);
  const animate = !!k.rl.children.length && !reduced();
  const seen = new Set();
  rec.forEach((f, i) => {
    const key = f.path;
    let n = BUILD.rows.get(key); const isNew = !n;
    if (!n) { n = h('div', 'rc'); BUILD.rows.set(key, n); }
    const sig = [f.state, f.size, f.last_at, f.last_agent, f.edits].join('|');
    if (n._sig !== sig) {
      const changed = !isNew && n._sig !== undefined;
      n._sig = sig;
      const gone = f.state === 'deleted';
      const op = gone ? 'del' : (f.created_by && (f.edits || 0) <= 1 ? 'add' : 'chg');
      n.dataset.op = op; n.classList.toggle('gone', gone);
      const g = h('span', 'rc-op', op === 'del' ? '−' : op === 'add' ? '+' : '~');
      const nm = h('span', 'rc-name'); const rm = /^(@[\w.-]{1,40}\/)(.*)$/.exec(f.path);
      if (rm) nm.append(h('span', 'rc-root', rm[1]), dirOf(rm[2]) ? h('span', 'rc-dir', dirOf(rm[2]) + '/') : '', h('b', null, baseOf(rm[2]))); else nm.append(h('b', null, f.path));
      nm.title = f.path;
      const meta = h('span', 'rc-meta');
      if (!gone && f.size != null) meta.append(h('span', 'num', fmtBytes(f.size)));
      meta.append(timeEl(f.last_at));
      n.replaceChildren(g, nm, meta);
      if (f.last_agent) { const a = avatar(f.last_agent, 'xs'); n.insertBefore(a, meta); }
      if (changed && animate) { n.classList.remove('flash'); void n.offsetWidth; n.classList.add('flash'); }
    }
    seen.add(key);
    if (k.rl.children[i] !== n) k.rl.insertBefore(n, k.rl.children[i] || null);
    if (isNew && animate) { n.classList.add('enter'); setTimeout(() => n.classList.remove('enter'), 400); }
  });
  while (k.rl.children.length > rec.length) k.rl.lastElementChild.remove();
  for (const [key, n] of BUILD.rows) if (!seen.has(key)) { n.remove(); BUILD.rows.delete(key); }
  k.rmore.hidden = recAll.length <= rec.length;
  setText(k.rmore, `Show more (${fmtN(recAll.length - rec.length)})`);
}

/* ================= contracts ================= */
const openSpecs = new Set();
function renderContracts(st) {
  const cs = st.contracts || [];
  setText($('#tc-contracts'), cs.length || '');
  const el = $('#contracts');
  const sig = cs.map((c) => `${c.id}:${c.version}:${c.status}:${c.updated_at}:${(c.consumers || []).join(',')}`).join('|');
  if (el._sig === sig) return;
  el._sig = sig; el.replaceChildren();
  if (!cs.length) { el.append(h('div', 'empty', 'No integration contracts yet. When agents agree on an API, event or schema between their parts, it lands here.')); return; }
  const order = { proposed: 0, agreed: 1, implemented: 2, retired: 3 };
  for (const c of cs.slice().sort((a, b) => (order[a.status] ?? 1) - (order[b.status] ?? 1) || (b.updated_at || 0) - (a.updated_at || 0))) {
    const k = h('div', 'contract'); k.dataset.s = c.status;
    const top = h('div', 'k-top');
    const st2 = h('span', 'status-pill', c.status); st2.dataset.s = c.status;
    const nm = h('span', 'k-name', c.name); nm.title = c.name;
    top.append(st2, nm);
    if (c.kind) top.append(h('span', 'k-kind', c.kind));
    top.append(h('span', 'k-ver', 'v' + (c.version || 1)));
    const meta = h('div', 'k-meta');
    if (c.owner) { meta.append(h('span', 'lbl', 'Owner')); meta.append(agentChip(c.owner)); }
    if ((c.consumers || []).length) { meta.append(h('span', 'lbl', 'Used by')); for (const x of c.consumers) meta.append(agentChip(x)); }
    meta.append(timeEl(c.updated_at));
    k.append(top, meta);
    if (c.spec) {
      const b = h('button', 'btn sm k-spec-btn'); b.type = 'button';
      const pre = h('pre', 'k-spec', c.spec);
      const isOpen = openSpecs.has(c.name);
      pre.hidden = !isOpen; setText(b, isOpen ? 'Hide spec' : 'Show spec');
      b.setAttribute('aria-expanded', String(isOpen));
      b.addEventListener('click', () => {
        const o = pre.hidden; pre.hidden = !o; setText(b, o ? 'Hide spec' : 'Show spec'); b.setAttribute('aria-expanded', String(o));
        if (o) openSpecs.add(c.name); else openSpecs.delete(c.name);
      });
      k.append(b, pre);
    }
    el.append(k);
  }
}

/* ================= composer ================= */
function renderRecipients(st) {
  const sel = $('#c-to');
  const live = st.agents.filter((a) => a.status !== 'offline').map((a) => a.id);
  const off = st.agents.filter((a) => a.status === 'offline').map((a) => a.id);
  const sig = live.join(',') + '|' + off.join(',');
  if (sel._sig === sig) return;
  sel._sig = sig;
  const cur = sel.value;
  sel.replaceChildren();
  const add = (v, l, parent = sel) => { const o = h('option', null, l); o.value = v; parent.append(o); };
  add('', 'Everyone'); add('humans', 'Humans');
  if (live.length) { const g = h('optgroup'); g.label = 'Live'; live.forEach((id) => add(id, '@' + id, g)); sel.append(g); }
  if (off.length) { const g = h('optgroup'); g.label = 'Offline'; off.slice(0, 50).forEach((id) => add(id, '@' + id, g)); sel.append(g); }
  sel.value = [...sel.options].some((o) => o.value === cur) ? cur : '';
}
function autosize() {
  const ta = $('#c-body');
  $('#c-send').disabled = !ta.value.trim();
  if (!ta.offsetParent) return; // hidden pane (phone view): measure when it shows
  ta.style.height = 'auto';
  ta.style.height = Math.min(160, ta.scrollHeight) + 'px';
  ta.style.overflowY = ta.scrollHeight > 160 ? 'auto' : 'hidden';
  $('#c-send').disabled = !ta.value.trim();
}
function setReply(m) {
  S.replyTo = m;
  const el = $('#c-reply');
  if (!m) { el.hidden = true; el.replaceChildren(); return; }
  el.hidden = false; el.replaceChildren();
  el.append(h('span', null, `Answering ${who(m.sender)}`));
  const x = h('button', 'icon-btn'); x.type = 'button'; x.setAttribute('aria-label', 'Cancel answer'); x.append(icon('close', 12));
  x.addEventListener('click', () => { setReply(null); $('#c-kind').value = 'chat'; });
  el.append(x);
}
async function sendMessage(e) {
  e?.preventDefault();
  const ta = $('#c-body'); const body = ta.value.trim();
  if (!body || !canEdit()) return;
  let to = $('#c-to').value || undefined;
  if (!to) { const m = body.match(/^@([a-z0-9][a-z0-9-]*)/i); if (m && S.agentById.has(m[1].toLowerCase())) to = m[1].toLowerCase(); }
  const payload = { project: S.project, name: myName(), body, kind: $('#c-kind').value, ...(to ? { to } : {}) };
  if (S.replyTo) { payload.reply_to = S.replyTo.id; if (S.replyTo.task_id) payload.task_id = S.replyTo.task_id; }
  const btn = $('#c-send'); btn.disabled = true;
  try {
    const msg = await api('api/human/post', payload);
    ta.value = ''; autosize();
    setReply(null); $('#c-kind').value = 'chat';
    if (msg && msg.id) withFeed(() => addMessage(msg, true), { force: true });
    scheduleRefetch(0);
  } catch (err) { fail(err); btn.disabled = false; }
  ta.focus();
}

/* ================= tabs, views ================= */
function setTab(tab) {
  S.tab = tab;
  for (const b of $('#side-tabs').querySelectorAll('[role=tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
  for (const p of document.querySelectorAll('.tabpanel')) p.hidden = p.dataset.panel !== tab;
  moveTabInd(true);
  if (tab === 'build') { BUILD.dirty = true; scheduleBuild(0); }
  if (S.data) renderSide(S.data);
  if (tab === 'channel') { const f = feed.el; f.scrollTop = f.scrollHeight; }
}
function moveTabInd(animate) {
  const tabs = $('#side-tabs'); placePill(tabs, !!animate);
  const on = tabs.querySelector('[aria-selected="true"]');
  if (on && on.offsetWidth) { const l = on.offsetLeft, r = l + on.offsetWidth; if (l < tabs.scrollLeft) tabs.scrollLeft = l - 4; else if (r > tabs.scrollLeft + tabs.clientWidth) tabs.scrollLeft = r - tabs.clientWidth + 4; }
}
// tab counters change the tab widths: keep the pill on the selected tab
new MutationObserver(() => requestAnimationFrame(() => moveTabInd(false))).observe(document.getElementById('side-tabs'), { subtree: true, characterData: true, childList: true });
function setView(v) {
  document.body.dataset.view = v;
  for (const b of $('#mnav').querySelectorAll('button')) b.setAttribute('aria-current', String(b.dataset.view === v));
  if (v === 'side') requestAnimationFrame(() => { moveTabInd(false); autosize(); });
}
function renderSide(st) {
  if (S.tab === 'build' && (BUILD.dirty || BUILD.project !== S.project)) scheduleBuild(BUILD.data ? 1200 : 0);
  if (S.tab === 'files') renderFiles(st);
  else {
    // keep the tab counter fresh without building the whole list
    const n = (st.files || []).length || (st.claims || []).length;
    setText($('#tc-files'), n || '');
  }
  renderContracts(st);
}

/* ================= apply state ================= */
function apply(st, { first = false } = {}) {
  if (st.project && S.project && st.project !== S.project) return; // stale after a switch
  S.data = st;
  S.skew = (st.now || Date.now()) - Date.now();
  S.taskById = new Map(st.tasks.map((t) => [t.id, t]));
  S.agentById = new Map(st.agents.map((a) => [a.id, a]));
  renderProjects(st);
  renderHeader(st);
  renderRoster(st);
  renderBoard(st);
  renderStreams(st);
  renderFeeds(st, !first);
  renderRecipients(st);
  renderSide(st);
  if (S.tab === 'build') { const sig = st.tasks.map((t) => t.id + t.status + (t.area || []).join()).join('|'); if (BUILD.taskSig !== sig) { BUILD.taskSig = sig; scheduleBuild(800); } }
  if (first) { const f = feed.el; f.scrollTop = f.scrollHeight; if (!BUILD.data) loadBuild(); } // one fetch fills the tab count
}

let rfTimer = 0; let rfBusy = false; let rfAgain = false;
function scheduleRefetch(ms = 250) {
  if (rfTimer) { if (ms === 0) { clearTimeout(rfTimer); rfTimer = 0; } else return; }
  rfTimer = setTimeout(() => { rfTimer = 0; refetch(); }, ms);
}
async function refetch() {
  if (rfBusy) { rfAgain = true; return; }
  rfBusy = true;
  try { apply(await api(stateUrl())); }
  catch (e) { if (!(e instanceof AuthError) && S.conn === 'live') fail(e); }
  finally { rfBusy = false; if (rfAgain) { rfAgain = false; scheduleRefetch(); } }
}

/* ================= live stream ================= */
let es = null; let retryT = 0;
function connect() {
  if (es) { es.close(); es = null; }
  clearTimeout(retryT);
  if (!S.project) return;
  setConn('connecting');
  const src = new EventSource('api/stream?project=' + encodeURIComponent(S.project));
  es = src;
  const parse = (ev) => { try { return JSON.parse(ev.data); } catch { return null; } };
  src.addEventListener('open', () => {
    if (es !== src) return;
    const wasDown = S.everLive && S.conn !== 'live';
    setConn('live'); S.everLive = true;
    if (wasDown) scheduleRefetch(0);
  });
  src.addEventListener('error', () => {
    if (es !== src) return;
    if (src.readyState === EventSource.CLOSED) {
      setConn('offline'); src.close(); es = null;
      retryT = setTimeout(async () => {
        try { await api('api/me'); connect(); }
        catch (e) { if (!(e instanceof AuthError)) retryT = setTimeout(connect, 5000); }
      }, 3000);
    } else setConn('reconnecting');
  });
  src.addEventListener('event', (ev) => { if (es === src) onLiveEvent(parse(ev)); });
  src.addEventListener('message', (ev) => {
    if (es !== src) return;
    const m = parse(ev); if (!m || (m.project && m.project !== S.project) || !m.id) return;
    withFeed(() => addMessage(m, true));
    scheduleRefetch();
  });
  src.addEventListener('protocol', () => { if (es === src) scheduleRefetch(); });
}
function onLiveEvent(e) {
  if (!e || (e.project && e.project !== S.project)) return;
  const paths = e.data?.paths || (e.data?.path ? [e.data.path] : null);
  if (e.agent && (e.type === 'touch' || e.type === 'edit' || e.type === 'newfile' || e.type === 'files.changed')) {
    if (paths) recordTouch(e.agent, paths);
    for (const p2 of paths || e.data?.sample || []) flashStream(streamForPath(p2));
    const a = S.agentById.get(e.agent);
    if (a) {
      a.last_seen = srvNow(); if (a.status === 'offline') a.status = 'active';
      if (paths?.[0]) a.last_file = paths[0];
      const n = rosterNodes.get(e.agent); if (n) updateAgentNode(n, a);
    }
    pulseAgent(e.agent);
  } else if (e.agent) {
    const a = S.agentById.get(e.agent);
    if (a && a.status !== 'offline') { a.last_seen = srvNow(); const n = rosterNodes.get(e.agent); if (n) updateAgentNode(n, a); }
  }
  if (!e.ephemeral && e.id) withFeed(() => addEvent(e, true));
  if (e.type === 'files.changed') scheduleBuild(500);
  scheduleRefetch(e.ephemeral ? 700 : 250);
}

/* ================= clock ================= */
function tick() {
  for (const t of document.querySelectorAll('time[data-ts]')) { const v = Number(t.dataset.ts); if (v) setText(t, t.dataset.ago ? agoText(v) : rel(v)); }
  for (const t of document.querySelectorAll('time[data-exp]')) setText(t, until(Number(t.dataset.exp)));
  if (!S.data) return;
  for (const a of S.data.agents) { const n = rosterNodes.get(a.id); if (n) { const p = presence(a); if (n.dataset.p !== p) n.dataset.p = p; } }
  if (S.tab === 'files') tickFiles();
}

/* ================= account: menu, connect, access ================= */
function appearancePicker(el) {
  el.append(h('div', 'sec', 'Appearance'));
  const single = () => (THEMES.find((t) => t.id === appearance.theme)?.modes.length || 2) === 1;
  const modeSeg = seg(['system', 'light', 'dark'], appearance.mode, (m) => { appearance.mode = m; applyAppearance(true); }, (m) => ({ system: 'Match system', light: 'Light', dark: 'Dark' })[m]);
  const note = h('div', 'sec muted', '');
  const syncNote = () => { note.textContent = single() ? `${THEMES.find((t) => t.id === appearance.theme).name} is drawn dark only.` : ''; note.hidden = !single(); };
  const grid = h('div', 'themes'); grid.setAttribute('role', 'radiogroup'); grid.setAttribute('aria-label', 'Theme');
  const cards = [];
  for (const t of THEMES) {
    const b = h('button', 'theme-card'); b.type = 'button'; b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(appearance.theme === t.id));
    const pv = h('div', 'pv'); pv.setAttribute('aria-hidden', 'true');
    pv.dataset.theme = t.id; pv.dataset.mode = resolveMode(t.id, appearance.mode);
    const tile = h('div', 'pv-tile'); tile.append(h('span', 'pv-name', 'Sb'), h('span', 'pv-btn'));
    const dots = h('div', 'pv-dots'); for (const k of ['ready', 'wait', 'live']) dots.append(h('span', 'dot ' + k));
    pv.append(tile, dots);
    b.append(pv, h('span', 'tn', t.name));
    b.addEventListener('click', () => {
      appearance.theme = t.id; applyAppearance(true);
      for (const c of cards) c.setAttribute('aria-checked', String(c === b));
      syncNote();
    });
    cards.push(b); grid.append(b);
  }
  modeSeg.addEventListener('click', () => { for (const c of cards) { const id = THEMES[cards.indexOf(c)].id; c.firstChild.dataset.mode = resolveMode(id, appearance.mode); } });
  syncNote();
  el.append(modeSeg, note, grid);
}
/** The name everyone sees for you on the board. Empty = back to the automatic alias. */
function nameForm() {
  const f = h('form', 'name-form'); f.noValidate = true;
  const id = 'sb-name-input';
  const lab = h('label', null, 'Name on the board'); lab.htmlFor = id;
  const inp = h('input'); inp.id = id; inp.type = 'text'; inp.maxLength = 40; inp.autocomplete = 'nickname'; inp.spellcheck = false;
  inp.value = S.me.custom_name ? S.me.name : ''; inp.placeholder = S.me.custom_name ? '' : `${S.me.name} (automatic)`;
  const save = h('button', 'btn sm primary', 'Save'); save.type = 'submit';
  const hint = h('p', 'hint', 'Everyone on this project sees it. Leave empty for your automatic alias.');
  const row = h('div', 'row'); row.append(inp, save);
  f.append(lab, row, hint);
  f.addEventListener('submit', async (ev) => {
    ev.preventDefault(); save.disabled = true;
    try { S.me = await api('api/me/name', { name: inp.value.trim() }); renderMe(); closePop(); toast(`You appear as “${S.me.name}”.`); }
    catch (e) { fail(e); } finally { save.disabled = false; }
  });
  return f;
}
function accountMenu(el) {
  const w = h('div', 'who');
  w.append(avatar('human:' + myName(), 'md'), h('b', null, S.me.name || myName()), h('span', null, S.me.email || ''));
  const r = h('span', 'badge role', S.me.role); r.dataset.r = S.me.role;
  w.append(r);
  el.append(w, h('hr'));
  if (ghMode()) el.append(nameForm(), h('hr'));
  appearancePicker(el);
  el.append(h('hr'));
  if (S.project) el.append(popItem('Copy agent prompt', () => copyAgentPrompt(), { iconName: 'copy' }));
  if (ghMode()) { if (S.project) el.append(popItem('Agent prompt', () => openConnect(true), { iconName: 'key' })); }
  else {
    if (canEdit()) el.append(popItem('Connect an agent', () => openConnect(), { iconName: 'key' }));
    if (isAdmin() && S.project) el.append(popItem('Project settings', () => openProjectSettings(), { iconName: 'branch' }));
    if (isAdmin()) el.append(popItem('Access', () => openAccess(), { iconName: 'shield' }));
  }
  if (S.me.auth !== 'off' && S.me.auth !== 'local' && !ghMode()) el.append(popItem('Sign out', async () => { closePop(); try { await api('api/logout', {}); } catch { /* ignore */ } resetAll(); S.me = null; renderMe(); showGate('signin'); }, { iconName: 'out' }));
}
function copyBtn(text) {
  const b = h('button', 'btn sm'); b.type = 'button';
  b.append(icon('copy', 13), h('span', null, 'Copy'));
  b.addEventListener('click', async () => {
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch { ok = false; }
    setText(b.lastChild, ok ? 'Copied' : 'Select & copy');
    setTimeout(() => setText(b.lastChild, 'Copy'), 1600);
  });
  return b;
}
function codeRow(text) {
  const r = h('div', 'codebox'); r.append(h('code', null, text), copyBtn(text)); return r;
}
function secretBox(token, forWhom) {
  const box = h('div', 'secret');
  box.append(h('div', 'warn', `Copy this token now — it won’t be shown again${forWhom ? ` (for ${forWhom})` : ''}.`));
  box.append(codeRow(token));
  box.append(h('p', 'lbl2', 'On the machine where the agent runs, in the repo folder:'));
  box.append(codeRow(`node connect.mjs --url ${baseUrl()} --token ${token}`));
  const p = h('p', 'muted small');
  p.append('Rather not paste the token into a command? Set ', h('code', 'inline', 'SWITCHBOARD_TOKEN'), ' in the environment and leave out --token. ');
  const a = h('a', null, 'Download connect.mjs'); a.href = 'connect.mjs'; a.setAttribute('download', 'connect.mjs');
  p.append(a);
  box.append(p);
  return box;
}
function confirmRevoke(btn, what, run) {
  const wrap = h('span', 'confirm');
  const q = h('span', 'muted', `Revoke ${what}?`);
  const yes = h('button', 'btn sm danger', 'Revoke'); yes.type = 'button';
  const no = h('button', 'btn sm', 'Cancel'); no.type = 'button';
  wrap.append(q, yes, no);
  btn.replaceWith(wrap); yes.focus();
  no.addEventListener('click', () => { wrap.replaceWith(btn); btn.focus(); });
  yes.addEventListener('click', async () => { yes.disabled = true; try { await run(); } catch (e) { fail(e); wrap.replaceWith(btn); } });
}
/* Tailored agent prompt (api/prompt): pasted into any AI's system / custom instructions. */
const promptCache = { project: null, text: null, at: 0, pending: null };
function loadPrompt(force) {
  const pj = S.project;
  if (!pj) return Promise.resolve(null);
  if (!force && promptCache.project === pj && promptCache.text != null && Date.now() - promptCache.at < 60000) return Promise.resolve(promptCache.text);
  if (promptCache.pending && promptCache.pending.project === pj) return promptCache.pending.p;
  const p = api('api/prompt?project=' + encodeURIComponent(pj)).then((r) => {
    if (S.project !== pj) return null;
    Object.assign(promptCache, { project: pj, text: String(r?.text ?? ''), at: Date.now() });
    return promptCache.text;
  }).finally(() => { if (promptCache.pending?.p === p) promptCache.pending = null; });
  promptCache.pending = { project: pj, p };
  return p;
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}
async function copyAgentPrompt() {
  closePop();
  try {
    const text = promptCache.project === S.project && promptCache.text != null ? promptCache.text : await loadPrompt();
    if (!text) { toast('No prompt for this project yet.', true); return; }
    if (await copyText(text)) toast('Agent prompt copied'); else openConnect(true);
  } catch (e) { fail(e); }
}
function promptSection() {
  const sec = h('section', 'prompt-sec');
  const head = h('div', 'prompt-head');
  head.append(h('h3', null, 'Agent prompt'));
  const copy = h('button', 'btn sm'); copy.type = 'button'; copy.append(icon('copy', 13), h('span', null, 'Copy'));
  copy.disabled = true;
  head.append(copy);
  const pre = h('pre', 'prompt-box', 'Loading…'); pre.tabIndex = 0; pre.setAttribute('aria-label', 'Agent prompt');
  const note = h('p', 'muted small');
  note.append('Paste into your AI’s system/custom instructions. Claude Code in a connected repo gets this automatically; other tools read AGENTS.md (', h('code', 'inline', 'node connect.mjs prompt --out AGENTS.md'), ').');
  sec.append(head, pre, note);
  let text = '';
  const fill = (force) => {
    const pj = S.project;
    if (!pj) { pre.textContent = 'Pick a project first.'; return; }
    loadPrompt(force).then((t) => {
      if (S.project !== pj || !pre.isConnected) return;
      text = t || ''; pre.textContent = text || 'No prompt for this project yet.'; copy.disabled = !text;
    }).catch((e) => { pre.textContent = 'Couldn’t load the prompt.'; fail(e); });
  };
  copy.addEventListener('click', async () => {
    const ok = await copyText(text);
    setText(copy.lastChild, ok ? 'Copied' : 'Select & copy');
    if (!ok) { const r = document.createRange(); r.selectNodeContents(pre); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); }
    setTimeout(() => setText(copy.lastChild, 'Copy'), 1600);
  });
  sec._refresh = fill;
  fill(true);
  return sec;
}

function openConnect(focusPrompt) {
  if (ghMode()) { openDrawer('Agent prompt', (body) => body.append(promptSection())); return; }
  openDrawer('Connect an agent', (body) => {
    const ps = promptSection();
    if (focusPrompt) body.append(ps);
    body.append(h('p', null, 'Create a personal token for each machine or agent you run. Your agents act as you on this Switchboard, so revoke a token when a machine is retired.'));
    const f = h('form', 'form-row');
    const fl = h('div', 'field'); const l = h('label', null, 'Label'); l.htmlFor = 'tk-label';
    const inp = h('input'); inp.id = 'tk-label'; inp.type = 'text'; inp.maxLength = 80; inp.placeholder = 'e.g. Work laptop'; inp.required = true;
    fl.append(l, inp);
    const go = h('button', 'btn primary', 'Create token'); go.type = 'submit';
    f.append(fl, go);
    const out = h('div');
    const lh = h('h3', null, 'Your tokens');
    const listEl = h('div', 'list');
    body.append(f, out, lh, listEl);
    if (!focusPrompt) body.append(ps);
    for (const el of [...body.children]) if (el !== ps) el.dataset.edit = ''; // viewers see only the prompt
    const load = async () => {
      if (!canEdit()) return;
      listEl.replaceChildren(h('div', 'empty', 'Loading…'));
      let rows;
      try { rows = await api('api/tokens'); } catch (e) { fail(e); listEl.replaceChildren(h('div', 'empty', 'Couldn’t load tokens.')); return; }
      listEl.replaceChildren();
      if (!rows?.length) { listEl.append(h('div', 'empty', 'No tokens yet.')); return; }
      rows.sort((a, b) => (!!a.revoked_at - !!b.revoked_at) || (b.created_at || 0) - (a.created_at || 0));
      for (const t of rows) {
        const li = h('div', 'li'); if (t.revoked_at) li.classList.add('revoked');
        const g = h('div', 'grow');
        g.append(h('div', 't1', t.label || 'Untitled token'));
        const sub = [t.email, `created ${rel(t.created_at)} ago`, t.last_used ? `used ${rel(t.last_used)} ago` : 'never used', t.revoked_at ? `revoked ${rel(t.revoked_at)} ago` : ''].filter(Boolean).join(' · ');
        g.append(h('div', 't2', sub));
        li.append(icon('key', 15), g);
        if (!t.revoked_at) {
          const rb = h('button', 'btn sm', 'Revoke'); rb.type = 'button';
          rb.addEventListener('click', () => confirmRevoke(rb, `“${t.label || 'token'}”`, async () => { await api('api/tokens/revoke', { id: t.id }); toast('Token revoked'); load(); }));
          li.append(rb);
        }
        listEl.append(li);
      }
    };
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const label = inp.value.trim(); if (!label) return;
      go.disabled = true;
      try {
        const r = await api('api/tokens', { label });
        out.replaceChildren(secretBox(r.token));
        inp.value = '';
        load();
      } catch (err) { fail(err); } finally { go.disabled = false; }
    });
    load();
  });
}
function openAccess() {
  if (!isAdmin()) return;
  openDrawer('Access', (body) => {
    body.append(h('p', null, 'Only people on this list can open Switchboard. Adding someone here lets them sign in with single sign-on, or use a token you issue them.'));
    const f = h('form');
    const row1 = h('div', 'form-row');
    const mk = (id, label, type, ph, cls) => { const fl = h('div', 'field' + (cls ? ' ' + cls : '')); const l = h('label', null, label); l.htmlFor = id; const i = h('input'); i.id = id; i.type = type; if (ph) i.placeholder = ph; fl.append(l, i); return [fl, i]; };
    const [fe, email] = mk('ac-email', 'Email', 'email', 'name@company.com'); email.required = true;
    const [fn, name] = mk('ac-name', 'Name (optional)', 'text', '');
    row1.append(fe, fn);
    const row2 = h('div', 'form-row');
    const fr = h('div', 'field sm'); const rl = h('label', null, 'Role'); rl.htmlFor = 'ac-role';
    const role = h('select'); role.id = 'ac-role';
    const roles = S.me.role === 'owner' ? ['viewer', 'member', 'admin', 'owner'] : ['viewer', 'member', 'admin'];
    for (const r of roles) { const o = h('option', null, r[0].toUpperCase() + r.slice(1)); o.value = r; role.append(o); }
    role.value = 'member';
    fr.append(rl, role);
    const ck = h('label', 'check'); ck.htmlFor = 'ac-issue';
    const cb = h('button', 'switch'); cb.type = 'button'; cb.id = 'ac-issue'; cb.setAttribute('role', 'switch'); cb.setAttribute('aria-checked', 'false');
    cb.addEventListener('click', () => cb.setAttribute('aria-checked', String(cb.getAttribute('aria-checked') !== 'true')));
    ck.append(cb, h('span', null, 'Issue a token now'));
    const go = h('button', 'btn primary', 'Add to allowlist'); go.type = 'submit';
    row2.append(fr, ck, h('div', 'spacer'), go);
    f.append(row1, row2);
    const out = h('div');
    const lh = h('h3', null, 'Members');
    const listEl = h('div', 'list');
    body.append(f, out, lh, listEl);
    const load = async () => {
      listEl.replaceChildren(h('div', 'empty', 'Loading…'));
      let rows;
      try { rows = await api('api/admin/members'); } catch (e) { fail(e); listEl.replaceChildren(h('div', 'empty', 'Couldn’t load members.')); return; }
      listEl.replaceChildren();
      if (!rows?.length) { listEl.append(h('div', 'empty', 'Nobody yet.')); return; }
      const rank = { owner: 0, admin: 1, member: 2, viewer: 3 };
      rows.sort((a, b) => (!!a.revoked_at - !!b.revoked_at) || (rank[a.role] - rank[b.role]) || String(a.email).localeCompare(b.email));
      for (const m of rows) {
        const li = h('div', 'li'); if (m.revoked_at) li.classList.add('revoked');
        li.append(avatar('human:' + (m.name || m.email), 'md'));
        const g = h('div', 'grow');
        g.append(h('div', 't1', m.name || m.email));
        const sub = [m.name ? m.email : '', m.revoked_at ? `revoked ${rel(m.revoked_at)} ago` : (m.last_login ? `last in ${rel(m.last_login)} ago` : 'never signed in'), m.added_by ? `added by ${m.added_by}` : ''].filter(Boolean).join(' · ');
        g.append(h('div', 't2', sub));
        const rp = h('span', 'role', m.role); rp.dataset.r = m.role;
        li.append(g, rp);
        const ed = h('button', 'btn sm', m.revoked_at ? 'Restore' : 'Edit'); ed.type = 'button';
        ed.addEventListener('click', () => { email.value = m.email; name.value = m.name || ''; if (roles.includes(m.role)) role.value = m.role; email.focus(); setText(go, m.revoked_at ? 'Restore access' : 'Save'); });
        li.append(ed);
        if (!m.revoked_at && m.email !== S.me.email) {
          const rb = h('button', 'btn sm', 'Revoke'); rb.type = 'button';
          rb.addEventListener('click', () => confirmRevoke(rb, m.email, async () => { await api('api/admin/members/revoke', { email: m.email }); toast('Access revoked'); load(); }));
          li.append(rb);
        }
        listEl.append(li);
      }
    };
    email.addEventListener('input', () => setText(go, 'Add to allowlist'));
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const em = email.value.trim().toLowerCase(); if (!em) return;
      go.disabled = true;
      try {
        const r = await api('api/admin/members', { email: em, name: name.value.trim() || undefined, role: role.value, ...(cb.getAttribute('aria-checked') === 'true' ? { issue_token: true } : {}) });
        out.replaceChildren();
        if (r?.token) out.append(secretBox(r.token, em));
        else toast(`${em} can now sign in`);
        email.value = ''; name.value = ''; cb.setAttribute('aria-checked', 'false'); role.value = 'member'; setText(go, 'Add to allowlist');
        load();
      } catch (err) { fail(err); } finally { go.disabled = false; }
    });
    load();
  });
}

/** "GitHub Issues": two-way sync of tasks with issues in the main repo. */
function issuesSection() {
  const sec = h('section', 'card-sec');
  sec.append(h('h3', null, 'GitHub Issues'));
  const repo = S.data?.project_info?.main_repo || null;
  const on = !!S.data?.project_info?.issues_sync;
  const row = h('div', 'set-row');
  const txt = h('label', 'txt'); txt.htmlFor = 'gh-sync';
  txt.append(h('b', null, repo ? `Sync tasks with GitHub Issues in ${repo}` : 'Sync tasks with GitHub Issues'));
  const why = !repo ? 'Link a main repo above first.' : !S.me?.github_token ? 'The server needs a GitHub token with Issues read/write — ask the owner.' : '';
  if (why) txt.append(h('span', null, why));
  const sw = h('button', 'switch'); sw.type = 'button'; sw.id = 'gh-sync'; sw.setAttribute('role', 'switch');
  sw.setAttribute('aria-checked', String(on)); sw.disabled = !!why;
  row.append(txt, sw);
  const note = h('p', 'muted small');
  note.append('Tasks become issues (labels switchboard, sb:status, P0–P4); closing/reopening an issue updates the board; new issues labelled ‘switchboard’ become tasks. GitHub webhook: ', h('code', 'inline', `${baseUrl()}api/github/webhook`), ' (issues events).');
  sec.append(row, note);
  sw.addEventListener('click', async () => {
    const want = sw.getAttribute('aria-checked') !== 'true';
    sw.setAttribute('aria-checked', String(want)); sw.disabled = true;
    try {
      const r = await api('api/admin/projects/issues', { project: S.project, enabled: want });
      const v = !!(r && r.issues_sync);
      sw.setAttribute('aria-checked', String(v));
      if (S.data?.project_info) S.data.project_info.issues_sync = v ? 1 : 0;
      toast(v ? 'GitHub Issues sync on' : 'GitHub Issues sync off');
      scheduleRefetch(0);
    } catch (e) { sw.setAttribute('aria-checked', String(!want)); fail(e); }
    finally { sw.disabled = false; }
  });
  return sec;
}

/** "GitHub README card": a live SVG status card for the repo's README (public URL gated by a revocable key). */
function readmeCardSection() {
  const sec = h('section', 'card-sec');
  sec.append(h('h3', null, 'GitHub README card'));
  sec.append(h('p', null, 'A live status card for the repo’s README. Anyone with the image link can see the counts it shows.'));
  let detail = 'counts';
  const row = h('div', 'form-row');
  const pick = seg(['counts', 'tasks'], detail, (v) => { detail = v; }, (v) => (v === 'counts' ? 'Counts only' : 'Counts + in-progress tasks'));
  const make = h('button', 'btn primary', 'Create card'); make.type = 'button';
  row.append(pick, h('div', 'spacer'), make);
  const out = h('div', 'card-out');
  const revoke = h('button', 'btn sm', 'Revoke card'); revoke.type = 'button';
  const foot = h('div', 'form-row card-foot'); foot.append(revoke);
  const note = h('p', 'muted small');
  note.append('Add this to the repo README (or run ', h('code', 'inline', 'node connect.mjs init'), ' with an admin token — it inserts it automatically). GitHub shows it on the repo home page; it updates live.');
  sec.append(row, out, note, foot);
  let timer = 0;
  const preview = (key) => {
    const fig = h('div', 'card-preview');
    const img = h('img'); img.alt = 'Switchboard README card preview'; img.decoding = 'async';
    const src = () => `card/${encodeURIComponent(key)}.svg?v=${Date.now()}`;
    img.src = src();
    img.addEventListener('error', () => { fig.classList.add('broken'); });
    fig.append(img);
    clearInterval(timer);
    timer = setInterval(() => { if (!img.isConnected) { clearInterval(timer); return; } img.src = src(); }, 15000);
    return fig;
  };
  make.addEventListener('click', async () => {
    make.disabled = true;
    try {
      const r = await api('api/admin/projects/card', { project: S.project, detail });
      const key = String(r?.key || '');
      out.replaceChildren();
      if (!/^[\w-]+$/.test(key)) throw new Error('The server returned no card key.');
      out.append(preview(key));
      const w = h('div', 'secret');
      w.append(h('div', 'warn', 'Copy the README snippet now — it isn’t shown again. Creating a new card rotates the key, and the old README image stops working.'));
      w.append(codeRow(String(r.markdown || '')));
      out.append(w);
      setText(make, 'Create new card');
    } catch (e) { fail(e); } finally { make.disabled = false; }
  });
  revoke.addEventListener('click', () => confirmRevoke(revoke, 'the README card (the image in the README stops working)', async () => {
    await api('api/admin/projects/card', { project: S.project, revoke: true });
    clearInterval(timer); out.replaceChildren(); setText(make, 'Create card');
    toast('README card revoked');
    foot.replaceChildren(revoke);
  }));
  return sec;
}

function openProjectSettings() {
  if (!isAdmin() || !S.project) return;
  openDrawer('Project settings', (body) => {
    const info = h('dl', 'kv');
    const fill = () => {
      const pi = S.data?.project_info || {}; const p = S.data?.protocol || {}; const pj = p.project || null;
      info.replaceChildren();
      const row = (k, v, err) => { info.append(h('dt', null, k), h('dd', err ? 'err' : null, v)); };
      row('Project', pi.name || S.project);
      if (pi.remote) row('Remote', pi.remote);
      row('Main repo', pi.main_repo ? `${pi.main_repo} · ${pi.main_ref || 'default branch'}` : 'Not linked');
      row('Universal intro', `${p.source || '—'} @ ${p.sha ? String(p.sha).slice(0, 12) : '—'}`);
      if (pj) row('Project rules', pj.error ? pj.error : `${pj.repo || ''}${pj.path ? '/' + pj.path : ''} @ ${pj.sha ? String(pj.sha).slice(0, 12) : 'not fetched yet'}`, !!pj.error);
    };
    fill();
    body.append(h('p', null, 'Link this project to its main repo. Every agent’s intro then adds the repo’s .switchboard/INTRO.md on top of the universal rules.'), info);
    const f = h('form');
    const row1 = h('div', 'form-row');
    const mk = (id, label, ph, cls) => { const fl = h('div', 'field' + (cls ? ' ' + cls : '')); const l = h('label', null, label); l.htmlFor = id; const i = h('input'); i.id = id; i.type = 'text'; i.placeholder = ph; i.spellcheck = false; fl.append(l, i); return [fl, i]; };
    const [fr, repo] = mk('pj-repo', 'Main repo', 'owner/repo');
    const [fb, ref] = mk('pj-ref', 'Branch (optional)', 'main', 'sm');
    repo.required = true;
    repo.value = S.data?.project_info?.main_repo || ''; ref.value = S.data?.project_info?.main_ref || '';
    row1.append(fr, fb);
    const row2 = h('div', 'form-row');
    const refresh = h('button', 'btn', 'Refresh intro'); refresh.type = 'button';
    const go = h('button', 'btn primary', 'Link repo'); go.type = 'submit';
    row2.append(refresh, h('div', 'spacer'), go);
    f.append(row1, row2);
    body.append(f);
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const main_repo = repo.value.trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/, '').replace(/\/+$/, '');
      if (!/^[\w.-]+\/[\w.-]+$/.test(main_repo)) { toast('Use the form owner/repo', true); repo.focus(); return; }
      go.disabled = true;
      try {
        const r = await api('api/admin/projects/link', { project: S.project, main_repo, ...(ref.value.trim() ? { ref: ref.value.trim() } : {}) });
        if (S.data) { if (r?.project) S.data.project_info = r.project; if (S.data.protocol && r && 'intro' in r) S.data.protocol.project = r.intro; }
        fill(); renderHeader(S.data);
        toast(r?.intro?.error ? `Linked, but the intro couldn’t be read: ${r.intro.error}` : 'Main repo linked', !!r?.intro?.error);
        scheduleRefetch(0);
      } catch (err) { fail(err); } finally { go.disabled = false; }
    });
    body.append(issuesSection(), readmeCardSection());
    refresh.addEventListener('click', async () => {
      refresh.disabled = true;
      try {
        const r = await api('api/admin/protocol/refresh', { project: S.project });
        if (S.data?.protocol && r) S.data.protocol = { ...S.data.protocol, ...r, project: r.project ?? S.data.protocol.project };
        fill(); renderHeader(S.data);
        toast(r?.project?.error ? `Project rules: ${r.project.error}` : 'Intro refreshed', !!r?.project?.error);
        scheduleRefetch(0);
      } catch (err) { fail(err); } finally { refresh.disabled = false; }
    });
  });
}

/* ================= branding (server config: api/brand, also on api/me) ================= */
let brand = null; // {name, sso_label, sso}
async function loadBrand() {
  try {
    const r = await fetch('api/brand', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    if (r.ok) brand = await r.json();
  } catch { /* offline: keep defaults */ }
  applyBrand();
}
function applyBrand() {
  const b = { ...(brand || {}) };
  if (S.me) { if (S.me.brand !== undefined) b.name = S.me.brand; if (S.me.sso_label !== undefined) b.sso_label = S.me.sso_label; if (S.me.sso !== undefined) b.sso = S.me.sso; }
  const nm = $('#brand-name');
  setText(nm, b.name || ''); nm.hidden = !b.name;
  document.title = 'Switchboard';
  setText($('#sso'), b.sso_label ? `Sign in with ${b.sso_label}` : 'Single sign-on');
  return b;
}

/* ================= sign-in gate ================= */
async function showGate(kind) {
  const gate = $('#gate');
  closePop(true);
  if (!drawer.hidden) { drawer.hidden = true; }
  if (es) { es.close(); es = null; }
  clearTimeout(retryT);
  setConn('offline');
  document.body.classList.remove('booting');
  gate.hidden = false;
  $('#gate-signin').hidden = kind !== 'signin';
  $('#gate-denied').hidden = kind !== 'denied';
  if (kind === 'signin') {
    setTimeout(() => $('#token-input').focus(), 60);
    // only offer single sign-on when the server has it configured (api/brand.sso)
    const sso = $('#sso'); const or = $('.gate .or');
    if (!brand) await loadBrand();
    const ok = !!applyBrand().sso;
    sso.hidden = !ok; or.hidden = !ok;
  }
}
function hideGate() { $('#gate').hidden = true; }

/* ================= lifecycle ================= */
function resetAll() {
  feed.reset(); activity.reset();
  for (const n of cardNodes.values()) { n._anim?.cancel(); }
  cardNodes.clear(); rosterNodes.clear();
  $('#roster-live').replaceChildren(); $('#roster-off').replaceChildren();
  buildCols();
  filesSkel = null; fileRows.clear(); fileGroups.clear(); $('#files').replaceChildren();
  $('#contracts')._sig = null;
  S.boardRendered = false; S.data = null; S.recentTouch.clear(); setReply(null);
  resetBuild();
  resetStreams();
}
function rememberProject() {
  store.set('sb.project', S.project);
  const u = new URL(location.href);
  if (u.searchParams.get('project') !== S.project) { u.searchParams.set('project', S.project); history.replaceState(null, '', u); }
}
async function switchProject(id) {
  if (!id || id === S.project) return;
  S.project = id; rememberProject();
  resetAll();
  for (const sec of document.querySelectorAll('.prompt-sec')) sec._refresh?.(true);
  try { apply(await api(stateUrl()), { first: true }); } catch (e) { fail(e); }
  connect();
}
async function boot() {
  const params = new URLSearchParams(location.search);
  if (params.has('denied')) {
    const u = new URL(location.href); u.searchParams.delete('denied'); history.replaceState(null, '', u);
    showGate('denied'); return;
  }
  try { S.me = await api('api/me'); } catch (e) { if (!(e instanceof AuthError)) { toast(e.message, true); document.body.classList.remove('booting'); setTimeout(boot, 4000); } return; }
  hideGate(); renderMe(); applyBrand();
  S.project = params.get('project') || store.get('sb.project') || null;
  try {
    const projects = (await api('api/projects')) || [];
    const known = S.project && (params.has('project') || projects.some((p) => p.id === S.project));
    if (!known && projects.length) S.project = projects.slice().sort((a, b) => (b.live - a.live) || (b.open_tasks - a.open_tasks))[0].id;
    resetAll();
    if (S.project) {
      const st = await api(stateUrl());
      S.project = st.project || S.project;
      rememberProject();
      apply(st, { first: true });
      connect();
    } else {
      renderProjects({ projects: [] });
      setConn('offline');
      setText($('#conn span'), 'No projects');
      $('#roster-empty').hidden = false;
    }
  } catch (e) { fail(e); }
  document.body.classList.remove('booting');
  requestAnimationFrame(() => moveTabInd(false));
}

function init() {
  applyAppearance(false);
  $('#brand').prepend(logo());
  $('#gate-card').prepend(logo());
  buildCols();
  $('#add-tasks').append(icon('plus', 13), h('span', null, 'New tasks'));
  $('#c-send').append(icon('send', 16));
  $('#drawer-x').append(icon('close', 16));
  const nav = $('#mnav');
  const navIcons = { roster: 'users', board: 'board', side: 'chat' };
  for (const b of nav.querySelectorAll('button')) { const label = b.textContent; b.replaceChildren(icon(navIcons[b.dataset.view], 18), h('span', null, label)); }
  setView('board');

  $('#project').addEventListener('change', (e) => switchProject(e.target.value));
  setCenterView(store.get('sb.centerView') === 'status' ? 'status' : 'streams', false);
  $('#view-seg').addEventListener('click', (e) => { const b = e.target.closest('[data-cv]'); if (b) setCenterView(b.dataset.cv, true); });
  document.addEventListener('click', (e) => {
    const c = e.target.closest('[data-area]'); if (c && !c.closest('.pop')) { e.preventDefault(); setArea(S.area === c.dataset.area ? null : c.dataset.area); }
  });
  $('#streams').addEventListener('click', (e) => {
    if (e.target.closest('button, a, .ref')) return;
    const card = e.target.closest('.ws'); if (card && card._name) setArea(S.area === card._name ? null : card._name);
  });
  $('#streams').addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList?.contains('ws')) { e.preventDefault(); const n = e.target._name; setArea(S.area === n ? null : n); }
  });
  $('#me').addEventListener('click', (e) => openPop(e.currentTarget, accountMenu));
  $('#main-repo').addEventListener('click', () => { if (isAdmin() && !ghMode()) openProjectSettings(); });
  $('#add-tasks').addEventListener('click', (e) => openPop(e.currentTarget, addTasksPop));
  $('#offline-toggle').addEventListener('click', () => { S.offOpen = !S.offOpen; if (S.data) renderRoster(S.data); });
  $('#side-tabs').addEventListener('click', (e) => { const b = e.target.closest('[role=tab]'); if (b) setTab(b.dataset.tab); });
  $('#side-tabs').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const tabs = [...$('#side-tabs').querySelectorAll('[role=tab]')];
    const i = tabs.findIndex((t) => t.dataset.tab === S.tab);
    const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    setTab(n.dataset.tab); n.focus();
  });
  nav.addEventListener('click', (e) => { const b = e.target.closest('button[data-view]'); if (b) setView(b.dataset.view); });
  $('#qfilter').addEventListener('click', () => {
    S.onlyQ = !S.onlyQ;
    $('#qfilter').setAttribute('aria-pressed', String(S.onlyQ));
    feed.el.classList.toggle('only-q', S.onlyQ);
    if (S.data) renderFeeds(S.data, false);
  });
  $('#jump').addEventListener('click', () => { const f = feed.el; f.scrollTo({ top: f.scrollHeight, behavior: reduced() ? 'auto' : 'smooth' }); $('#jump').hidden = true; });
  feed.el.addEventListener('scroll', () => { if (nearBottom(feed.el)) $('#jump').hidden = true; }, { passive: true });

  // board interactions (delegated)
  $('#cols').addEventListener('click', (e) => {
    if (e.target.closest('[data-act="done-toggle"]')) { S.doneOpen = !S.doneOpen; renderBoard(S.data); return; }
    const card = e.target.closest('.card'); if (!card) return;
    const t = S.taskById.get(Number(card.dataset.id)); if (!t) return;
    const mb = e.target.closest('[data-act="menu"]');
    if (mb) { if (canEdit()) openPop(mb, taskMenu(t)); return; }
    if (e.target.closest('button, a')) return;
    if (getSelection()?.toString()) return;
    card.classList.toggle('open');
  });
  // #ref anywhere
  document.addEventListener('click', (e) => {
    const r = e.target.closest('.ref[data-task]');
    if (r && !r.closest('.pop')) { e.preventDefault(); focusTask(r.dataset.task); return; }
    const ans = e.target.closest('[data-reply]');
    if (ans) {
      const m = (S.data?.messages || []).find((x) => String(x.id) === ans.dataset.reply);
      if (m) {
        setReply(m); $('#c-kind').value = 'answer';
        const to = isHuman(m.sender) ? 'humans' : m.sender;
        if ([...$('#c-to').options].some((o) => o.value === to)) $('#c-to').value = to;
        $('#c-body').focus();
      }
    }
  });
  // composer
  const ta = $('#c-body');
  ta.addEventListener('input', autosize);
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendMessage(); } });
  $('#composer').addEventListener('submit', sendMessage);
  autosize();
  // dismissals
  document.addEventListener('pointerdown', (e) => { if (!pop.hidden && !pop.contains(e.target) && !(popAnchor && popAnchor.contains(e.target))) closePop(); }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!pop.hidden) { const a = popAnchor; closePop(true); a?.focus?.(); return; }
    if (!drawer.hidden) closeDrawer();
  });
  drawer.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeDrawer(); });
  addEventListener('resize', () => { closePop(true); for (const sg of document.querySelectorAll('.seg')) placePill(sg, false); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && S.project && S.me) scheduleRefetch(0); });
  // sign-in
  $('#token-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const inp = $('#token-input'); const err = $('#token-err'); const btn = e.target.querySelector('button');
    const token = inp.value.trim(); if (!token) return;
    btn.disabled = true; err.hidden = true;
    try {
      const r = await fetch('api/login', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-SB': '1' }, body: JSON.stringify({ token }) });
      if (r.ok) { inp.value = ''; hideGate(); await boot(); }
      else { err.textContent = r.status === 429 ? 'Too many attempts. Wait a minute and try again.' : r.status === 401 ? 'That token wasn’t accepted.' : 'Sign-in failed. Try again.'; err.hidden = false; inp.select(); }
    } catch { err.textContent = 'Can’t reach the server.'; err.hidden = false; }
    finally { btn.disabled = false; }
  });
  $('#gate-switch').addEventListener('click', async () => { try { await fetch('api/logout', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-SB': '1' }, body: '{}' }); } catch { /* ignore */ } showGate('signin'); });

  setInterval(tick, 1000);
  loadBrand();
  boot();
}

init();
