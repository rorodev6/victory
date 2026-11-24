// AI tools: Switchboard's MCP server registered in each tool's own config, and DEV's picker that starts
// the tool a developer chose. Project-level configs are committed with the repo (every teammate gets
// them); tools that only read a per-user config are registered on the developer's machine when picked.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync, execFileSync } from 'node:child_process';

const WIN = process.platform === 'win32';
const qa = (a) => (/^[\w./:=@-]+$/.test(a) ? a : `"${String(a).replace(/"/g, '\\"')}"`);
/** Run a command; on Windows through the shell as one quoted command line (tools are .cmd shims there). */
const run = (cmd, args, opts) => (WIN ? spawnSync([cmd, ...args].map(qa).join(' '), { ...opts, shell: true }) : spawnSync(cmd, args, opts));
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const writeJson = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(o, null, 2) + '\n'); };
/** Add or refresh our server inside `key` of a JSON config, keeping everything else in the file. */
function mergeServer(file, key, entry, name = 'switchboard') {
  const cur = fs.existsSync(file) ? readJson(file) : {};
  if (cur === null) return false; // a file we cannot parse is someone else's: leave it alone
  if (JSON.stringify(cur[key]?.[name]) === JSON.stringify(entry)) return true; // already right: no rewrite, no line-ending churn
  cur[key] = { ...(cur[key] || {}), [name]: entry };
  writeJson(file, cur); return true;
}

/** Committed, project-level configs (relative paths / ${workspaceFolder}: nothing machine-specific). */
export function projectConfigs(top) {
  const ws = '${workspaceFolder}/.switchboard/switchboard.mjs';
  const written = [];
  if (mergeServer(path.join(top, '.cursor', 'mcp.json'), 'mcpServers', { command: 'node', args: [ws, 'mcp'] })) written.push('.cursor/mcp.json');
  if (mergeServer(path.join(top, '.vscode', 'mcp.json'), 'servers', { type: 'stdio', command: 'node', args: [ws, 'mcp'] })) written.push('.vscode/mcp.json');
  if (mergeServer(path.join(top, '.gemini', 'settings.json'), 'mcpServers', { command: 'node', args: ['.switchboard/switchboard.mjs', 'mcp'] })) written.push('.gemini/settings.json');
  return written;
}

const serverName = (top) => `switchboard-${path.basename(top).toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 40)}`;
const cli = (top) => path.join(top, '.switchboard', 'switchboard.mjs');

/** Per-user registration for tools without project configs. Returns a line to show, or throws. */
const REGISTER = {
  codex(top) {
    const name = serverName(top);
    run('codex', ['mcp', 'remove', name], { stdio: 'ignore', windowsHide: true });
    const r = run('codex', ['mcp', 'add', name, '--', 'node', cli(top), 'mcp'], { stdio: 'ignore', windowsHide: true });
    if (r.status !== 0) throw new Error(`could not register with Codex. Add it yourself: codex mcp add ${name} -- node "${cli(top)}" mcp`);
    return `Registered with Codex as "${name}".`;
  },
  windsurf(top) {
    const f = path.join(os.homedir(), '.codeium', 'windsurf', 'mcp_config.json');
    if (!mergeServer(f, 'mcpServers', { command: 'node', args: [cli(top), 'mcp'] }, serverName(top))) throw new Error(`could not read ${f}; add Switchboard there by hand`);
    return `Registered with Windsurf as "${serverName(top)}" (${f}).`;
  },
  opencode(top) {
    const f = path.join(os.homedir(), '.config', 'opencode', 'opencode.json');
    const cur = fs.existsSync(f) ? readJson(f) : { $schema: 'https://opencode.ai/config.json' };
    if (cur === null) throw new Error(`could not read ${f}; add Switchboard there by hand`);
    cur.mcp = { ...(cur.mcp || {}), [serverName(top)]: { type: 'local', command: ['node', cli(top), 'mcp'], enabled: true } };
    writeJson(f, cur); return `Registered with opencode as "${serverName(top)}" (${f}).`;
  },
};

const gui = (cmd) => (top) => { (WIN ? spawn(`${cmd} .`, { cwd: top, detached: true, stdio: 'ignore', shell: true, windowsHide: true }) : spawn(cmd, ['.'], { cwd: top, detached: true, stdio: 'ignore' })).unref(); return 'gui'; };
const term = (cmd, args) => (top, prompt) => { run(cmd, args(prompt), { cwd: top, stdio: 'inherit' }); return 'cli'; };

export const TOOLS = [
  { id: 'claude', name: 'Claude Code', cmd: 'claude', get: 'https://claude.com/claude-code', launch: term('claude', (p) => [p]), hooks: true },
  { id: 'codex', name: 'Codex CLI', cmd: 'codex', get: 'https://developers.openai.com/codex/cli', launch: term('codex', (p) => [p]) },
  { id: 'gemini', name: 'Gemini CLI', cmd: 'gemini', get: 'https://github.com/google-gemini/gemini-cli', launch: term('gemini', (p) => ['-i', p]) },
  { id: 'cursor', name: 'Cursor', cmd: 'cursor', get: 'https://cursor.com', launch: gui('cursor') },
  { id: 'vscode', name: 'VS Code (Copilot agent mode)', cmd: 'code', get: 'https://code.visualstudio.com', launch: gui('code') },
  { id: 'windsurf', name: 'Windsurf', cmd: 'windsurf', get: 'https://windsurf.com', launch: gui('windsurf') },
  { id: 'opencode', name: 'opencode', cmd: 'opencode', get: 'https://opencode.ai', launch: term('opencode', () => []) },
  { id: 'none', name: 'No AI tool now (just the board)', cmd: null },
];

export function installed(t) {
  if (!t.cmd) return true;
  try { return run(t.cmd, ['--version'], { stdio: 'ignore', windowsHide: true, timeout: 20_000 }).status === 0; } catch { return false; }
}

function toClipboard(text) {
  try {
    if (WIN) execFileSync('clip', { input: text, windowsHide: true });
    else if (process.platform === 'darwin') execFileSync('pbcopy', { input: text });
    else execFileSync('sh', ['-c', 'command -v wl-copy >/dev/null && wl-copy || xclip -selection clipboard'], { input: text });
    return true;
  } catch { return false; }
}

/** Register (if needed) and start the chosen tool in the project. */
export function start(t, top, prompt, say) {
  if (t.id === 'none') { say(`\nWhen you are ready, open your AI tool in this folder and ask:\n  "${prompt}"\nTools without MCP can use the CLI: see AGENTS.md (node .switchboard/switchboard.mjs prompt --out AGENTS.md).`); return; }
  if (REGISTER[t.id]) { try { say(`- ${REGISTER[t.id](top)}`); } catch (e) { say(`- ${e.message}`); } }
  const kind = t.launch(top, prompt);
  if (kind === 'gui') {
    const copied = toClipboard(prompt);
    say(`\n${t.name} is opening this folder. Switchboard's tools are in its MCP list${t.id === 'vscode' ? ' (Copilot Chat in agent mode; press Start on the server if asked)' : ''}.\nIn its chat, ask:\n  "${prompt}"${copied ? '\n(It is on your clipboard: just paste.)' : ''}`);
  }
}
