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
 */

const fs = require('node:fs');
const path = require('node:path');
const { execSync, spawnSync } = require('node:child_process');

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
const SEP_LIGHT = '-'.repeat(72);

const SYMLINK_DIRS = ['node_modules', '.venv', 'venv', 'vendor', 'target', 'dist'];
const LEGACY_PLAN_FILES = ['TASKS.md', 'AGENT_STATUS.json'];

const SYM = {
  OK: '[OK]    ',
  FAIL: '[FAIL]  ',
  WARN: '[!]     ',
  NOTE: '[NOTE]  ',
  START: '[START] ',
  DONE: '[DONE]  ',
  TEST: '[TEST]  ',
  LOCK: '[LOCK]  ',
  BRIEF: '[BRIEF] '
};

const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  grey: '\x1b[90m'
};

const STATUS_COLORS = {
  ready: COLORS.green,
  in_progress: COLORS.blue,
  complete: COLORS.grey,
  blocked: COLORS.yellow,
  failed: COLORS.red
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
  if (!fs.existsSync(COMMIT_LOG_FILE)) {
    return { commits: [] };
  }
  return JSON.parse(fs.readFileSync(COMMIT_LOG_FILE, 'utf8'));
}

function saveCommitLog(data) {
  fs.writeFileSync(COMMIT_LOG_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function getTask(data, id) {
  if (!id) {
    console.error(`${SYM.FAIL} Missing task id.`);
    process.exit(1);
  }
  if (!data[id]) {
    console.error(`${SYM.FAIL} Task ${id} not found.`);
    process.exit(1);
  }
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
  const title = String(task.title || '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.:;,\-_\s]+$/g, '');
  return `${task.agent}(${taskId}): ${title}`;
}

function branchExists(branch) {
  const result = spawnSync('git', ['rev-parse', '--verify', branch], {
    cwd: ROOT,
    stdio: 'ignore',
    shell: false
  });
  return result.status === 0;
}

function ensureGitRepo() {
  try {
    runGit('git rev-parse --show-toplevel', { cwd: ROOT });
  } catch (error) {
    console.error(`${SYM.FAIL} This project must be inside a git repository.`);
    process.exit(1);
  }
}

function checkResourceLocks(tasks, newTask, currentTaskId) {
  const inProgress = Object.entries(tasks)
    .filter(([id, task]) => task.status === 'in_progress' && id !== currentTaskId)
    .map(([, task]) => task);
  const requested = newTask.resources || [];

  for (const task of inProgress) {
    const active = task.resources || [];
    const collision = requested.find((resource) => active.includes(resource));
    if (collision) {
      console.error(`${SYM.LOCK} RESOURCE COLLISION: Task ${task.title} is currently using ${collision}.`);
      console.error('  Please wait for that task to finish or re-assign resources.');
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

  const content = `# MISSION BRIEF: ${id}

**Objective:** ${task.title}
**Agent:** ${task.agent}
**Definition of Done:** ${task.definition_of_done}

## Authorized Files
You may edit only these files for this task:
${task.output_files?.map((file) => `- \`${file}\``).join('\n') || '- None listed'}

## Upstream Intelligence
${upstreamNotes || 'No upstream handoffs recorded.\n'}
## Required Resources
${task.resources?.join(', ') || 'None'}

---
Generated at ${ts()}
`;

  fs.writeFileSync(briefPath, content, 'utf8');

  const handoffPath = path.join(workDir, 'HANDOFF.md');
  if (!fs.existsSync(handoffPath)) {
    const handoffTemplate = `# HANDOFF: ${id}

## Session Summary
(Write a concise summary of what was discussed and accomplished in this session - key decisions, blockers faced, solutions tried, and any context the next agent should know about the process)

## Approach
(Describe how you solved this task)

## Technical Changes
(List key logic changes or new dependencies)

## Interface Updates
(Describe new API shapes, DB columns, or UI components)

## Note for Downstream Agents
(What should the next agent know?)
`;
    fs.writeFileSync(handoffPath, handoffTemplate, 'utf8');
  }
}

function getChangedFiles(workDir) {
  const output = runGit('git status --porcelain', { cwd: workDir });
  return output
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => line.slice(3).trim());
}

function verifyOwnership(workDir, allowedFiles) {
  if (!allowedFiles || allowedFiles.length === 0) return [];

  const changedFiles = getChangedFiles(workDir);
  return changedFiles.filter((file) => {
    if (file === 'HANDOFF.md' || file === 'MISSION_BRIEF.md') return false;
    return !allowedFiles.includes(file);
  });
}

function moveLegacyPlanFiles() {
  for (const fileName of LEGACY_PLAN_FILES) {
    const src = path.join(ROOT, fileName);
    const dest = path.join(PLAN_DIR, fileName);
    if (!fs.existsSync(src) || fs.existsSync(dest)) continue;
    fs.renameSync(src, dest);
    log('ARCHIVE', fileName, `Moved ${fileName} into ${path.relative(ROOT, dest)}`);
  }
}

function writeRootWrappers() {
  const jsWrapper = `#!/usr/bin/env node
require('./.orch/cli.js');
`;
  fs.writeFileSync(path.join(ROOT, 'orch'), jsWrapper, 'utf8');

  const cmdWrapper = `@echo off
node "%~dp0.orch\\cli.js" %*
`;
  fs.writeFileSync(path.join(ROOT, 'orch.cmd'), cmdWrapper, 'utf8');

  const psWrapper = `node "$PSScriptRoot/.orch/cli.js" $args
`;
  fs.writeFileSync(path.join(ROOT, 'orch.ps1'), psWrapper, 'utf8');

  try {
    fs.chmodSync(path.join(ROOT, 'orch'), 0o755);
  } catch (error) {
    // Ignore chmod failures on platforms that do not support Unix modes.
  }
}

function installHooks() {
  const hooksDir = path.join(ROOT, '.git', 'hooks');
  ensureDir(hooksDir);

  const hookContent = `#!/bin/sh
# Orchestrator ownership enforcement hook
# Auto-generated by orch - do not edit

STATUS_FILE="$(git rev-parse --show-toplevel)/.orch/status.json"
if [ ! -f "$STATUS_FILE" ]; then
  exit 0
fi

NODE_PATH="$(command -v node)"
if [ -z "$NODE_PATH" ]; then
  exit 0
fi

WORKING_DIR="$(git rev-parse --show-toplevel)"
CURRENT_TASK=$($NODE_PATH -e "
const fs = require('fs');
const status = JSON.parse(fs.readFileSync('$STATUS_FILE', 'utf8'));
for (const [id, task] of Object.entries(status)) {
  if (id === 'meta') continue;
  if (task.status === 'in_progress') {
    console.log(id);
    const files = task.output_files || [];
    files.forEach(f => console.log('ALLOWED:' + f));
  }
}
" 2>/dev/null)

if [ -z "$CURRENT_TASK" ]; then
  exit 0
fi

echo "$CURRENT_TASK" | while IFS= read -r line; do
  case "$line" in
    ALLOWED:*) allowed="${allowed}${line#ALLOWED:} "$ ;;
    *) current_task="$line" ;;
  esac
done

if [ -z "$allowed" ]; then
  exit 0
fi

BLOCKED=0
for file in $(git diff --cached --name-only); do
  match=0
  for allowed_file in $allowed; do
    case "$file" in
      $allowed_file) match=1; break ;;
    esac
  done
  if [ $match -eq 0 ]; then
    echo "error: $file is not owned by task $current_task" >&2
    BLOCKED=1
  fi
done

if [ $BLOCKED -eq 1 ]; then
  echo "" >&2
  echo "Only commit files assigned to your task." >&2
  echo "Your task: $current_task" >&2
  echo "Allowed files: $allowed" >&2
  exit 1
fi

exit 0
`;

  fs.writeFileSync(path.join(hooksDir, 'pre-commit'), hookContent, 'utf8');
  try {
    fs.chmodSync(path.join(hooksDir, 'pre-commit'), 0o755);
  } catch (e) {}
  log('HOOK', '', 'Installed pre-commit ownership hook');
}

function validatePlan(data) {
  const tasks = getTasks(data);
  const ownersByPhaseFile = new Map();
  const errors = [];

  for (const [id, task] of Object.entries(tasks)) {
    if (!task.agent) {
      errors.push(`${id} is missing an 'agent' assignment`);
    }

    for (const depId of task.depends_on || []) {
      if (!tasks[depId]) errors.push(`${id} depends on missing task ${depId}`);
    }

    const phase = task.phase ?? 'unphased';
    for (const file of task.output_files || []) {
      const key = `${phase}:${file}`;
      const owners = ownersByPhaseFile.get(key) || [];
      owners.push(id);
      ownersByPhaseFile.set(key, owners);
    }
  }

  for (const [key, owners] of ownersByPhaseFile.entries()) {
    if (owners.length <= 1) continue;
    const separator = key.indexOf(':');
    const phase = key.slice(0, separator);
    const file = key.slice(separator + 1);
    errors.push(`Phase ${phase} has file ownership collision on ${file}: ${owners.join(', ')}`);
  }

  if (errors.length > 0) {
    console.error(`${SYM.FAIL} Plan validation failed:`);
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
  }

  console.log(`${SYM.OK} Plan validation passed.`);
}

function resolveDependents(data, completedTaskId) {
  const tasks = getTasks(data);
  for (const task of Object.values(tasks)) {
    if (task.status !== 'blocked' && task.status !== 'ready') continue;
    const deps = task.depends_on || [];
    const allComplete = deps.every((depId) => data[depId] && data[depId].status === 'complete');
    if (allComplete) task.status = 'ready';
  }
  log('RESOLVE', completedTaskId, 'Updated dependent task readiness');
}

function init() {
  ensureGitRepo();
  ensureDir(ORCH_DIR);
  ensureDir(PLAN_DIR);
  ensureDir(NOTES_DIR);
  ensureDir(ARCHIVE_DIR);
  ensureDir(WORKTREE_DIR);
  ensureDir(SUMMARIES_DIR);

  moveLegacyPlanFiles();

  const seedPlan = path.join(PLAN_DIR, 'AGENT_STATUS.json');
  if (!fs.existsSync(seedPlan)) {
    console.error(`${SYM.FAIL} Create .orch/plan/AGENT_STATUS.json first.`);
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(seedPlan, 'utf8'));
  validatePlan(data);
  saveStatus(data);
  saveCommitLog(loadCommitLog());
  writeRootWrappers();
  installHooks();
  log('INIT', '', 'Bootstrap complete');

  console.log(`${SYM.OK} Agent orchestration initialised.`);
  console.log(`${SYM.NOTE} Use ${process.platform === 'win32' ? '.\\orch.cmd' : './orch'} to run the CLI.`);
}

function startTask(id, forceWorktree = false) {
  ensureGitRepo();
  const data = loadStatus();
  const tasks = getTasks(data);
  const task = getTask(data, id);

  if (task.status === 'complete') {
    console.error(`${SYM.FAIL} Task ${id} is already complete.`);
    process.exit(1);
  }
  if (task.status === 'in_progress') {
    console.error(`${SYM.FAIL} Task ${id} is already in progress.`);
    process.exit(1);
  }

  ensureDependenciesComplete(data, id, task);
  checkResourceLocks(tasks, task, id);

  const alreadyRunning = Object.entries(tasks).filter(
    ([taskId, item]) => taskId !== id && item.status === 'in_progress'
  );
  const useWorktree = forceWorktree || alreadyRunning.length > 0;
  const branch = `${task.agent}/${id}`;
  const workDir = useWorktree ? path.join(WORKTREE_DIR, id) : ROOT;

  console.log(`${SYM.START} Activating ${id} (${useWorktree ? 'worktree' : 'local'})...`);

  try {
    if (useWorktree) {
      ensureDir(WORKTREE_DIR);
      if (!branchExists(branch)) {
        runCommand(`git worktree add -b ${shellQuote(branch)} ${shellQuote(workDir)}`, { cwd: ROOT });
      } else {
        runCommand(`git worktree add ${shellQuote(workDir)} ${shellQuote(branch)}`, { cwd: ROOT });
      }

      for (const dir of SYMLINK_DIRS) {
        const src = path.join(ROOT, dir);
        const dest = path.join(workDir, dir);
        if (fs.existsSync(src) && !fs.existsSync(dest)) {
          fs.symlinkSync(path.relative(path.dirname(dest), src), dest, 'junction');
        }
      }
      task.mode = 'worktree';
    } else {
      runCommand(`git checkout ${branchExists(branch) ? shellQuote(branch) : `-b ${shellQuote(branch)}`}`, {
        cwd: ROOT
      });
      task.mode = 'local';
    }

    createMissionBrief(workDir, task, id);
    task.status = 'in_progress';
    task.started_at = ts();
    saveStatus(data);
    log('START', id, `${task.mode} workspace at ${path.relative(ROOT, workDir) || '.'}`);

    console.log(`${SYM.BRIEF} MISSION_BRIEF.md created in workspace.`);
    console.log(`${SYM.NOTE} Use HANDOFF.md to document work and ${process.platform === 'win32' ? '.\\orch.cmd --note' : './orch --note'} for quick updates.`);
  } catch (error) {
    console.error(`${SYM.FAIL} Start failed: ${error.message}`);
    process.exit(1);
  }
}

function doneTask(id) {
  const data = loadStatus();
  const task = getTask(data, id);
  const workDir = task.mode === 'worktree' ? path.join(WORKTREE_DIR, id) : ROOT;
  const handoffPath = path.join(workDir, 'HANDOFF.md');

  console.log(`${SYM.DONE} Validating ${id}...`);

  if (!fs.existsSync(handoffPath)) {
    console.error(`${SYM.FAIL} Missing HANDOFF.md. Documentation is required for handoff.`);
    process.exit(1);
  }

  const violations = verifyOwnership(workDir, task.output_files);
  if (violations.length > 0) {
    console.error(`${SYM.FAIL} Ownership violation detected.`);
    for (const file of violations) console.error(`  - ${file}`);
    process.exit(1);
  }

  if (task.test_command) {
    console.log(`${SYM.TEST} Running verification...`);
    try {
      runCommand(task.test_command, { cwd: workDir });
    } catch (error) {
      console.error(`${SYM.FAIL} DoD verification failed.`);
      process.exit(1);
    }
  }

  ensureDir(NOTES_DIR);
  ensureDir(SUMMARIES_DIR);
  const handoffContent = fs.readFileSync(handoffPath, 'utf8');
  
  const summaryFile = path.join(SUMMARIES_DIR, `${id}.md`);
  fs.writeFileSync(summaryFile, `# ${id} - ${task.title}\n\n**Agent:** ${task.agent}\n**Completed:** ${ts()}\n**Duration:** ${formatDuration(task.duration_ms || 0)}\n\n---\n\n${handoffContent}\n`, 'utf8');
  
  const noteFile = path.join(NOTES_DIR, `${id}.md`);
  fs.appendFileSync(noteFile, `\n---\n### [${ts()}] ${task.agent} completed task:\n${handoffContent}\n`, 'utf8');

  try {
    fs.rmSync(path.join(workDir, 'MISSION_BRIEF.md'), { force: true });
    fs.rmSync(path.join(workDir, 'HANDOFF.md'), { force: true });
    runCommand('git add -A', { cwd: workDir });
    const commitMessage = formatCommitMessage(id, task);
    runCommand(`git commit -m ${shellQuote(commitMessage)}`, { cwd: workDir });
    const commitSha = runGit('git rev-parse HEAD', { cwd: workDir });

    task.status = 'complete';
    task.completed_at = ts();
    if (task.started_at) {
      task.duration_ms = new Date(task.completed_at) - new Date(task.started_at);
    }

    resolveDependents(data, id);
    saveStatus(data);
    const commitLog = loadCommitLog();
    commitLog.commits.push({
      sha: commitSha,
      task_id: id,
      agent: task.agent,
      branch: `${task.agent}/${id}`,
      message: commitMessage,
      committed_at: task.completed_at,
      work_mode: task.mode || 'local'
    });
    saveCommitLog(commitLog);
    log('DONE', id, `Lead time ${formatDuration(task.duration_ms || 0)}`);

    if (task.mode === 'worktree') {
      runCommand(`git -C ${shellQuote(ROOT)} worktree remove ${shellQuote(workDir)}`, { cwd: ROOT });
    }

    console.log(`${SYM.OK} Task complete. Lead time: ${formatDuration(task.duration_ms || 0)}`);
  } catch (error) {
    console.error(`${SYM.FAIL} Finalisation failed: ${error.message}`);
    process.exit(1);
  }
}

function addNote(id, messageParts) {
  const data = loadStatus();
  getTask(data, id);
  const message = messageParts.join(' ').trim();
  if (!message) {
    console.error(`${SYM.FAIL} Missing note message.`);
    process.exit(1);
  }

  ensureDir(NOTES_DIR);
  const noteFile = path.join(NOTES_DIR, `${id}.md`);
  fs.appendFileSync(noteFile, `### [${ts()}]\n${message}\n\n`, 'utf8');
  log('NOTE', id, message);
  console.log(`${SYM.OK} Note recorded for ${id}.`);
}

function abortTask(id) {
  const data = loadStatus();
  const task = getTask(data, id);

  if (task.status !== 'in_progress') {
    console.error(`${SYM.FAIL} Task ${id} is not in progress. Only in-progress tasks can be aborted.`);
    process.exit(1);
  }

  const workDir = task.mode === 'worktree' ? path.join(WORKTREE_DIR, id) : ROOT;

  try {
    if (task.mode === 'worktree' && fs.existsSync(workDir)) {
      runCommand(`git -C ${shellQuote(ROOT)} worktree remove --force ${shellQuote(workDir)}`, { cwd: ROOT });
      console.log(`${SYM.OK} Worktree removed: ${path.relative(ROOT, workDir)}`);
    }

    if (task.mode === 'local' && branchExists(`${task.agent}/${id}`)) {
      runCommand(`git branch -D ${shellQuote(`${task.agent}/${id}`)}`, { cwd: ROOT });
      console.log(`${SYM.OK} Branch deleted: ${task.agent}/${id}`);
    }

    task.status = 'ready';
    task.started_at = null;
    task.mode = null;
    saveStatus(data);
    log('ABORT', id, 'Task aborted, reset to ready');

    console.log(`${SYM.OK} Task ${id} has been aborted and reset to ready.`);
  } catch (error) {
    console.error(`${SYM.FAIL} Abort failed: ${error.message}`);
    process.exit(1);
  }
}

function showNotes(id) {
  const data = loadStatus();
  getTask(data, id);
  const noteFile = path.join(NOTES_DIR, `${id}.md`);
  if (!fs.existsSync(noteFile)) {
    console.log(`${SYM.NOTE} No notes recorded for ${id}.`);
    return;
  }
  process.stdout.write(fs.readFileSync(noteFile, 'utf8'));
}

function showSummary(id) {
  const data = loadStatus();
  getTask(data, id);
  const summaryFile = path.join(SUMMARIES_DIR, `${id}.md`);
  if (!fs.existsSync(summaryFile)) {
    console.log(`${SYM.NOTE} No summary for ${id} yet. Complete the task first.`);
    return;
  }
  process.stdout.write(fs.readFileSync(summaryFile, 'utf8'));
}

function renderGraph(data) {
  const tasks = getTasks(data);
  const lines = ['graph TD'];
  for (const [id, task] of Object.entries(tasks)) {
    lines.push(`  ${id}["${id}: ${task.title}"]`);
    for (const depId of task.depends_on || []) {
      lines.push(`  ${depId} --> ${id}`);
    }
  }
  console.log(lines.join('\n'));
}

function renderStats(data) {
  const tasks = Object.values(getTasks(data));
  const counts = tasks.reduce((acc, task) => {
    acc[task.status] = (acc[task.status] || 0) + 1;
    return acc;
  }, {});
  const completed = tasks.filter((task) => task.status === 'complete');
  const avgLead = completed.length
    ? Math.round(completed.reduce((sum, task) => sum + (task.duration_ms || 0), 0) / completed.length)
    : 0;

  console.log(`${COLORS.bold}Project Stats${COLORS.reset}`);
  console.log(SEP_LIGHT);
  for (const status of Object.keys(STATUS_COLORS)) {
    console.log(`${status.padEnd(12)} ${counts[status] || 0}`);
  }
  console.log(`average_lead  ${formatDuration(avgLead)}`);
}

function dashboard(data) {
  const tasks = getTasks(data);
  const now = Date.now();
  const byPhase = new Map();

  for (const [id, task] of Object.entries(tasks)) {
    const phase = task.phase ?? 'unphased';
    const items = byPhase.get(phase) || [];
    items.push([id, task]);
    byPhase.set(phase, items);
  }

  console.log(`\n${COLORS.bold}${data.meta?.project || 'Project'} Status${COLORS.reset}`);
  console.log(SEP_LIGHT);

  for (const phase of [...byPhase.keys()].sort((a, b) => Number(a) - Number(b))) {
    console.log(`Phase ${phase}`);
    for (const [id, task] of byPhase.get(phase)) {
      const color = STATUS_COLORS[task.status] || '';
      let stallWarning = '';
      if (task.status === 'in_progress' && task.started_at && task.estimated_duration) {
        const elapsedHours = (now - new Date(task.started_at).getTime()) / (1000 * 60 * 60);
        if (elapsedHours > parseFloat(task.estimated_duration)) {
          stallWarning = ` ${COLORS.red}[STALLED]${COLORS.reset}`;
        }
      }
      console.log(`  ${color}[${task.status.toUpperCase().padEnd(11)}]${COLORS.reset} [${task.agent.padEnd(8)}] ${id}: ${task.title}${stallWarning}`);
    }
    console.log('');
  }
}

const args = process.argv.slice(2);
const commandArg = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
};

if (args.includes('--init')) init();
else if (args.includes('--validate')) validatePlan(loadStatus());
else if (args.includes('--stats')) renderStats(loadStatus());
else if (args.includes('--graph')) renderGraph(loadStatus());
else if (args.includes('--start')) startTask(commandArg('--start'), args.includes('--worktree'));
else if (args.includes('--done')) doneTask(commandArg('--done'));
else if (args.includes('--note')) {
  const index = args.indexOf('--note');
  addNote(args[index + 1], args.slice(index + 2));
} else if (args.includes('--abort')) abortTask(commandArg('--abort'));
else if (args.includes('--notes')) showNotes(commandArg('--notes'));
else if (args.includes('--summary')) showSummary(commandArg('--summary'));
else if (args.includes('--show')) showNotes(commandArg('--show'));
else dashboard(loadStatus());
