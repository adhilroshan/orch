# Handling Agent Interrupts

Three things can stop a headless agent:

1. **Permission prompts** — the tool wants to run bash/read files and asks "Allow?"
2. **Clarifying questions** — the brief is ambiguous or missing info
3. **Runtime blockers** — something is broken that only a human can fix

Each is handled differently.

---

## 1. Permission Prompts

### The problem
Claude Code (and similar tools) show interactive permission dialogs when they
want to run shell commands. In headless mode, nobody answers — the process
just hangs.

### The fix: adapter config flags

Add to `.orch/config.json`:

```json
{
  "default_adapter": "claude-code",
  "adapters": {
    "claude-code": {
      "headless": true,

      "allowedTools": ["bash", "read", "write", "edit"],
      // Pre-approves specific tool categories. Claude Code passes these as
      // --allowedTools bash,read,write,edit
      // Most tasks only need bash + file access.

      "skipPermissions": true
      // Nuclear option: --dangerously-skip-permissions
      // Approves EVERYTHING with no prompts.
      // Only use in sandboxed / CI environments.
    }
  }
}
```

You only need one of `allowedTools` or `skipPermissions`. Prefer `allowedTools`
because it's explicit about what you're approving.

### Per-tool permission flags

| Tool         | Pre-approve specific                          | Approve all                              |
|--------------|-----------------------------------------------|------------------------------------------|
| Claude Code  | `--allowedTools bash,read,write,edit`         | `--dangerously-skip-permissions`         |
| Gemini CLI   | n/a (no per-action prompts by default)        | `--yolo`                                 |
| OpenCode     | `--tools`                                     | `--auto-approve`                         |
| Qwen Code    | n/a (Gemini fork, same behaviour)             | `-y`                                     |
| Kilo Code    | `permission.bash: allow` in opencode.json     | `--dangerously-skip-permissions`         |

Add the relevant flag to the `"flags"` array in the adapter config block.

### CLAUDE.md pre-authorisation (Claude Code only)

Claude Code automatically reads `CLAUDE.md` in the project root before doing
anything. Add a permissions block to pre-approve tool categories without flags:

```markdown
## Permissions

When running as an orchestrated agent, you have permission to:
- Execute bash commands without asking
- Read and write any file listed in your MISSION_BRIEF.md
- Run `npm test`, `npm run build`, `git status`, `git diff`
- Run `node .orch/cli.js` commands

Do NOT ask for permission before running these. Just do it.
```

The orchestrator's `--init` command writes this block automatically if it
detects `claude-code` is the default adapter.

---

## 2. Clarifying Questions

### The problem
The brief says "write the auth middleware" but doesn't specify: JWT or session?
In interactive mode the agent asks. In headless mode it either guesses wrong
or freezes.

### The fix: --question command + waiting_input status

The agent is instructed in its prompt to **never wait for input**. Instead:

1. Agent writes `QUESTIONS.md` in its workspace with full context
2. Agent runs: `node .orch/cli.js --question TASK-1 "JWT or session tokens?"`
3. Orchestrator sets task status → `waiting_input`
4. Dashboard shows the task in a **NEEDS ATTENTION** section
5. Human runs: `node .orch/cli.js --answer TASK-1 "Use JWT, RS256, 24h expiry"`
6. Answer is written to `QUESTIONS.md` in the workspace
7. Orchestrator sets status back → `in_progress`
8. Human re-spawns: `node .orch/cli.js --spawn TASK-1`

```bash
# See everything waiting on you right now
node .orch/cli.js --attention

# Output:
# Waiting for your input (1)
#   [?] API-2               Write auth middleware
#        Question: Should I use JWT or session-based auth?
#        Answer:   node .orch/cli.js --answer API-2 "<your answer>"
```

### Preventing questions in the first place

Most questions come from a thin brief. Before running tasks:

- Specify exact technology choices in the brief (`definition_of_done` field)
- Add an **Assumptions** section to `MISSION_BRIEF.md`
- Put project-wide decisions in `CLAUDE.md` / `AGENTS.md` (read automatically)

Brief template additions that eliminate 90% of questions:

```markdown
## Assumptions you may make without asking
- Database: PostgreSQL via Prisma ORM
- Auth: JWT with RS256, 24h access token, 7d refresh token
- Error format: { error: string, code: string }
- Test runner: Vitest
- Package manager: pnpm

## Do NOT proceed if any of the following are unclear
- Which specific files to create (ask via --question)
- Whether to modify a file you do not own (never do this — note it instead)
```

---

## 3. Runtime Blockers

### The problem
Tests won't pass. A dependency is missing. The code path doesn't work and the
agent has tried three times. Spinning forever wastes tokens and blocks the
dashboard from showing the real status.

### The fix: --fail with a reason

The agent prompt explicitly tells the agent to call `--fail` rather than retry
indefinitely:

> "If you have tried more than 2 approaches and are still blocked,
> create BLOCKER.md, then run:
> `node .orch/cli.js --fail TASK-1 "Cannot find prisma client after 3 attempts"`"

The `--attention` command surfaces failed tasks with retry instructions:

```bash
node .orch/cli.js --attention

# Failed tasks (1)
#   [FAIL] API-3             Create user model
#           Reason:  Prisma schema has a syntax error in line 12 of schema.prisma
#           Retry:   node .orch/cli.js --abort API-3 && node .orch/cli.js --spawn API-3
```

Human fixes the schema, then retries. The agent gets a clean start.

---

## Full config example

```json
{
  "default_adapter": "claude-code",
  "adapters": {
    "claude-code": {
      "executable": "claude",
      "headless": true,
      "allowedTools": ["bash", "read", "write", "edit"],
      "flags": []
    },
    "claude-code-interactive": {
      "executable": "claude",
      "headless": false,
      "flags": []
    },
    "gemini-cli": {
      "executable": "gemini",
      "model": "gemini-2.5-pro",
      "headless": true,
      "flags": ["-y"]
    },
    "qwen-code": {
      "executable": "qwen",
      "headless": true,
      "flags": ["-y"]
    },
    "kilocode": {
      "executable": "kilo",
      "headless": true,
      "mode": "code",
      "model": "anthropic/claude-sonnet-4-20250514",
      "timeout": 600,
      "flags": []
    }
  }
}

// Kilo Code permission config (separate file — not in .orch/config.json):
// ~/.config/kilo/opencode.json
{
  "$schema": "https://kilo.ai/config.json",
  "permission": {
    "*":    "ask",
    "bash": "allow",
    "edit": "allow",
    "read": "allow"
  }
}
```

## Decision guide

| Situation                                    | Action                                   |
|----------------------------------------------|------------------------------------------|
| Agent hangs on "Allow bash?"                 | Add `allowedTools` or `skipPermissions`  |
| Agent keeps asking clarifying questions      | Thicken the brief + add Assumptions section |
| Agent asked one specific question and paused | Human runs `--answer`                    |
| Agent failed after multiple retries          | Human fixes root cause, runs `--abort` + `--spawn` |
| Agent is guessing on architecture decisions  | Use interactive mode for that task only  |
