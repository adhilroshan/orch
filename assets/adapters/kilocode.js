'use strict';

/**
 * Adapter: kilocode
 *
 * Launches Kilo Code CLI (`kilo` / `kilocode`) to work on a task.
 *
 * Install:  npm install -g @kilocode/cli
 * Binary:   `kilocode` on Windows, `kilo` on macOS/Linux
 *           (auto-detected — override with "executable" in config)
 *           Supports 500+ models via OpenRouter, Anthropic, OpenAI, Google, etc.
 *
 * PERMISSION HANDLING
 * ───────────────────
 * Kilo Code uses a permission config file at ~/.config/kilo/opencode.json.
 * To skip confirmations in headless mode, set permissions there:
 *
 *   ~/.config/kilo/opencode.json:
 *   {
 *     "permission": {
 *       "*":    "ask",
 *       "bash": "allow",
 *       "edit": "allow",
 *       "read": "allow"
 *     }
 *   }
 *
 * OR pass "--dangerously-skip-permissions" via flags[] for full auto-approve.
 *
 * HEADLESS MODE
 * ─────────────
 *   kilocode --auto "<prompt>"          Runs fully autonomously, exits on done
 *   kilocode --auto --json "<prompt>"   Same but structured JSON output
 *   kilocode --auto --timeout 300 "..."  Hard time limit in seconds
 *   echo "<prompt>" | kilocode --auto   Piped input (alternative)
 *
 * MODES
 * ─────
 * Kilo Code supports named modes. Set "mode" in config to use one:
 *   "code"         — default implementation mode
 *   "architect"    — planning and design
 *   "debug"        — error diagnosis
 *   "orchestrator" — coordinates sub-agents (Kilo's own orchestration)
 *   or any custom mode defined in .kilocode/
 *
 * Config (.orch/config.json):
 *   "kilocode": {
 *     "executable": "kilocode",
 *     "headless":   true,
 *     "mode":       "code",
 *     "model":      "anthropic/claude-sonnet-4-20250514",
 *     "timeout":    600,
 *     "json":       false,
 *     "flags":      []
 *   }
 */

const { spawn }                  = require('node:child_process');
const fs                         = require('node:fs');
const path                       = require('node:path');
const { buildPrompt, readBrief } = require('./prompt-builder');

module.exports = {
  name: 'kilocode',
  description: 'Launches Kilo Code CLI (kilo --auto) — 500+ models, headless + interactive',

  launch(context) {
    const { taskId, agentName, workDir, briefPath, orchCliPath, doneCmd, config = {} } = context;

    const executable = config.executable || (process.platform === 'win32' ? 'kilocode' : 'kilo');
    const extraFlags = config.flags      || [];
    const headless   = config.headless   !== false; // default true for this adapter
    const mode       = config.mode       || 'code';
    const model      = config.model;
    const timeout    = config.timeout;              // seconds
    const jsonOutput = config.json       === true;

    const prompt = buildPrompt({
      taskId, agentName, orchCliPath, doneCmd, headless,
      brief: readBrief(briefPath),
    });

    const modeFlags    = mode    ? ['--mode', mode]           : [];
    const modelFlags   = model   ? ['--model', model]         : [];
    const timeoutFlags = timeout ? ['--timeout', String(timeout)] : [];
    const jsonFlags    = jsonOutput ? ['--json']              : [];

    let child;

    if (headless) {
      const logPath   = mkLogPath(orchCliPath, taskId);
      const logStream = fs.openSync(logPath, 'a');

      // kilocode --auto [--mode X] [--model Y] [--timeout N] "<prompt>"
      child = spawn(
        executable,
        ['--auto', ...modeFlags, ...modelFlags, ...timeoutFlags, ...jsonFlags, ...extraFlags, prompt],
        {
          cwd:      workDir,
          detached: true,
          stdio:    ['ignore', logStream, logStream],
        }
      );
    } else {
      // Interactive: open kilo in the workspace with the prompt pre-loaded
      // kilo passes the first positional arg as the initial message
      child = spawn(
        executable,
        [...modeFlags, ...modelFlags, ...extraFlags, prompt],
        {
          cwd:      workDir,
          detached: true,
          stdio:    'inherit',
          shell:    process.platform === 'win32',
        }
      );
    }

    child.unref();

    return {
      pid:        child.pid,
      headless,
      executable,
      mode,
      logPath: headless ? mkLogPath(orchCliPath, taskId) : null,
    };
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
