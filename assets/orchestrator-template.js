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


// ─── Hierarchical Agent Management ───────────────────────────────────────────
//
// These functions extend the orchestrator to support parent-agent → child-agent
// spawning.  A running agent can call agent-api.js (or use spawnChild() from
// the module) to create sub-tasks under itself.  The resolve() function now
// also checks whether a parent task's children are all complete and, if so,
// marks the parent's wait as satisfied so it can be marked done.
//
// status.json additions:
//   task.parent_task  string | null  — ID of the task that spawned this one
//   task.children     string[]       — IDs of tasks this task spawned
//
// No changes to the adapter interface — adapters still just call launch() and
// check().  The hierarchy lives entirely in status.json + the CLI.

/**
 * resolveHierarchy(data)
 *
 * After any status mutation, scan every task that has children.
 * If ALL children are complete, add a note on the parent indicating
 * children are done so the parent agent can call --done on itself.
 * If ANY child has failed, add a warning note.
 *
 * Returns an array of parent IDs whose children just all completed.
 */
function resolveHierarchy(data) {
  const justFinished = [];

  for (const [id, task] of Object.entries(data)) {
    if (id === 'meta') continue;
    const children = task.children ?? [];
    if (children.length === 0) continue;
    if (task.status === 'complete' || task.status === 'failed') continue;

    const statuses  = children.map(cid => data[cid]?.status ?? 'unknown');
    const allDone   = statuses.every(s => s === 'complete' || s === 'failed');
    const anyFailed = statuses.some(s => s === 'failed');

    if (!allDone) continue;

    // Don't double-notify
    const noteFile = path.join(NOTES_DIR, `${id}.md`);
    const existing = fs.existsSync(noteFile) ? fs.readFileSync(noteFile, 'utf8') : '';
    if (existing.includes('[CHILDREN COMPLETE]') || existing.includes('[CHILDREN FAILED]')) continue;

    const tag = anyFailed ? '[CHILDREN FAILED]' : '[CHILDREN COMPLETE]';
    const summary = children.map(cid => `  ${cid}: ${data[cid]?.status}`).join('\n');
    const note = `${tag} at ${ts()}\n${summary}\n\nAll sub-tasks have settled. You may now call --done on task ${id}.`;

    ensureDir(NOTES_DIR);
    fs.appendFileSync(noteFile, '\n---\n' + note + '\n', 'utf8');
    data[id].notes = (data[id].notes ? data[id].notes + '\n' : '') + tag;

    justFinished.push(id);
    log('CHILDREN', id, anyFailed ? 'some failed' : 'all complete');
  }

  return justFinished;
}

/**
 * cmdSpawnChild(parentId, taskDef, adapterOverride)
 *
 * CLI handler for:  node cli.js --spawn-child <parentId> --title "..." ...
 *
 * Creates the child task in status.json and immediately spawns it.
 */
function cmdSpawnChild(parentId, flags) {
  const data   = loadStatus();
  const parent = data[parentId];
  if (!parent) {
    console.error(`${SYM.FAIL} Parent task "${parentId}" not found.`);
    process.exit(1);
  }

  const title       = flags.title;
  const agentName   = flags.agent;
  const outputFiles = flags.files ? flags.files.split(',').map(s => s.trim()) : [];
  const dependsOn   = flags['depends-on'] ? flags['depends-on'].split(',').map(s => s.trim()) : [];

  if (!title || !agentName || outputFiles.length === 0) {
    console.error(`${SYM.FAIL} --spawn-child requires --title, --agent, and --files.`);
    process.exit(1);
  }

  const existing  = Object.keys(data).filter(k => k !== 'meta' && k.startsWith(parentId + '.c'));
  const childIdx  = existing.length + 1;
  const childId   = `${parentId}.c${childIdx}`;

  data[childId] = {
    title,
    agent:            agentName,
    phase:            flags.phase ? Number(flags.phase) : (parent.phase ?? 1),
    status:           'ready',
    depends_on:       dependsOn,
    output_files:     outputFiles,
    resources:        flags.resources ? flags.resources.split(',').map(s => s.trim()) : [],
    definition_of_done: flags.done ?? title,
    notes:            '',
    completed_at:     null,
    parent_task:      parentId,
    children:         [],
  };

  parent.children = parent.children ?? [];
  parent.children.push(childId);

  saveStatus(data);
  console.log(`${SYM.SPAWN} Created child task ${childId} under ${parentId}`);

  // Delegate to --spawn so adapter logic stays in one place
  const cfg     = loadConfig();
  const adapter = flags.adapter || cfg.default_adapter;
  spawnTask(childId, adapter, flags.headless === 'true');
}


/**
 * cmdListChildren(parentId)
 *
 * CLI handler for: node cli.js --children <parentId>
 * Shows each child's ID, status, and title.
 */
function cmdListChildren(parentId) {
  const data   = loadStatus();
  const parent = data[parentId];
  if (!parent) {
    console.error(`${SYM.FAIL} Task "${parentId}" not found.`);
    process.exit(1);
  }

  const children = parent.children ?? [];
  if (children.length === 0) {
    console.log(`No children for ${parentId}.`);
    return;
  }

  console.log(`\n${COLORS.bold}Children of ${parentId}${COLORS.reset}  (${children.length} total)\n`);
  for (const cid of children) {
    const child  = data[cid];
    const status = child?.status ?? 'unknown';
    const col    = STATUS_COLORS[status] || COLORS.reset;
    const indent = cid.split('.').length > 2 ? '    '.repeat(cid.split('.').length - 2) : '';
    console.log(`  ${indent}${col}[${status.padEnd(11)}]${COLORS.reset} ${cid.padEnd(24)} ${child?.title ?? '(missing)'}`);

    // Recurse one level for nested children
    const grandchildren = child?.children ?? [];
    for (const gcid of grandchildren) {
      const gc  = data[gcid];
      const gs  = gc?.status ?? 'unknown';
      const gc2 = STATUS_COLORS[gs] || COLORS.reset;
      console.log(`      ${gc2}[${gs.padEnd(11)}]${COLORS.reset} ${gcid.padEnd(24)} ${gc?.title ?? '(missing)'}`);
    }
  }
  console.log('');
}

/**
 * cmdAwaitChildren(parentId)
 *
 * CLI handler for: node cli.js --await-children <parentId>
 *
 * Polls status.json until all direct children of parentId are complete or
 * failed, then exits 0 (all complete) or 1 (at least one failed).
 * Useful in shell scripts that want to block the parent.
 */
async function cmdAwaitChildren(parentId) {
  const POLL_MS = 4000;

  function poll() {
    const data     = loadStatus();
    const parent   = data[parentId];
    if (!parent) {
      console.error(`${SYM.FAIL} Task "${parentId}" not found.`);
      process.exit(1);
    }
    const children = parent.children ?? [];
    if (children.length === 0) {
      console.log(`${SYM.OK} No children for ${parentId} — nothing to wait on.`);
      process.exit(0);
    }

    const statuses = children.map(cid => ({ id: cid, status: data[cid]?.status ?? 'unknown' }));
    const pending  = statuses.filter(s => !['complete', 'failed'].includes(s.status));
    const failed   = statuses.filter(s => s.status === 'failed');

    process.stdout.write(`\r${SYM.WAIT} ${pending.length}/${children.length} children still running ...   `);

    if (pending.length === 0) {
      console.log('\n');
      for (const s of statuses) {
        const col = STATUS_COLORS[s.status] || COLORS.reset;
        console.log(`  ${col}[${s.status.padEnd(11)}]${COLORS.reset} ${s.id}`);
      }
      if (failed.length > 0) {
        console.log(`\n${SYM.FAIL} ${failed.length} child task(s) failed.`);
        process.exit(1);
      }
      console.log(`\n${SYM.OK} All children of ${parentId} complete.`);
      process.exit(0);
    }

    setTimeout(poll, POLL_MS);
  }

  poll();
}

/**
 * Hook resolveHierarchy into the existing resolve() call.
 *
 * Call this after every saveStatus() that changes a task's status to
 * 'complete' or 'failed'.  It appends a note on the parent if all its
 * children have settled, enabling the parent agent to self-complete.
 */
function afterStatusMutation(data) {
  const parents = resolveHierarchy(data);
  if (parents.length > 0) {
    console.log(`${SYM.NOTE} Children settled → parent(s) notified: ${parents.join(', ')}`);
  }
  saveStatus(data);
}

// ─── CLI Dispatch Additions ───────────────────────────────────────────────────
// Add these cases to your main arg-parsing switch / if-chain in cli.js:
//
//   --spawn-child <parentId> --title "..." --agent "..." --files "a.js,b.js"
//                            [--phase N] [--depends-on "T1,T2"] [--done "..."]
//                            [--resources "port:3000"] [--adapter claude-code]
//
//   --children <parentId>
//
//   --await-children <parentId>
//
// Example wiring (paste into the arg-parsing section of cli.js):
//
//   } else if (arg === '--spawn-child') {
//     const parentId = argv[++i];
//     const flags    = parseArgFlags(argv.slice(i + 1));
//     cmdSpawnChild(parentId, flags);
//
//   } else if (arg === '--children') {
//     cmdListChildren(argv[++i]);
//
//   } else if (arg === '--await-children') {
//     cmdAwaitChildren(argv[++i]);

// Export so agent-api.js can require these helpers when running in the same
// Node process (e.g. for testing or embedding).
if (typeof module !== 'undefined') {
  module.exports = {
    resolveHierarchy,
    cmdSpawnChild,
    cmdListChildren,
    cmdAwaitChildren,
    afterStatusMutation,
  };
}


// ─── Interrupt Handling ───────────────────────────────────────────────────────
//
// Agents running headless can't ask questions interactively.
// Instead they call --question or --fail to surface blockers to the dashboard.
//
// New status: "waiting_input"
//   An agent has written QUESTIONS.md and is paused waiting for a human answer.
//   It does NOT count as "blocked" (dependencies not met) — it's a different state.
//   The human runs --answer <taskId> "<answer>" to inject the answer and resume.
//
// Dashboard changes:
//   - waiting_input tasks shown in a "NEEDS ATTENTION" section
//   - --question surfaces the question text on the dashboard immediately
//
// CLI additions:
//   --question  <taskId> "<summary>"  Set task to waiting_input, log the question
//   --answer    <taskId> "<answer>"   Write answer to QUESTIONS.md, resume task
//   --attention                       Show only tasks needing human input

const STATUS_COLORS_EXTENDED = {
  ...STATUS_COLORS,
  waiting_input: '\x1b[35m',  // magenta — stands out, not an error
};

/**
 * cmdQuestion(taskId, summary)
 *
 * Called BY the agent (via shell) when it has a question it can't answer.
 * Sets status → waiting_input, writes to the notes file, prints a banner.
 */
function cmdQuestion(taskId, summary) {
  const data = loadStatus();
  const task = getTask(data, taskId);

  if (!['in_progress', 'ready'].includes(task.status)) {
    console.error(`${SYM.FAIL} Task ${taskId} is "${task.status}" — can only ask questions when in_progress or ready.`);
    process.exit(1);
  }

  task.status     = 'waiting_input';
  task.blocked_at = ts();

  // Append to the task's note file
  ensureDir(NOTES_DIR);
  const noteFile = path.join(NOTES_DIR, `${taskId}.md`);
  const noteText = `[QUESTION] ${ts()}\n${summary}\n\nSee QUESTIONS.md in the task workspace for details.\n`;
  fs.appendFileSync(noteFile, '\n---\n' + noteText, 'utf8');
  task.notes = (task.notes || '') + `\n[QUESTION] ${summary}`;

  saveStatus(data);
  log('QUESTION', taskId, summary);

  console.log(`\n${'\x1b[35m'}[?]     WAITING FOR INPUT${COLORS.reset}`);
  console.log(`  Task:     ${taskId}`);
  console.log(`  Question: ${summary}`);
  console.log(`  Answer:   node .orch/cli.js --answer ${taskId} "<your answer>"\n`);
}

/**
 * cmdAnswer(taskId, answer)
 *
 * Human provides an answer. Writes it to QUESTIONS.md in the workspace,
 * re-sets status to in_progress, and re-spawns the agent.
 */
function cmdAnswer(taskId, answer) {
  const data = loadStatus();
  const task = getTask(data, taskId);

  if (task.status !== 'waiting_input') {
    console.error(`${SYM.FAIL} Task ${taskId} is not waiting for input (status: "${task.status}").`);
    process.exit(1);
  }

  // Find the workspace and write the answer into QUESTIONS.md
  const worktreePath = path.join(WORKTREE_DIR, taskId);
  const workDir      = fs.existsSync(worktreePath) ? worktreePath : ROOT;
  const questionsFile = path.join(workDir, 'QUESTIONS.md');

  const answerBlock = `\n---\n## Human Answer — ${ts()}\n\n${answer}\n\nYou may now continue working. Run --done when finished.\n`;
  if (fs.existsSync(questionsFile)) {
    fs.appendFileSync(questionsFile, answerBlock, 'utf8');
  } else {
    fs.writeFileSync(questionsFile, `# Questions & Answers for ${taskId}\n${answerBlock}`, 'utf8');
  }

  // Append to notes
  ensureDir(NOTES_DIR);
  const noteFile = path.join(NOTES_DIR, `${taskId}.md`);
  fs.appendFileSync(noteFile, `\n---\n[ANSWER] ${ts()}\n${answer}\n`, 'utf8');
  task.notes = (task.notes || '') + `\n[ANSWER] ${answer.slice(0, 80)}`;

  // Resume
  task.status     = 'in_progress';
  task.blocked_at = null;
  saveStatus(data);
  log('ANSWER', taskId, answer.slice(0, 80));

  console.log(`${SYM.OK} Answer written to ${questionsFile}`);
  console.log(`${SYM.NOTE} Task ${taskId} is back to in_progress.`);
  console.log(`  Re-spawn the agent with:  node .orch/cli.js --spawn ${taskId}\n`);
}

/**
 * cmdAttention()
 *
 * Shows only tasks that need human input right now.
 * Run this to quickly see what's waiting on you.
 */
function cmdAttention() {
  const data  = loadStatus();
  const tasks = getTasks(data);

  const waiting = Object.entries(tasks).filter(([, t]) => t.status === 'waiting_input');
  const failed  = Object.entries(tasks).filter(([, t]) => t.status === 'failed');

  if (waiting.length === 0 && failed.length === 0) {
    console.log(`${SYM.OK} Nothing needs your attention right now.\n`);
    return;
  }

  if (waiting.length > 0) {
    console.log(`\n${COLORS.bold}Waiting for your input (${waiting.length})${COLORS.reset}\n`);
    for (const [id, task] of waiting) {
      // Pull the question text out of notes
      const question = (task.notes || '').split('[QUESTION]').pop()?.trim().split('\n')[0] || '(see QUESTIONS.md)';
      console.log(`  ${'\x1b[35m'}[?]${COLORS.reset} ${id.padEnd(20)} ${task.title}`);
      console.log(`       Question: ${question}`);
      console.log(`       Answer:   node .orch/cli.js --answer ${id} "<your answer>"\n`);
    }
  }

  if (failed.length > 0) {
    console.log(`\n${COLORS.bold}Failed tasks (${failed.length})${COLORS.reset}\n`);
    for (const [id, task] of failed) {
      const reason = (task.notes || '').split('[FAIL]').pop()?.trim().split('\n')[0] || '(see notes)';
      console.log(`  ${COLORS.red}[FAIL]${COLORS.reset} ${id.padEnd(20)} ${task.title}`);
      console.log(`       Reason:  ${reason}`);
      console.log(`       Retry:   node .orch/cli.js --abort ${id} && node .orch/cli.js --spawn ${id}\n`);
    }
  }
}

// ─── CLI wiring (paste into arg-parsing block in cli.js) ──────────────────────
//
//   } else if (arg === '--question') {
//     const taskId  = argv[++i];
//     const summary = argv[++i];
//     cmdQuestion(taskId, summary);
//
//   } else if (arg === '--answer') {
//     const taskId = argv[++i];
//     const answer = argv[++i];
//     cmdAnswer(taskId, answer);
//
//   } else if (arg === '--attention') {
//     cmdAttention();
//
// Also add 'waiting_input' to the meta.statuses array in AGENT_STATUS.json.
