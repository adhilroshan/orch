'use strict';

/**
 * Adapter: opencode
 * Launches an OpenCode session (`opencode` CLI) to work on a task.
 *
 * OpenCode is invoked with an initial prompt containing the mission brief.
 * The agent is instructed to run `orch --done <ID>` on completion.
 */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

module.exports = {
  name: 'opencode',
  description: 'Launches OpenCode (opencode CLI) to work on a task',

  launch(context) {
    const { taskId, agentName, workDir, briefPath, orchCliPath, doneCmd, config = {} } = context;

    const executable = config.executable || 'opencode';
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
      `Complete the task above. Edit only the files listed under "Authorized Files".`,
      `When finished, run: ${doneCmd}`,
    ].join('\n');

    let child;

    if (headless) {
      const logDir = path.join(path.dirname(orchCliPath), 'spawn-logs');
      fs.mkdirSync(logDir, { recursive: true });
      const logPath = path.join(logDir, `${taskId}.log`);
      const logStream = fs.openSync(logPath, 'a');

      // opencode run <prompt> — non-interactive mode
      child = spawn(executable, [...extraFlags, 'run', prompt], {
        cwd: workDir,
        detached: true,
        stdio: ['ignore', logStream, logStream],
      });
      child.unref();
    } else {
      // Interactive session
      child = spawn(executable, [...extraFlags], {
        cwd: workDir,
        detached: true,
        stdio: 'inherit',
        shell: process.platform === 'win32',
        env: {
          ...process.env,
          OPENCODE_INITIAL_PROMPT: prompt,
        },
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
