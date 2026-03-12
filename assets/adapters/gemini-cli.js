'use strict';

/**
 * Adapter: gemini-cli
 *
 * Launches Google Gemini CLI (`gemini` command) to work on a task.
 *
 * Install:  npm install -g @google/gemini-cli
 * Auth:     Run `gemini` once — it opens browser OAuth and caches the token.
 *
 * PERMISSION HANDLING
 * ───────────────────
 * Gemini CLI trusts the local user by default and does not show per-action
 * permission dialogs. No special flags needed for headless mode.
 *
 * If you see "Sandbox restricted" warnings, add "yolo": true to config
 * which passes --yolo (skip all sandbox confirmations).
 *
 * Config (.orch/config.json):
 *   "gemini-cli": {
 *     "executable": "gemini",
 *     "model":      "gemini-2.5-pro",
 *     "headless":   true,
 *     "yolo":       false,
 *     "flags":      []
 *   }
 */

const { spawn }                  = require('node:child_process');
const fs                         = require('node:fs');
const path                       = require('node:path');
const { buildPrompt, readBrief } = require('./prompt-builder');

module.exports = {
  name: 'gemini-cli',
  description: 'Launches Google Gemini CLI (gemini) — headless via -p flag',

  launch(context) {
    const { taskId, agentName, workDir, briefPath, orchCliPath, doneCmd, config = {} } = context;

    const executable = config.executable || 'gemini';
    const extraFlags = config.flags      || [];
    const headless   = config.headless   === true;
    const model      = config.model;
    const yolo       = config.yolo       === true;

    const prompt = buildPrompt({
      taskId, agentName, orchCliPath, doneCmd, headless,
      brief: readBrief(briefPath),
    });

    const modelFlags = model ? ['--model', model] : [];
    const yoloFlags  = yolo  ? ['--yolo']         : [];

    let child;
    if (headless) {
      const logPath   = mkLogPath(orchCliPath, taskId);
      const logStream = fs.openSync(logPath, 'a');
      // gemini -p "<prompt>"  — non-interactive one-shot
      child = spawn(executable, [...modelFlags, ...yoloFlags, ...extraFlags, '-p', prompt], {
        cwd: workDir, detached: true,
        stdio: ['ignore', logStream, logStream],
      });
    } else {
      // Interactive: gemini opens a chat session; --prompt seeds the first message
      child = spawn(executable, [...modelFlags, ...yoloFlags, ...extraFlags, '--prompt', prompt], {
        cwd: workDir, detached: true, stdio: 'inherit',
        shell: process.platform === 'win32',
      });
    }
    child.unref();

    return { pid: child.pid, headless, executable };
  },

  check(_ctx, spawnData) { return pidAlive(spawnData?.pid); },
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
