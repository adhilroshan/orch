'use strict';

/**
 * Adapter: qwen-code
 *
 * Launches Qwen Code (`qwen` CLI) to work on a task.
 *
 * Install:  npm install -g qwen-code
 * Auth:     export DASHSCOPE_API_KEY=<your key>
 *           https://bailian.console.aliyun.com/
 *
 * PERMISSION HANDLING
 * ───────────────────
 * Qwen Code is a fork of Gemini CLI and accepts the same flags.
 * Add "-y" to flags array to skip all confirmation prompts in headless mode.
 *
 * Config (.orch/config.json):
 *   "qwen-code": {
 *     "executable": "qwen",
 *     "model":      "qwen-max",
 *     "headless":   true,
 *     "apiKey":     "",
 *     "flags":      ["-y"]
 *   }
 */

const { spawn }                  = require('node:child_process');
const fs                         = require('node:fs');
const path                       = require('node:path');
const { buildPrompt, readBrief } = require('./prompt-builder');

module.exports = {
  name: 'qwen-code',
  description: 'Launches Qwen Code CLI (qwen) — Alibaba AI coding agent',

  launch(context) {
    const { taskId, agentName, workDir, briefPath, orchCliPath, doneCmd, config = {} } = context;

    const executable = config.executable || 'qwen';
    const extraFlags = config.flags      || [];
    const headless   = config.headless   === true;
    const model      = config.model;

    const prompt = buildPrompt({
      taskId, agentName, orchCliPath, doneCmd, headless,
      brief: readBrief(briefPath),
    });

    const modelFlags = model ? ['--model', model] : [];
    const env = {
      ...process.env,
      ...(config.apiKey ? { DASHSCOPE_API_KEY: config.apiKey } : {}),
    };

    let child;
    if (headless) {
      const logPath   = mkLogPath(orchCliPath, taskId);
      const logStream = fs.openSync(logPath, 'a');
      child = spawn(executable, [...modelFlags, ...extraFlags, '-p', prompt], {
        cwd: workDir, detached: true,
        stdio: ['ignore', logStream, logStream], env,
      });
    } else {
      child = spawn(executable, [...modelFlags, ...extraFlags, '--prompt', prompt], {
        cwd: workDir, detached: true, stdio: 'inherit',
        shell: process.platform === 'win32', env,
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
