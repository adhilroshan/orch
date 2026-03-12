'use strict';

/**
 * Adapter: claude-code
 * Launches a Claude Code session (`claude` CLI) to work on a task.
 *
 * Modes:
 *   headless: false (default) — opens an interactive Claude Code session
 *             in the task workspace. The agent reads MISSION_BRIEF.md.
 *   headless: true            — runs `claude --print <prompt>` as a
 *             background process. Stdout is piped to the task notes.
 */

'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

module.exports = {
  name: 'claude-code',
  description: 'Launches Claude Code (claude CLI) to work on a task',

  launch(context) {
    const { taskId, agentName, workDir, briefPath, orchCliPath, doneCmd, config = {} } = context;

    const executable = config.executable || 'claude';
    const extraFlags = config.flags || [];
    const headless = config.headless === true;

    const brief = fs.existsSync(briefPath) ? fs.readFileSync(briefPath, 'utf8') : '';

    const prompt = [
      `You are ${agentName}, an AI agent working on task ${taskId}.`,
      ``,
      `--- MISSION BRIEF ---`,
      brief,
      `--- END BRIEF ---`,
      ``,
      `Work through the task described above. Edit only the files listed under`,
      `"Authorized Files". When you have completed ALL objectives and the`,
      `Definition of Done is satisfied, run this exact command:`,
      ``,
      `  ${doneCmd}`,
      ``,
      `Do NOT run that command until the work is truly finished.`,
    ].join('\n');

    let child;

    if (headless) {
      // Non-interactive: pipe output to a log file in .orch/
      const logDir = path.join(path.dirname(orchCliPath), 'spawn-logs');
      fs.mkdirSync(logDir, { recursive: true });
      const logPath = path.join(logDir, `${taskId}.log`);
      const logStream = fs.openSync(logPath, 'a');

      child = spawn(executable, [...extraFlags, '--print', prompt], {
        cwd: workDir,
        detached: true,
        stdio: ['ignore', logStream, logStream],
      });
      child.unref();
    } else {
      // Interactive: open a new process that the user can see / interact with
      child = spawn(executable, [...extraFlags, prompt], {
        cwd: workDir,
        detached: true,
        stdio: 'inherit',
        shell: process.platform === 'win32',
      });
      child.unref();
    }

    return { pid: child.pid, headless, executable };
  },

  check(_context, spawnData) {
    if (!spawnData?.pid) return 'unknown';
    try {
      process.kill(spawnData.pid, 0);
      return 'running';
    } catch {
      return 'done';
    }
  },
};
