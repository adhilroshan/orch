'use strict';

/**
 * Adapter: shell
 *
 * Runs an arbitrary shell script as the agent. The script receives the
 * task context as environment variables and positional arguments, so you
 * can wrap any tool, LLM CLI, or automation system.
 *
 * Config keys (in .orch/config.json under "adapters.shell"):
 *   script      (required) Path to the script, relative to project root.
 *   interpreter (optional) Executable to run the script with. Defaults to
 *               /bin/sh on Unix and cmd.exe on Windows.
 *   env         (optional) Object of extra environment variables.
 *
 * The script is called with these positional args:
 *   $1  TASK_ID
 *   $2  WORK_DIR
 *   $3  BRIEF_PATH
 *   $4  DONE_CMD  (the exact command the agent must run when finished)
 *
 * And these environment variables:
 *   ORCH_TASK_ID, ORCH_AGENT, ORCH_WORK_DIR, ORCH_BRIEF_PATH,
 *   ORCH_DONE_CMD, ORCH_CLI_PATH
 *
 * Example script (scripts/my-agent.sh):
 *
 *   #!/bin/bash
 *   cd "$ORCH_WORK_DIR"
 *   my-llm-cli --brief "$ORCH_BRIEF_PATH" --on-complete "$ORCH_DONE_CMD"
 */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

module.exports = {
  name: 'shell',
  description: 'Runs a custom shell script as the agent (generic adapter)',

  launch(context) {
    const { taskId, agentName, workDir, briefPath, orchCliPath, doneCmd, config = {} } = context;

    if (!config.script) {
      throw new Error(
        `Shell adapter requires "script" in .orch/config.json under adapters.shell.\n` +
        `Example: { "script": "./scripts/agent.sh" }`
      );
    }

    const projectRoot = path.dirname(path.dirname(orchCliPath)); // ROOT
    const scriptPath = path.resolve(projectRoot, config.script);

    if (!fs.existsSync(scriptPath)) {
      throw new Error(`Shell adapter script not found: ${scriptPath}`);
    }

    const interpreter = config.interpreter || (process.platform === 'win32' ? 'cmd.exe' : '/bin/sh');
    const isWindows = process.platform === 'win32';
    const args = isWindows
      ? ['/c', scriptPath, taskId, workDir, briefPath, doneCmd]
      : [scriptPath, taskId, workDir, briefPath, doneCmd];

    const env = {
      ...process.env,
      ...(config.env || {}),
      ORCH_TASK_ID: taskId,
      ORCH_AGENT: agentName,
      ORCH_WORK_DIR: workDir,
      ORCH_BRIEF_PATH: briefPath,
      ORCH_DONE_CMD: doneCmd,
      ORCH_CLI_PATH: orchCliPath,
    };

    const logDir = path.join(path.dirname(orchCliPath), 'spawn-logs');
    fs.mkdirSync(logDir, { recursive: true });
    const logPath = path.join(logDir, `${taskId}.log`);
    const logStream = fs.openSync(logPath, 'a');

    const child = spawn(interpreter, args, {
      cwd: workDir,
      detached: true,
      stdio: ['ignore', logStream, logStream],
      env,
    });
    child.unref();

    return { pid: child.pid, script: scriptPath, logPath };
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
