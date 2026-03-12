---
name: orch
description: Use when coordinating multiple AI agents on the same codebase to prevent file conflicts, track dependencies, and manage parallel work.
---

# Agent Orchestration Skill

Sets up a multi-agent task orchestration system using Node.js and Git Worktrees. Creates isolated environments while tracking dependencies, file ownership, and progress.

## When to Use

- Planning tasks for complex projects
- Coordinating parallel work across agents
- Managing agent handoffs
- Preventing file conflicts

## When NOT to Use

- Single agent working alone
- Projects with <5 tasks
- Projects using another orchestration system

## Output Files

| File | Purpose |
|---|---|
| `.orch/plan/TASKS.md` | Task spec |
| `.orch/plan/AGENT_STATUS.json` | Machine state |
| `.orch/cli.js` | Orchestrator |
| `.orch/commit-log.json` | Commit ledger |

## Prerequisites

- **Node.js**: Orchestrator script
- **Git**: Worktree management
- **Git Repository**: Must be initialized

## Quick Reference

| Command | Purpose |
|---------|---------|
| `./orch` | Dashboard (tasks by phase) |
| `./orch --init` | Bootstrap from plan files |
| `./orch --validate` | Check ownership collisions |
| `./orch --stats` | Velocity analytics |
| `./orch --start <ID>` | Start task (auto local/worktree) |
| `./orch --start <ID> --worktree` | Force worktree mode |
| `./orch --done <ID>` | Verify DoD, commit, complete |
| `./orch --abort <ID>` | Reset in-progress task |
| `./orch --note <ID> <MSG>` | Add note |
| `./orch --notes <ID>` | Read notes |
| `./orch --summary <ID>` | Summary |
| `./orch --graph` | Mermaid.js dependency graph |

## Step 1 -- Contextual Analysis

1. Read core files
2. Design team by domain
3. Draft TASKS.md and AGENT_STATUS.json

## Step 2 -- Atomic Tasks

- **Atomic**: Can finish in 1-2 hours
- **Ownership**: Each file owned by one task
- **DoD**: Add `test_command` for verification
- **Resources**: Declare `["port:3000"]` to prevent conflicts
- **Validation**: Run `--validate` to check collisions

## Step 3 -- Workspace Lifecycle

1. **`--init`**: Bootstrap, validate plan, install pre-commit hook
2. **`--start <ID>`**: 
   - Local Mode if solo, Worktree if parallel
   - Blocks if dependencies incomplete
   - Generates MISSION_BRIEF.md
3. **`--done <ID>`**: Run test_command, enforce ownership, commit, unblock dependents
   - Save summary to `.orch/summaries/<ID>.md`
   - Archive handoff to `.orch/notes/`

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Tasks >2 hours | Split into atomic tasks |
| Missing depends_on | Add task dependencies |
| No test_command | Add verification command |
| Overlapping ownership | Run `--validate` first |
| Skipping `--init` | Always bootstrap first |

## Task Definition

```json
{
  "TASK-ID": {
    "title": "Task title",
    "agent": "api",
    "phase": 1,
    "status": "ready",
    "depends_on": ["OTHER-ID"],
    "output_files": ["src/routes/auth.py"],
    "definition_of_done": "Acceptance criteria",
    "test_command": "pytest tests/test_auth.py",
    "resources": ["port:3000"]
  }
}
```

## Agent Personas

In `AGENT_STATUS.json` `meta.agents`:

```json
{
  "meta": {
    "agents": {
      "api": "Sara Kim -- Core API. Methodical.",
      "ui": "Nina Osei -- Frontend. Accessibility focus.",
      "infra": "Raj Patel -- DevOps. Pragmatic."
    }
  }
}
```

Commits: `<agent>(<TASK-ID>): <title>`
