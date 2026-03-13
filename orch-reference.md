# Orch Reference

Complete reference for the orch skill.

## Output Files

| File | Purpose |
|---|---|
| `.orch/plan/TASKS.md` | Human-readable task specification |
| `.orch/plan/AGENT_STATUS.json` | Machine-readable task state |
| `.orch/cli.js` | Node.js orchestrator (copy from `assets/orchestrator-template.js`) |
| `.orch/commit-log.json` | Append-only ledger of commits |
| `.orch/status.json` | Live machine state (managed by CLI) |
| `.orch/orch.log` | Audit trail of every operation |
| `.orch/notes/` | Per-task handoff notes |
| `.orch/summaries/` | Task completion summaries |
| `.orch/worktrees/` | Isolated Git worktree workspaces |
| Wrapper scripts | `orch` (Unix), `orch.cmd` (Windows), `orch.ps1` (PowerShell) |

## Full CLI Reference

| Command | Purpose |
|---------|---------|
| `./orch` | Show dashboard (tasks grouped by phase) |
| `./orch --init` | Bootstrap state from plan files, install pre-commit hook |
| `./orch --validate` | Verify plan integrity, check ownership collisions |
| `./orch --stats` | View project velocity and analytics |
| `./orch --start <ID>` | Start task (auto-selects local or worktree mode) |
| `./orch --start <ID> --worktree` | Force worktree mode even if solo |
| `./orch --done <ID>` | Verify DoD, enforce ownership, commit, mark complete |
| `./orch --abort <ID>` | Abort in-progress task, reset to ready |
| `./orch --note <ID> <MSG>` | Add timestamped handoff note |
| `./orch --notes <ID>` | Read notes for a task |
| `./orch --summary <ID>` | View task completion summary |
| `./orch --graph` | Output Mermaid.js dependency graph |
| `./orch --spawn-child <ID> --title "..." --agent "..." --files "a.js"` | Spawn child task |
| `./orch --children <ID>` | List children and their statuses |
| `./orch --await-children <ID>` | Block until all children settle |

## Task Definition

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

### Fields

| Field | Purpose |
|-------|---------|
| `agent` | Which agent persona owns this task |
| `phase` | Execution phase grouping (lower phases run first) |
| `depends_on` | Task IDs that must complete before this can start |
| `output_files` | Files this task is allowed to edit (exclusive ownership) |
| `test_command` | Command run on `--done` to verify Definition of Done |
| `resources` | Shared resources (ports, databases) - prevents collisions |
| `notes` | Handoff notes for downstream agents |

## Agent Personas

Define in `AGENT_STATUS.json` `meta.agents` block:

```json
{
  "meta": {
    "project": "My Project",
    "agents": {
      "api": "Sara Kim -- Core API. Methodical and precise.",
      "ui": "Nina Osei -- Frontend. Strong accessibility instincts.",
      "infra": "Raj Patel -- Infra & DevOps. Pragmatic and direct."
    }
  }
}
```

Personas give each agent a working style and communication pattern, not just a domain.

## Workspace Lifecycle

### 1. --init
- Bootstraps system from plan files
- Validates plan integrity
- Installs Git pre-commit hook for ownership enforcement
- Moves any legacy root plan files into `.orch/plan/`

### 2. --start <ID>
- **Local Mode**: First active task works in repo root on feature branch
- **Worktree Mode**: If other tasks running or `--worktree` passed, creates isolated Git worktree
- Blocks if dependencies incomplete
- Generates `MISSION_BRIEF.md` with objective, authorized files, upstream notes

### 3. --done <ID>
- Runs `test_command` to verify Definition of Done
- Blocks if agent edited files outside their `output_files` list
- Commits changes with format: `<agent>(<TASK-ID>): <task title>`
- Unblocks dependent tasks
- Saves session summary to `.orch/summaries/<ID>.md`
- Archives handoff to `.orch/notes/`

## The .orch/ Directory

```
project-root/
  .orch/
    plan/              TASKS.md and AGENT_STATUS.json (source of truth)
    status.json        Live machine state (managed by CLI, never edit manually)
    commit-log.json    Append-only ledger of task completion commits
    notes/            Per-task markdown threads for handoff notes
    summaries/        Task completion summaries with session context
    orch.log          Audit trail of every operation
    worktrees/        Isolated Git Worktree workspaces for parallel tasks
    archive/          History of legacy plans
```

## Key Features

### Smart Workspace Isolation
- **Solo mode**: First active task works directly in the repo root on a feature branch
- **Parallel mode**: When multiple tasks run concurrently, each gets an isolated Git Worktree
- Dependency directories (`node_modules`, `.venv`, etc.) are symlinked automatically

### Ownership Enforcement
- Every file is owned by exactly one task per phase
- `--done` blocks if the agent edited files outside their `output_files` list
- Git pre-commit hook enforces ownership at commit time
- `--validate` detects file ownership collisions across the plan

### Dependency Gating
- `--start` refuses to run if upstream dependencies aren't complete
- `--done` automatically unblocks downstream tasks
- Dashboard shows `[STALLED]` warnings for overdue tasks

### Structured Handoffs
- `--start` generates `MISSION_BRIEF.md` with objective, authorized files, upstream notes
- Agents fill in `HANDOFF.md` documenting approach, changes, notes for downstream
- `--done` archives handoff to `summaries/` and `notes/`

### Resource Locking
- Tasks can declare shared resources (e.g., `port:3000`, `db:postgres`)
- `--start` blocks if another active task holds the same resource

## Prerequisites

- **Node.js** (any recent version - zero npm dependencies)
- **Git** (for branching and worktree management)
- Target project must be a Git repository

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Tasks >2 hours | Split into atomic tasks |
| Missing depends_on | Add task dependencies |
| No test_command | Add verification command |
| Overlapping ownership | Run `--validate` first |
| Skipping `--init` | Always bootstrap first |
