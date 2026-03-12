#!/usr/bin/env node

/**
 * .orch/cli.js -- Agent Orchestration Engine
 *
 * Features:
 *   - Smart workspaces: local branch management with automatic worktree fallback.
 *   - Technical handoffs: file-driven HANDOFF.md protocol for rich documentation.
 *   - Ownership guardrails: blocks completion when agents touch unowned files.
 *   - Resource locking: prevents port/database collisions between parallel agents.
 *   - Mission briefing: injects context directly into the agent workspace.
 *   - Adapter system: tool-agnostic agent spawning (Claude Code, OpenCode, shell, custom).
 *   - Hierarchical spawn: parent agents can programmatically launch child agents.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execSync, spawnSync, spawn } = require('node:child_process');

const ROOT = process.cwd();
const ORCH_DIR = path.join(ROOT, '.orch');
const PLAN_DIR = path.join(ORCH_DIR, 'plan');
const STATUS_FILE = path.join(ORCH_DIR, 'status.json');
const NOTES_DIR = path.join(ORCH_DIR, 'notes');
const LOG_FILE = path.join(ORCH_DIR, 'orch.log');
const COMMIT_LOG_FILE = path.join(ORCH_DIR, 'commit-log.json');
const WORKTREE_DIR = path.join(ORCH_DIR, 'worktrees');
const ARCHIVE_DIR = path.join(ORCH_DIR, 'archive');
const SUMMARIES_DIR = path.join(ORCH_DIR, 'summaries');
const CONFIG_FILE = path.join(ORCH_DIR, 'config.json');
const ADAPTERS_DIR = path.join(ORCH_DIR, 'adapters');
const SPAWN_LOGS_DIR = path.join(ORCH_DIR, 'spawn-logs');
const SEP_LIGHT = '-'.repeat(72);

const SYMLINK_DIRS = ['node_modules', '.venv', 'venv', 'vendor', 'target', 'dist'];
const LEGACY_PLAN_FILES = ['TASKS.md', 'AGENT_STATUS.json'];

// Built-in adapters directory (co-located with this script in .orch/)
// When deployed, adapters/ is copied next to cli.js by --init.
const BUILTIN_ADAPTERS_DIR = path.join(__dirname, 'adapters');

const SYM = {
  OK: '[OK]    ',
  FAIL: '[FAIL]  ',
  WARN: '[!]     ',
  NOTE: '[NOTE]  ',
  START: '[START] ',
  DONE: '[DONE]  ',
  TEST: '[TEST]  ',
  LOCK: '[LOCK]  ',
  BRIEF: '[BRIEF] ',
  SPAWN: '[SPAWN] ',
  WAIT: '[WAIT]  ',
};

const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  grey: '\x1b[90m',
  cyan: '\x1b[36m',
};

const STATUS_COLORS = {
  ready: COLORS.green,
  in_progress: COLORS.blue,
  complete: COLORS.grey,
  blocked: COLORS.yellow,
  failed: COLORS.red,
};

function ts() {
  return new Date().toISOString().replace(/\.\d+Z$/, 'Z');
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function shellQuote(value) {
  return JSON.stringify(value);
}

function runGit(command, options = {}) {
  return execSync(command, { stdio: 'pipe', encoding: 'utf8', ...options }).trim();
}

function runCommand(command, options = {}) {
  return execSync(command, { stdio: 'inherit', ...options });
}

function log(op, id = '', msg = '') {
  ensureDir(ORCH_DIR);
  const line = `[${ts()}] ${op.padEnd(10)} ${id.padEnd(16)} ${msg}\n`;
  fs.appendFileSync(LOG_FILE, line, 'utf8');
}

// ─── Status & Config ──────────────────────────────────────────────────────────

function loadStatus() {
  if (!fs.existsSync(STATUS_FILE)) {
    console.error(`${SYM.FAIL} Missing .orch/status.json. Run --init first.`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
}

function saveStatus(data) {
  data.meta = data.meta || {};
  data.meta.last_updated = ts();
  fs.writeFileSync(STATUS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function loadCommitLog() {
  if (!fs.existsSync(COMMIT_LOG_FILE)) return { commits: [] };
  return JSON.parse(fs.readFileSync(COMMIT_LOG_FILE, 'utf8'));
}

function saveCommitLog(data) {
  fs.writeFileSync(COMMIT_LOG_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); }
  catch { return {}; }
}

function saveConfig(cfg) {
  ensureDir(ORCH_DIR);
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
}

function getTask(data, id) {
  if (!id) { console.error(`${SYM.FAIL} Missing task id.`); process.exit(1); }
  if (!data[id]) { console.error(`${SYM.FAIL} Task ${id} not found.`); process.exit(1); }
  return data[id];
}

function getTasks(data) {
  const tasks = {};
  for (const [key, value] of Object.entries(data)) {
    if (key !== 'meta') tasks[key] = value;
  }
  return tasks;
}

function formatDuration(ms) {
  const sec = Math.max(0, Math.floor(ms / 1000));
  const min = Math.floor(sec / 60);
  const hr = Math.floor(min / 60);
  if (hr > 0) return `${hr}h ${min % 60}m`;
  return `${min}m ${sec % 60}s`;
}

function formatCommitMessage(taskId, task) {
  const title = String(task.title || '').replace(/\s+/g, ' ').trim().replace(/[.:;,\-_\s]+$/g, '');
  return `${task.agent}(${taskId}): ${title}`;
}

// ─── Adapter System ───────────────────────────────────────────────────────────

/**
 * resolveAdapter(name) → adapter module
 *
 * Search order:
 *   1. .orch/adapters/<n>.js   (project-local, highest priority)
 *   2. Built-in adapters shipped next to cli.js
 */
function resolveAdapter(name) {
  if (!name) {
    console.error(`${SYM.FAIL} No adapter specified and no default_adapter set in .orch/config.json.`);
    console.error(`  Run: node .orch/cli.js --set-adapter claude-code`);
    process.exit(1);
  }

  // 1. Project-local override
  const localPath = path.join(ADAPTERS_DIR, `${name}.js`);
  if (fs.existsSync(localPath)) {
    try { return require(localPath); }
    catch (e) { console.error(`${SYM.FAIL} Failed to load local adapter ${localPath}: ${e.message}`); process.exit(1); }
  }

  // 2. Built-in adapters co-located with cli.js
  const builtinPath = path.join(BUILTIN_ADAPTERS_DIR, `${name}.js`);
  if (fs.existsSync(builtinPath)) {
    try { return require(builtinPath); }
    catch (e) { console.error(`${SYM.FAIL} Failed to load built-in adapter ${builtinPath}: ${e.message}`); process.exit(1); }
  }

  console.error(`${SYM.FAIL} Adapter "${name}" not found.`);
  console.error(`  Looked in:`);
  console.error(`    ${localPath}`);
  console.error(`    ${builtinPath}`);
  console.error(`  Run: node .orch/cli.js --adapters   to see available adapters.`);
  process.exit(1);
}

function listAdapters() {
  const found = new Map(); // name → { path, source }

  // Built-in adapters
  if (fs.existsSync(BUILTIN_ADAPTERS_DIR)) {
    for (const file of fs.readdirSync(BUILTIN_ADAPTERS_DIR)) {
      if (!file.endsWith('.js')) continue;
      const name = path.basename(file, '.js');
      try {
        const mod = require(path.join(BUILTIN_ADAPTERS_DIR, file));
        found.set(name, { description: mod.description || '', source: 'built-in' });
      } catch { /* skip broken */ }
    }
  }

  // Project-local adapters (can override built-ins)
  if (fs.existsSync(ADAPTERS_DIR)) {
    for (const file of fs.readdirSync(ADAPTERS_DIR)) {
      if (!file.endsWith('.js')) continue;
      const name = path.basename(file, '.js');
      try {
        const mod = require(path.join(ADAPTERS_DIR, file));
        found.set(name, { description: mod.description || '', source: 'local (.orch/adapters/)' });
      } catch { /* skip broken */ }
    }
  }

  const cfg = loadConfig();
  const defaultAdapter = cfg.default_adapter || '(none)';

  console.log(`\n${COLORS.bold}Available Adapters${COLORS.reset}`);
  console.log(SEP_LIGHT);
  if (found.size === 0) {
    console.log('  No adapters found.');
  } else {
    for (const [name, info] of found.entries()) {
      const marker = name === defaultAdapter ? ` ${COLORS.green}[default]${COLORS.reset}` : '';
      console.log(`  ${COLORS.bold}${name}${COLORS.reset}${marker}`);
      console.log(`    ${info.description}`);
      console.log(`    Source: ${info.source}`);
    }
  }
  console.log(`\n  Default adapter: ${COLORS.cyan}${defaultAdapter}${COLORS.reset}`);
  console.log(`  Set default:     node .orch/cli.js --set-adapter <name>\n`);
}

function setDefaultAdapter(name) {
  const cfg = loadConfig();
  cfg.default_adapter = name;
  saveConfig(cfg);
  console.log(`${SYM.OK} Default adapter set to "${name}".`);
}

// ─── Git & Workspace Helpers ──────────────────────────────────────────────────

function branchExists(branch) {
  const result = spawnSync('git', ['rev-parse', '--verify', branch], {
    cwd: ROOT, stdio: 'ignore', shell: false,
  });
  return result.status === 0;
}

function ensureGitRepo() {
  try { runGit('git rev-parse --show-toplevel', { cwd: ROOT }); }
  catch { console.error(`${SYM.FAIL} This project must be inside a git repository.`); process.exit(1); }
}

function checkResourceLocks(tasks, newTask, currentTaskId) {
  const inProgress = Object.entries(tasks)
    .filter(([id, task]) => task.status === 'in_progress' && id !== currentTaskId)
    .map(([, task]) => task);
  const requested = newTask.resources || [];
  for (const task of inProgress) {
    const active = task.resources || [];
    const collision = requested.find((r) => active.includes(r));
    if (collision) {
      console.error(`${SYM.LOCK} RESOURCE COLLISION: "${task.title}" is using "${collision}".`);
      process.exit(1);
    }
  }
}

function ensureDependenciesComplete(data, id, task) {
  const unmet = (task.depends_on || []).filter((depId) => {
    const dep = data[depId];
    return !dep || dep.status !== 'complete';
  });
  if (unmet.length > 0) {
    console.error(`${SYM.FAIL} Cannot start ${id}. Unmet dependencies: ${unmet.join(', ')}`);
    process.exit(1);
  }
}

function createMissionBrief(workDir, task, id) {
  const briefPath = path.join(workDir, 'MISSION_BRIEF.md');
  let upstreamNotes = '';
  for (const depId of task.depends_on || []) {
    const noteFile = path.join(NOTES_DIR, `${depId}.md`);
    if (fs.existsSync(noteFile)) {
      upstreamNotes += `### From ${depId}\n\n${fs.readFileSync(noteFile, 'utf8')}\n\n`;
    }
  }
  const content = [
    `# MISSION BRIEF: ${id}`,
    ``,
    `**Objective:** ${task.title}`,
    `**Agent:** ${task.agent}`,
    `**Definition of Done:** ${task.definition_of_done}`,
    ``,
    `## Authorized Files`,
    `You may edit only these files for this task:`,
    task.output_files?.map((f) => `- \`${f}\``).join('\n') || '- None listed',
    ``,
    `## Upstream Intelligence`,
    upstreamNotes || 'No upstream handoffs recorded.\n',
    `## Required Resources`,
    task.resources?.join(', ') || 'None',
    ``,
    `---`,
    `Generated at ${ts()}`,
  ].join('\n');

  fs.writeFileSync(briefPath, content, 'utf8');

  const handoffPath = path.join(workDir, 'HANDOFF.md');
  if (!fs.existsSync(handoffPath)) {
    const handoffTemplate = [
      `# HANDOFF: ${id}`,
      ``,
      `## Session Summary`,
      `(Concise summary of what was accomplished, key decisions, blockers, solutions)`,
      ``,
      `## Approach`,
      `(How you solved this task)`,
      ``,
      `## Technical Changes`,
      `(Key logic changes or new dependencies)`,
      ``,
      `## Interface Updates`,
      `(New API shapes, DB columns, or UI components)`,
      ``,
      `## Note for Downstream Agents`,
      `(What should the next agent know?)`,
    ].join('\n');
    fs.writeFileSync(handoffPath, handoffTemplate, 'utf8');
  }
  return briefPath;
}
