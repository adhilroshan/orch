#!/usr/bin/env node
'use strict';

/**
 * agent-api.js — Programmatic API for agents to interact with the orchestrator.
 *
 * Deployed to: .orch/agent-api.js  (alongside cli.js)
 *
 * Usage from within an agent (require):
 *   const api = require('./.orch/agent-api');
 *   const child = await api.spawnChild(parentId, { title, agent, outputFiles });
 *   await api.waitForChildren(parentId);
 *
 * Usage from a shell script or headless agent:
 *   node .orch/agent-api.js spawn-child TASK-1 --title "Analyse schema" --agent priya
 *   node .orch/agent-api.js wait-children TASK-1
 *   node .orch/agent-api.js children TASK-1
 *   node .orch/agent-api.js status TASK-1
 *
 * The adapter layer is untouched — each child still launches via whatever
 * adapter the orchestrator is configured to use (or one specified per call).
 */

const fs   = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT        = process.cwd();
const ORCH_DIR    = path.join(ROOT, '.orch');
const STATUS_FILE = path.join(ORCH_DIR, 'status.json');
const CLI_PATH    = path.join(ORCH_DIR, 'cli.js');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function loadStatus() {
  if (!fs.existsSync(STATUS_FILE)) {
    throw new Error('Missing .orch/status.json — run cli.js --init first.');
  }
  return JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
}

function saveStatus(data) {
  data.meta = data.meta || {};
  data.meta.last_updated = new Date().toISOString();
  fs.writeFileSync(STATUS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function orchCli(...args) {
  const result = spawnSync('node', [CLI_PATH, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return {
    ok:     result.status === 0,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim(),
    status: result.status,
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}


// ─── Core API ────────────────────────────────────────────────────────────────

/**
 * spawnChild(parentId, taskDef, options?)
 *
 * Creates a new sub-task under parentId and immediately spawns it using the
 * configured adapter (or the adapter specified in options.adapter).
 *
 * taskDef fields:
 *   title         string    — one-sentence description (required)
 *   agent         string    — agent name (required)
 *   outputFiles   string[]  — files this child owns (required)
 *   phase         number    — defaults to parent phase
 *   dependsOn     string[]  — additional deps beyond the parent itself
 *   resources     string[]  — ports / databases to lock
 *   definitionOfDone string — what "done" means for this sub-task
 *
 * options:
 *   adapter       string    — override default_adapter for this child
 *   headless      boolean   — pass headless flag to adapter
 *
 * Returns the generated child task ID.
 */
function spawnChild(parentId, taskDef, options = {}) {
  if (!taskDef.title)       throw new Error('spawnChild: taskDef.title is required');
  if (!taskDef.agent)       throw new Error('spawnChild: taskDef.agent is required');
  if (!taskDef.outputFiles) throw new Error('spawnChild: taskDef.outputFiles is required');

  const data     = loadStatus();
  const parent   = data[parentId];
  if (!parent) throw new Error(`spawnChild: parent task "${parentId}" not found`);

  // Generate a child ID: <PARENT-ID>.c<N>
  const existing  = Object.keys(data).filter(k => k.startsWith(parentId + '.c'));
  const childIdx  = existing.length + 1;
  const childId   = `${parentId}.c${childIdx}`;

  // Build the child task record
  const childTask = {
    title:            taskDef.title,
    agent:            taskDef.agent,
    phase:            taskDef.phase ?? parent.phase,
    status:           'ready',
    depends_on:       taskDef.dependsOn ?? [],
    output_files:     taskDef.outputFiles,
    resources:        taskDef.resources ?? [],
    definition_of_done: taskDef.definitionOfDone ?? taskDef.title,
    notes:            '',
    completed_at:     null,
    parent_task:      parentId,
    children:         [],
  };

  // Register child on parent
  parent.children = parent.children ?? [];
  parent.children.push(childId);

  data[childId] = childTask;
  saveStatus(data);

  // Spawn via the CLI adapter system (keeps adapter logic in one place)
  const spawnArgs = ['--spawn', childId];
  if (options.adapter)  spawnArgs.push('--adapter', options.adapter);
  if (options.headless) spawnArgs.push('--headless');

  const result = orchCli(...spawnArgs);
  if (!result.ok) {
    throw new Error(`spawnChild: cli.js --spawn ${childId} failed:\n${result.stderr}`);
  }

  return childId;
}


/**
 * getChildren(parentId)
 *
 * Returns an array of { id, task } for all direct children of parentId.
 * Reads live from status.json every call — no caching.
 */
function getChildren(parentId) {
  const data   = loadStatus();
  const parent = data[parentId];
  if (!parent) throw new Error(`getChildren: task "${parentId}" not found`);
  return (parent.children ?? []).map(cid => ({ id: cid, task: data[cid] }));
}

/**
 * getStatus(taskId)
 *
 * Returns the current task record for taskId (or null if not found).
 */
function getStatus(taskId) {
  const data = loadStatus();
  return data[taskId] ?? null;
}

/**
 * waitForChildren(parentId, options?)
 *
 * Polls until all direct children of parentId are complete or failed.
 * Returns { allComplete, results } where results is an array of { id, status }.
 *
 * options:
 *   pollMs      number   — polling interval in ms (default 3000)
 *   timeoutMs   number   — hard timeout in ms (default 0 = no timeout)
 *   onPoll      function — called with results on each poll tick
 */
async function waitForChildren(parentId, options = {}) {
  const pollMs   = options.pollMs    ?? 3000;
  const timeoutMs = options.timeoutMs ?? 0;
  const started  = Date.now();

  while (true) {
    const children = getChildren(parentId);
    if (children.length === 0) return { allComplete: true, results: [] };

    const results = children.map(({ id, task }) => ({
      id,
      status: task?.status ?? 'unknown',
    }));

    const pending = results.filter(r => !['complete', 'failed'].includes(r.status));

    if (typeof options.onPoll === 'function') options.onPoll(results);

    if (pending.length === 0) {
      const allComplete = results.every(r => r.status === 'complete');
      return { allComplete, results };
    }

    if (timeoutMs > 0 && Date.now() - started >= timeoutMs) {
      return { allComplete: false, timedOut: true, results };
    }

    await sleep(pollMs);
  }
}

/**
 * addNote(taskId, message)
 *
 * Appends a timestamped note to taskId.  Delegates to cli.js --note.
 */
function addNote(taskId, message) {
  const result = orchCli('--note', taskId, message);
  if (!result.ok) throw new Error(`addNote failed: ${result.stderr}`);
}

/**
 * markDone(taskId)
 *
 * Marks taskId complete and triggers auto-resolve in the orchestrator.
 * Equivalent to running: node .orch/cli.js --done <taskId>
 */
function markDone(taskId) {
  const result = orchCli('--done', taskId);
  if (!result.ok) throw new Error(`markDone failed: ${result.stderr}`);
}


// ─── Module exports ───────────────────────────────────────────────────────────

module.exports = { spawnChild, getChildren, getStatus, waitForChildren, addNote, markDone };

// ─── CLI mode ────────────────────────────────────────────────────────────────
// Called directly: node .orch/agent-api.js <command> [args...]

if (require.main === module) {
  const [,, cmd, ...rest] = process.argv;

  (async () => {
    switch (cmd) {

      case 'spawn-child': {
        // node agent-api.js spawn-child <parentId> --title "..." --agent "..." --files "a.js,b.js" [--adapter claude-code]
        const parentId = rest.shift();
        const flags = parseFlags(rest);
        if (!parentId || !flags.title || !flags.agent || !flags.files) {
          console.error('Usage: agent-api.js spawn-child <parentId> --title "..." --agent "..." --files "a.js,b.js"');
          process.exit(1);
        }
        const childId = spawnChild(parentId, {
          title:       flags.title,
          agent:       flags.agent,
          outputFiles: flags.files.split(',').map(s => s.trim()),
          dependsOn:   flags['depends-on'] ? flags['depends-on'].split(',').map(s => s.trim()) : [],
          definitionOfDone: flags.done || flags.title,
        }, { adapter: flags.adapter });
        console.log(`[SPAWN] Child created and spawned: ${childId}`);
        break;
      }

      case 'children': {
        const parentId = rest[0];
        if (!parentId) { console.error('Usage: agent-api.js children <parentId>'); process.exit(1); }
        const children = getChildren(parentId);
        if (children.length === 0) { console.log('No children.'); break; }
        for (const { id, task } of children) {
          console.log(`  ${id.padEnd(20)} [${(task?.status ?? 'unknown').padEnd(11)}] ${task?.title ?? ''}`);
        }
        break;
      }

      case 'status': {
        const taskId = rest[0];
        if (!taskId) { console.error('Usage: agent-api.js status <taskId>'); process.exit(1); }
        const task = getStatus(taskId);
        console.log(JSON.stringify(task, null, 2));
        break;
      }

      case 'wait-children': {
        const parentId = rest[0];
        if (!parentId) { console.error('Usage: agent-api.js wait-children <parentId>'); process.exit(1); }
        console.log(`[WAIT] Waiting for children of ${parentId} ...`);
        const { allComplete, results } = await waitForChildren(parentId, {
          onPoll: results => {
            const pending = results.filter(r => !['complete','failed'].includes(r.status));
            process.stdout.write(`\r  ${pending.length} task(s) still running ...    `);
          },
        });
        console.log('\n');
        for (const r of results) console.log(`  ${r.id.padEnd(20)} [${r.status}]`);
        process.exit(allComplete ? 0 : 1);
      }

      case 'note': {
        const [taskId, ...words] = rest;
        addNote(taskId, words.join(' '));
        console.log(`[NOTE] Added to ${taskId}`);
        break;
      }

      default:
        console.log([
          'agent-api.js — agent-side orchestrator API',
          '',
          'Commands:',
          '  spawn-child <parentId> --title "..." --agent "..." --files "a.js,b.js"',
          '                         [--depends-on "T1,T2"] [--done "definition"] [--adapter <n>]',
          '  children    <parentId>',
          '  status      <taskId>',
          '  wait-children <parentId>',
          '  note        <taskId> <message>',
        ].join('\n'));
    }
  })().catch(e => { console.error(e.message); process.exit(1); });
}

function parseFlags(args) {
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      flags[args[i].slice(2)] = args[i + 1];
      i++;
    }
  }
  return flags;
}
