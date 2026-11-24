// `switchboard init`: sets a repo up for GitHub-only Switchboard. Everything it writes is plain files you
// review and merge as one PR; from then on every Claude Code session in the repo is coordinated.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const git = (cwd, ...a) => { try { return execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }).trim(); } catch { return ''; } };
const CHECKOUT = 'actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0 (pinned commit)';
const CACHE = 'actions/cache'; const CACHE_SHA = '0057852bfaa89a56745cba8c7296529d2fc39830 # v4.3.0 (pinned commit)';
const WORKFLOW = (branch) => `name: Switchboard
# Runs from the default branch (reviewed code) against the ${branch} branch:
#  1. security checks on everything pushed to the state branch: who really pushed it (GitHub's push log),
#     allowed paths, regular files only, size caps, secret scan, each agent only edits its own records.
#     Invalid changes are restored and reported as an issue. When something cannot be attributed, the run
#     reports and changes nothing.
#  2. tasks <-> GitHub Issues (labels switchboard, sb:<status>, P0-P4)
#  3. renders the board (README.md) and BUILD-LIST.md on the state branch
# The checks keep their memory (last validated commit, who owns which handle, issue links) in the Actions
# cache of the default branch, which workflows on other branches cannot write.
on:
  schedule:
    - cron: '*/10 * * * *'
  workflow_dispatch:
  issues:
    types: [opened, closed, reopened, edited, labeled]
permissions:
  contents: write   # only to commit to the ${branch} branch
  issues: write
concurrency:
  group: switchboard
  cancel-in-progress: false
jobs:
  sync:
    # never from a side branch: the code and the memory must be the default branch's
    if: github.event_name != 'workflow_dispatch' || github.ref == format('refs/heads/{0}', github.event.repository.default_branch)
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: ${CHECKOUT}
        with:
          persist-credentials: false
      - uses: ${CHECKOUT}
        with:
          ref: ${branch}
          path: _state
          fetch-depth: 0
      - uses: ${CACHE}/restore@${CACHE_SHA}
        with:
          path: .sb-ci
          key: sb-ci-\${{ github.run_id }}-\${{ github.run_attempt }}
          restore-keys: sb-ci-
      - name: Check, mirror, render
        env:
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
        run: node .switchboard/switchboard.mjs ci run --state _state --ci-state .sb-ci/state.json
      - uses: ${CACHE}/save@${CACHE_SHA}
        if: always()
        with:
          path: .sb-ci
          key: sb-ci-\${{ github.run_id }}-\${{ github.run_attempt }}
`;
const INTRO = `# Project rules for Switchboard

<!-- Added to every agent's Switchboard briefing for this project (tracking and logging scope only).
     Change it with a pull request - agents pick it up in their next session. -->

- Work on short-lived branches; one task per branch.
- Ask in the channel before changing shared contracts (API routes, schemas, public component props).
`;

function mergeHooks(file, command) {
  let s = {}; try { s = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* new */ }
  s.hooks = s.hooks || {};
  const ours = (c) => /(switchboard\.mjs|connect\.mjs)"? hook$/.test(String(c || '').trim());
  const add = (event, matcher, timeout) => { const l = (s.hooks[event] = (s.hooks[event] || []).filter((g) => !(g.hooks || []).some((x) => ours(x.command)))); l.push({ ...(matcher ? { matcher } : {}), hooks: [{ type: 'command', command, timeout }] }); };
  add('SessionStart', null, 30); add('PreToolUse', 'Edit|Write|MultiEdit|NotebookEdit', 5); add('PostToolUse', 'Edit|Write|MultiEdit|NotebookEdit|Bash', 5); add('UserPromptSubmit', null, 5); add('SessionEnd', null, 5);
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(s, null, 2) + '\n');
}
function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name), b = path.join(to, e.name);
    if (e.isDirectory()) copyDir(a, b); else fs.copyFileSync(a, b);
  }
}

const DEV_CMD = `@echo off\r
rem switchboard-launcher: start working on this project. Pulls the latest code, signs you in the first\r
rem time, starts the Switchboard board and dashboard, then opens Claude Code here.\r
cd /d "%~dp0"\r
where node >nul 2>nul || (echo Node.js 18 or newer is needed first: https://nodejs.org & pause & exit /b 1)\r
node .switchboard\\switchboard.mjs dev %*\r
echo %cmdcmdline% | find /i "/c" >nul && pause\r
`;
const DEV_SH = `#!/bin/sh
# switchboard-launcher: start working on this project. Pulls the latest code, signs you in the first
# time, starts the Switchboard board and dashboard, then opens Claude Code here.  Run: sh DEV.sh
cd "$(dirname "$0")" || exit 1
command -v node >/dev/null 2>&1 || { echo "Node.js 18 or newer is needed first: https://nodejs.org"; exit 1; }
exec node .switchboard/switchboard.mjs dev "$@"
`;
const README_RE =/<!-- switchboard:board -->[\s\S]*?<!-- \/switchboard:board -->\n?/;
export function boardSection(slug, branch = 'switchboard-state') {
  const base = `https://github.com/${slug}`;
  return `<!-- switchboard:board -->
## 📋 Live work board

[![What everyone is working on right now, grouped by workstream](${base}/raw/${branch}/board.svg)](${base}/tree/${branch}#readme)

> [!TIP]
> **Start working in three steps**
> 1. Accept your invite to this repository on GitHub.
> 2. Clone it. In GitHub Desktop: **File → Clone repository**.
> 3. Double-click **\`DEV.cmd\`** in the folder (Linux or Mac: \`sh DEV.sh\`). It pulls the latest code, signs you in the first time, opens the board and starts your AI tool (Claude Code, Codex, Gemini CLI, Cursor, VS Code, Windsurf or opencode: it asks once) with a rundown of where to begin. Needs [Node.js](https://nodejs.org) 18 or newer. Approve the project's hooks or MCP server the first time your tool asks.
>
> Use **DEV** every time you sit down to work.

[Full board](${base}/tree/${branch}#readme) · [Build list](${base}/blob/${branch}/BUILD-LIST.md) · Your dashboard: \`node .switchboard/switchboard.mjs ui\` · Redrawn every few minutes by [Switchboard](.switchboard/QUICKSTART.md)
<!-- /switchboard:board -->
`;
}
/** Insert (or refresh) the board section: refreshed in place when present, otherwise near the top, right
 *  before the README's first "## " heading (after its title and introduction). */
export function withBoardSection(readme, slug, branch) {
  const block = boardSection(slug, branch);
  if (README_RE.test(readme)) return readme.replace(README_RE, block);
  const lines = readme.split('\n'); let inFence = false; const h2 = [];
  lines.forEach((l, i) => { if (/^\s*(```|~~~)/.test(l)) inFence = !inFence; else if (!inFence && /^## /.test(l)) h2.push(i); });
  const at = h2.length ? h2[0] : -1;
  if (at < 0) return `${readme.replace(/\s*$/, '')}\n\n${block}`;
  return [...lines.slice(0, at), ...block.split('\n'), ...lines.slice(at)].join('\n');
}
function addBoardToReadme(top, slug, branch) {
  const names = fs.readdirSync(top).filter((n) => /^readme\.(md|markdown)$/i.test(n));
  if (!names.length) return;
  const f = path.join(top, names[0]); const cur = fs.readFileSync(f, 'utf8');
  const crlf = cur.includes('\r\n'); const next = withBoardSection(cur.replace(/\r\n/g, '\n'), slug, branch);
  if (next !== cur.replace(/\r\n/g, '\n')) fs.writeFileSync(f, crlf ? next.replace(/\n/g, '\r\n') : next);
}

export async function init({ KIT, opt, flag }) {
  const top = git(process.cwd(), 'rev-parse', '--show-toplevel');
  if (!top) throw new Error('run init inside the project repo (a git checkout)');
  const local = !!flag('local');
  const name = opt('name'); // the name this person appears under on the board (default: an alias)
  if (name) { if (!/^[\p{L}\p{N}][\p{L}\p{N} ._'-]{0,39}$/u.test(name)) throw new Error('--name: 1-40 letters, numbers, spaces, dots, dashes or apostrophes'); git(top, 'config', '--local', '--replace-all', 'switchboard.name', name); }
  if (local) git(top, 'config', 'switchboard.local', 'true'); else if (flag('sync')) git(top, 'config', '--unset', 'switchboard.local');
  const dir = path.join(top, '.switchboard');
  const origin = git(top, 'remote', 'get-url', 'origin');
  const slug = (origin.replace(/\.git$/, '').match(/[:/]([\w.-]+\/[\w.-]+)$/) || [])[1] || null;
  let before = {}; try { before = JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8')); } catch { /* first install */ }
  const project = (opt('project') || before.project || slug || path.basename(top)).toLowerCase(); // an existing project keeps its name
  if (path.resolve(KIT) !== path.resolve(dir)) { for (const n of ['switchboard.mjs', 'PROTOCOL.md', 'AGENT-PROMPT.md', 'QUICKSTART.md']) { fs.mkdirSync(dir, { recursive: true }); fs.copyFileSync(path.join(KIT, n), path.join(dir, n)); } copyDir(path.join(KIT, 'lib'), path.join(dir, 'lib')); if (fs.existsSync(path.join(KIT, 'ui'))) copyDir(path.join(KIT, 'ui'), path.join(dir, 'ui')); }
  // --no-fonts: a text-only install for repositories that do not accept binary files. The dashboard then
  // uses the system's own fonts. The choice is remembered, so later installs stay text-only.
  const noFonts = !!flag('no-fonts') || fs.existsSync(path.join(dir, 'no-fonts.txt'));
  if (noFonts) {
    fs.rmSync(path.join(dir, 'ui', 'fonts'), { recursive: true, force: true });
    const css = path.join(dir, 'ui', 'style.css');
    if (fs.existsSync(css)) fs.writeFileSync(css, fs.readFileSync(css, 'utf8').split('\n').filter((l) => !l.trimStart().startsWith('@font-face')).join('\n'));
    fs.writeFileSync(path.join(dir, 'no-fonts.txt'), 'Text-only install: no font files (init --no-fonts). Delete this file and re-run init to restore them.\n');
  }
  let prev = {}; try { prev = JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8')); } catch { /* new */ }
  fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify({ project, main_repo: opt('main-repo') || prev.main_repo || slug, roots: prev.roots || {}, new_file_policy: prev.new_file_policy || 'declare', require_task: prev.require_task || 'once' }, null, 2) + '\n');
  if (!fs.existsSync(path.join(dir, 'INTRO.md'))) fs.writeFileSync(path.join(dir, 'INTRO.md'), INTRO);
  mergeHooks(path.join(top, '.claude', 'settings.json'), 'node "$CLAUDE_PROJECT_DIR/.switchboard/switchboard.mjs" hook');
  const mcpFile = path.join(top, '.mcp.json'); let m = {}; try { m = JSON.parse(fs.readFileSync(mcpFile, 'utf8')); } catch { /* new */ }
  m.mcpServers = { ...(m.mcpServers || {}), switchboard: { command: 'node', args: ['${CLAUDE_PROJECT_DIR:-.}/.switchboard/switchboard.mjs', 'mcp'] } };
  fs.writeFileSync(mcpFile, JSON.stringify(m, null, 2) + '\n');
  // The checks workflow and CODEOWNERS are GitHub features: only written when the remote is GitHub (or --github).
  // Not in a private trial: the workflow needs the shared board branch to exist, and would fail without it.
  const privateTrial = local || git(top, 'config', '--get', 'switchboard.local') === 'true';
  const onGithub = flag('github') === true || (!privateTrial && /github\.com[:/]/i.test(origin) && flag('no-github') !== true);
  const wf = path.join(top, '.github', 'workflows', 'switchboard.yml');
  if (onGithub) { fs.mkdirSync(path.dirname(wf), { recursive: true }); fs.writeFileSync(wf, WORKFLOW(process.env.SWITCHBOARD_BRANCH || 'switchboard-state')); }
  const ga = path.join(top, '.gitattributes'); const gaCur = fs.existsSync(ga) ? fs.readFileSync(ga, 'utf8') : '';
  if (!gaCur.includes('.switchboard/**')) fs.writeFileSync(ga, `${gaCur}${gaCur && !gaCur.endsWith('\n') ? '\n' : ''}.switchboard/** text=auto eol=lf\n${noFonts ? '' : '.switchboard/ui/fonts/*.woff2 binary\n'}`);
  const owner = opt('owner');
  if (onGithub && owner && /^@?[\w-]{1,39}(\/[\w-]{1,60})?$/.test(owner)) {
    const co = path.join(top, '.github', 'CODEOWNERS'); const cur = fs.existsSync(co) ? fs.readFileSync(co, 'utf8') : ''; const o = owner.startsWith('@') ? owner : '@' + owner;
    if (!cur.includes('/.switchboard/')) fs.writeFileSync(co, `${cur}${cur && !cur.endsWith('\n') ? '\n' : ''}# Switchboard runs on every developer's machine and in CI: changes need the owner's review\n/.switchboard/ ${o}\n/.github/workflows/switchboard.yml ${o}\n/.claude/settings.json ${o}\n/.mcp.json ${o}\n/.github/CODEOWNERS ${o}\n`);
  }
  // The project's own README shows the live board: an image the checks redraw on the state branch, so the
  // default branch never changes when work moves. Skipped with --no-readme, in a private trial, or without GitHub.
  if (onGithub && slug && flag('no-readme') !== true) addBoardToReadme(top, slug, process.env.SWITCHBOARD_BRANCH || 'switchboard-state');
  // One-click start for developers: DEV.cmd (Windows, double-click) and DEV.sh (Linux/macOS). Ours carry a
  // marker line; a file of the same name that is not ours is left alone.
  for (const [n, body] of [['DEV.cmd', DEV_CMD], ['DEV.sh', DEV_SH]]) {
    const f = path.join(top, n); const cur = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
    if (cur === null || cur.includes('switchboard-launcher')) fs.writeFileSync(f, body);
  }
  { const ga2 = fs.readFileSync(ga, 'utf8'); if (!ga2.includes('DEV.sh')) fs.writeFileSync(ga, `${ga2}${ga2.endsWith('\n') ? '' : '\n'}DEV.sh text eol=lf\nDEV.cmd text eol=crlf\n`); }
  // Switchboard's MCP server for other AI tools that read a project config (Cursor, VS Code, Gemini CLI)
  (await import('./tools.mjs')).projectConfigs(top);
  const cm = path.join(top, 'CLAUDE.md'); const cmCur = fs.existsSync(cm) ? fs.readFileSync(cm, 'utf8') : '';
  if (!cmCur.includes('<!-- switchboard -->')) fs.writeFileSync(cm, `${cmCur}${cmCur && !cmCur.endsWith('\n') ? '\n' : ''}\n<!-- switchboard -->\n## Switchboard\nThis project is coordinated on Switchboard (state lives on the \`switchboard-state\` branch of this repo). Your session starts with a board briefing; follow it: take or plan a task before editing, extend existing files, note your work on each file, finish with done. Project rules: .switchboard/INTRO.md. Other AI tools: see AGENTS.md.\n`);
  console.log(`Switchboard is set up for "${project}".\n`);
  if (local) { console.log('PRIVATE TRIAL: the board stays on this machine (.git/switchboard). Nothing is pushed anywhere.\nThe files written below are ordinary untracked files until you choose to commit them.\nTo start syncing through the repo later: node .switchboard/switchboard.mjs init --sync  (then stop + start)\n'); }
  console.log('Written: .switchboard/ (client, rules, project.json), .claude/settings.json (hooks), .mcp.json (local MCP),');
  console.log('         CLAUDE.md section' + (onGithub ? ', .github/workflows/switchboard.yml (security checks, Issues mirror, board)' + (owner ? ', CODEOWNERS' : '') : '') + '.\n');
  if (!onGithub && !local) console.log(origin ? 'This remote is not GitHub: the board syncs through it the same way, but the automatic security checks and Issues mirror are GitHub-only and were not written.\n' : 'No git remote: the board stays on this machine.\n');
  console.log('Next:\n  1. Commit these files on a branch and merge them with a pull request.');
  console.log('  2. node .switchboard/switchboard.mjs ui        (creates the state branch on first use, opens the dashboard)');
  console.log('  3. node .switchboard/switchboard.mjs prompt --out AGENTS.md   (prompt for other AI tools)');
  if (!onGithub) return;
  console.log('\nGitHub settings to turn on (repo -> Settings):');
  console.log('  - Branch protection on the default branch: require pull requests + review' + (owner ? ' from Code Owners' : ' (add --owner <github-login> to generate CODEOWNERS)') + '.');
  console.log('  - Ruleset on "switchboard-state": block force pushes and deletion (everyone with write access pushes to it).');
  console.log('  - Actions -> General -> Workflow permissions: "Read repository contents" by default.');
  console.log('  - First use: run  node .switchboard/switchboard.mjs start  once to create the shared board (sessions never create it by themselves).');
  console.log('  - Optional, strongest: require signed commits; then the checks can prove who wrote each record.');
}
