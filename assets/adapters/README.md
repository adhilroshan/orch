# Orch Adapters

Adapters make the orchestrator **tool-agnostic**. Each adapter is a Node.js
module that teaches `orch` how to spawn an AI agent using a specific tool
(Claude Code, OpenCode, a custom shell script, etc.).

---

## How It Works

When you run `orch --spawn <TASK-ID>`, the orchestrator:

1. Starts the task workspace (same as `--start`)
2. Loads the configured adapter
3. Calls `adapter.launch(context)` — which spawns the external agent process
4. Stores the PID and adapter name in `status.json`

The spawned agent works in its worktree, reads `MISSION_BRIEF.md`, and when
done calls `orch --done <TASK-ID>` itself.

---

## Adapter Search Order

1. `.orch/adapters/<name>.js` — **project-local** (highest priority)
2. Built-in adapters shipped with the skill: `claude-code`, `opencode`, `shell`

Put your custom adapters in `.orch/adapters/` to override or extend builtins.

---

## Writing a Custom Adapter

Create `.orch/adapters/my-tool.js`:

```js
'use strict';

module.exports = {
  // Unique identifier — used in --adapter flag and config
  name: 'my-tool',

  // Shown in `orch --adapters`
  description: 'Launches My Tool to work on a task',

  /**
   * Launch the agent for a task.
   *
   * @param {object} context
   * @param {string}  context.taskId       - Task ID being spawned
   * @param {string}  context.agentName    - Agent name (e.g. "api", "ui")
   * @param {string}  context.workDir      - Absolute path to task workspace
   * @param {string}  context.briefPath    - Absolute path to MISSION_BRIEF.md
   * @param {string}  context.orchCliPath  - Absolute path to .orch/cli.js
   * @param {string}  context.doneCmd      - Shell command agent must run when done
   * @param {object}  context.task         - Full task object from status.json
   * @param {object}  context.config       - Adapter config from .orch/config.json
   *
   * @returns {{ pid: number, [extra: string]: any }}
   */
  launch(context) {
    const { spawn } = require('node:child_process');
    const { workDir, doneCmd, config } = context;

    const child = spawn('my-tool-cli', ['--task', context.taskId, doneCmd], {
      cwd: workDir,
      detached: true,
      stdio: 'ignore',
    });
    child.unref();

    return { pid: child.pid };
  },

  /**
   * Check if a previously spawned agent is still running.
   * Optional — if omitted, orch uses PID polling.
   *
   * @param {object} context   - Same as launch context
   * @param {object} spawnData - Object returned by launch()
   * @returns {'running'|'done'|'unknown'}
   */
  check(context, spawnData) {
    if (!spawnData?.pid) return 'unknown';
    try {
      process.kill(spawnData.pid, 0);
      return 'running';
    } catch {
      return 'done';
    }
  },
};
```

---

## Config Block (`.orch/config.json`)

Each adapter can have a config block under `adapters.<name>`:

```json
{
  "default_adapter": "claude-code",
  "adapters": {
    "claude-code": {
      "executable": "claude",
      "flags": [],
      "headless": false
    },
    "opencode": {
      "executable": "opencode",
      "flags": [],
      "headless": false
    },
    "shell": {
      "script": "./scripts/agent.sh"
    },
    "my-tool": {
      "some_option": "value"
    }
  }
}
```

This config is passed as `context.config` to `launch()` and `check()`.

---

## Child-Aware Adapters (optional)

Adapters do **not** need to change to support hierarchical spawning.  Children
are just tasks — they flow through the same `launch()` path.

However, if you want an adapter to behave differently when it is launching a
*child* task (e.g. use a shorter briefing prompt, skip the interactive UI,
or connect back to a parent session), you can inspect `context.task.parent_task`:

```js
launch(context) {
  const isChild = !!context.task.parent_task;

  const prompt = isChild
    ? `You are ${context.agentName} working on child task ${context.taskId}.\n` +
      `Parent task: ${context.task.parent_task}\n` +
      fs.readFileSync(context.briefPath, 'utf8')
    : buildFullPrompt(context);   // your normal prompt builder

  // ...launch the process as usual...
}
```

### Headless children

The most common pattern is: interactive parent + headless children.

```json
{
  "default_adapter": "claude-code",
  "adapters": {
    "claude-code": { "headless": false },
    "claude-code-headless": { "executable": "claude", "headless": true }
  }
}
```

Then spawn children with `--adapter claude-code-headless`, or in agent-api.js:

```js
api.spawnChild(parentId, taskDef, { adapter: 'claude-code-headless' });
```

### Checking child status from an adapter

Adapters can call `node .orch/agent-api.js status <childId>` in their
`check()` implementation to get richer status than a PID poll.
