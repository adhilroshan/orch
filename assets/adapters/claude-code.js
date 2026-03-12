'use strict';

/**
 * Adapter: claude-code
 *
 * Launches Claude Code (`claude` CLI) to work on a task.
 *
 * PERMISSION HANDLING
 * ───────────────────
 * Claude Code shows "Allow bash?" prompts in interactive mode.
 * In headless mode these block forever — use one of:
 *
 *   allowedTools: ["bash","read","write","edit"]
 *     Passes --allowedTools bash,read,write,edit  (recommended)
 *
 *   skipPermissions: true
 *     Passes --dangerously-skip-permissions  (CI / sandboxed only)
 *
 * Config (.orch/config.json):
 *   "claude-code": {
 *     "executable":      "claude",
 *     "headless":        true,
 *     "allowedTools":    ["bash","read","write","edit"],
 *     "skipPermissions": false,
 *     "model":           "claude-sonnet-4-5",
 *     "flags":           []
 *   }
 */

const { spawn }                  = require('node:child_process');
const fs                         = require('node:fs');
const path                       = require('node:path');
const { buildPrompt, readBrief } = require('./prompt-builder');

module.exports = {
  name: 'claude-code',
  description: 'Launches Claude Code (claude CLI) — supports headless + permission flags',

  launch(context) {
    const { taskId, agentName, workDir, briefPath, orchCliPath, doneCmd, config = {} } = context;

    const executable   = config.executable      || 'claude';
    const extraFlags   = config.flags           || [];
    const headless     = config.headless        === true;
    const skipPerms    = config.skipPermissions === true;
    const allowedTools = config.allowedTools    || [];
    const model        = config.model;

    const prompt = buildPrompt({
      taskId, agentName, orchCliPath, doneCmd, headless,
      brief: readBrief(briefPath),
    });

    // ── Permission flags ──────────────────────────────────────────────────
    const permFlags = skipPerms
      ? ['--dangerously-skip-permissions']
      : allowedTools.length > 0
        ? ['--allowedTools', allowedTools.join(',')]
        : [];

    const modelFlags = model ? ['--model', model] : [];

    let child;
    if (headless) {
      const logPath   = mkLogPath(orchCliPath, taskId);
      const logStream = fs.openSync(logPath, 'a');
      child = spawn(executable, [...permFlags, ...modelFlags, ...extraFlags, '--print', prompt], {
        cwd: workDir, detached: true,
        stdio: ['ignore', logStream, logStream],
      });
    } else {
      child = spawn(executable, [...permFlags, ...modelFlags, ...extraFlags, prompt], {
        cwd: workDir, detached: true, stdio: 'inherit',
        shell: process.platform === 'win32',
      });
    }
    child.unref();

    return { pid: child.pid, headless, executable };
  },

  check(_ctx, spawnData) {
    return pidAlive(spawnData?.pid);
  },
};

function mkLogPath(orchCliPath, taskId) {
  const dir = path.join(path.dirname(orchCliPath), 'spawn-logs');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${taskId}.log`);
}

function pidAlive(pid) {
  if (!pid) return 'unknown';
  try { process.kill(pid, 0); return 'running'; }
  catch { return 'done'; }
}
