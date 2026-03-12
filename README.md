# orch -- Multi-Agent Task Orchestration

A skill that sets up a complete multi-agent orchestration system for AI coding assistants. It decomposes projects into atomic tasks, assigns them to agent personas, isolates parallel work with Git Worktrees, and enforces file ownership guardrails -- keeping multiple agents from stepping on each other.

Works with any AI coding agent that supports skills (OpenCode, Claude Code, Gemini CLI, etc.).

## Why

When multiple AI agents work on the same codebase, things break:

- Two agents edit the same file and create merge conflicts
- Agent B starts work before Agent A's dependency is ready
- Nobody tracks what's done, what's blocked, or who owns what
- Handoff context gets lost between sessions

`orch` solves this with a lightweight Node.js CLI that manages task state, workspace isolation, dependency gating, and structured handoffs -- all stored as plain files in a `.orch/` directory.

## How It Works

```
1. Plan      Write TASKS.md + AGENT_STATUS.json describing all tasks
2. Init      Run `orch --init` to bootstrap state and install guardrails
3. Start     Each agent runs `orch --start <ID>` to claim a task
4. Work      Agent codes in an isolated branch (or worktree if parallel)
5. Done      Agent runs `orch --done <ID>` -- tests run, ownership verified, committed
6. Repeat    Downstream tasks auto-unblock when dependencies complete
```

## Quick Start

```bash
# 1. Install the skill (works with any skills.sh-compatible agent)
npx skills add adhilroshan/orch

# 2. Ask your agent to plan a project
#    "Plan this project using the orch skill"

# 3. The agent creates .orch/plan/TASKS.md and .orch/plan/AGENT_STATUS.json

# 4. Bootstrap the orchestration system
node .orch/cli.js --init

# 5. Start working
./orch --start API-1          # Unix
.\orch.cmd --start API-1      # Windows
```

## Installation

Install via [skills.sh](https://skills.sh):

```bash
npx skills add adhilroshan/orch
```

Works with OpenCode, Claude Code, Gemini CLI, Cursor, Windsurf, Cline, and any agent supporting skills.sh.

## CLI Reference

```
orch                          Show the dashboard (tasks grouped by phase)
orch --init                   Bootstrap state from .orch/plan/
orch --validate               Verify plan integrity and ownership collisions
orch --stats                  View project velocity and analytics
orch --start <ID>             Start a task (auto-selects local or worktree mode)
orch --start <ID> --worktree  Force worktree mode even if solo
orch --done <ID>              Verify DoD, enforce ownership, commit, mark complete
orch --abort <ID>             Abort in-progress task, reset to ready
orch --note <ID> <MSG>        Add a timestamped handoff note
orch --notes <ID>             Read notes for a task
orch --summary <ID>           View task completion summary
orch --graph                  Output a Mermaid.js dependency graph
```

## The `.orch/` Directory

All orchestration state lives in `.orch/`, keeping the project root clean.

```
project-root/
  .orch/
    plan/                 Source of truth: TASKS.md and AGENT_STATUS.json
    status.json           Live machine state (managed by CLI, never edit manually)
    commit-log.json       Append-only ledger of task completion commits
    notes/                Per-task markdown threads for handoff notes
    summaries/            Task completion summaries with session context
    orch.log              Audit trail of every operation
    worktrees/            Isolated Git Worktree workspaces for parallel tasks
    archive/              History of legacy plans
```

## Task Definition

Tasks live in `.orch/plan/AGENT_STATUS.json`. Each task has:

```json
{
  "TASK-ID": {
    "title": "What the task accomplishes",
    "agent": "api",
    "phase": 1,
    "status": "ready",
    "depends_on": ["OTHER-TASK-ID"],
    "output_files": ["src/routes/auth.py", "src/models/user.py"],
    "definition_of_done": "Human-readable acceptance criteria",
    "test_command": "pytest tests/test_auth.py",
    "resources": ["port:3000"],
    "notes": ""
  }
}
```

| Field | Purpose |
|---|---|
| `agent` | Which agent persona owns this task |
| `phase` | Execution phase grouping (lower phases run first) |
| `depends_on` | Task IDs that must complete before this can start |
| `output_files` | Files this task is allowed to edit (exclusive ownership) |
| `test_command` | Command run on `--done` to verify Definition of Done |
| `resources` | Shared resources (ports, databases) -- prevents collisions |

## Agent Personas

Agents are defined in the `meta.agents` block of `AGENT_STATUS.json`:

```json
{
  "meta": {
    "project": "My Project",
    "agents": {
      "api":   "Sara Kim -- Core API. Methodical and precise.",
      "ui":    "Nina Osei -- Frontend. Strong accessibility instincts.",
      "infra": "Raj Patel -- Infra & DevOps. Pragmatic and direct."
    }
  }
}
```

Personas give each agent a working style and communication pattern, not just a domain. See `references/agent-design.md` for examples across different project types.

## Key Features

### Smart Workspace Isolation

- **Solo mode**: First active task works directly in the repo root on a feature branch
- **Parallel mode**: When multiple tasks run concurrently, each gets an isolated Git Worktree
- Dependency directories (`node_modules`, `.venv`, etc.) are symlinked automatically

### Ownership Enforcement

- Every file is owned by exactly one task per phase
- `--done` blocks if the agent edited files outside their `output_files` list
- A Git pre-commit hook enforces ownership at commit time
- `--validate` detects file ownership collisions across the plan

### Dependency Gating

- `--start` refuses to run if upstream dependencies aren't complete
- `--done` automatically unblocks downstream tasks
- The dashboard shows `[STALLED]` warnings for overdue tasks

### Structured Handoffs

- `--start` generates a `MISSION_BRIEF.md` with objective, authorized files, and upstream notes
- Agents fill in `HANDOFF.md` documenting approach, changes, and notes for downstream agents
- `--done` archives the handoff to `summaries/` and `notes/` for future reference

### Resource Locking

- Tasks can declare shared resources (e.g., `port:3000`, `db:postgres`)
- `--start` blocks if another active task holds the same resource

## Project Structure

```
agent-orchestration/
  assets/
    orchestrator-template.js   Core CLI (copied to .orch/cli.js on init)
    example-claude.md          Example agent handbook
    example-status.json        Example AGENT_STATUS.json
    example-tasks.md           Example TASKS.md
  references/
    agent-design.md            How to split agents by project type
    test-patterns.md           Test task patterns per tech stack
  SKILL.md                     Skill definition (name, description, instructions)
  package.json                 Package metadata
```

## Prerequisites

- **Node.js** (any recent version -- zero npm dependencies)
- **Git** (for branching and worktree management)
- The target project must be a Git repository

## License

MIT
