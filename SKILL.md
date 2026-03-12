---
name: orch
description: Use when coordinating multiple AI agents on the same codebase to prevent file conflicts, track dependencies, and manage parallel work.
---

# Agent Orchestration Skill

This skill sets up a complete multi-agent task orchestration system using Node.js and Git Worktrees. It creates isolated development environments for each agent while tracking dependencies, file ownership, and project-wide progress.

## When to Use

- Planning implementation tasks for complex projects
- Coordinating parallel work across multiple AI agents
- Managing agent handoffs in multi-agent workflows
- Preventing file conflicts when agents work simultaneously

## When NOT to Use

- Single agent working alone
- Simple projects with <5 tasks
- Projects already using another orchestration system

## Output Files

| File | Purpose |
|---|---|
| `.orch/plan/TASKS.md` | Human-readable specification of all tasks and dependencies |
| `.orch/plan/AGENT_STATUS.json` | Machine-readable task state (imported by orchestrator during `--init`) |
| `.orch/cli.js` | Node.js orchestrator (copy from `assets/orchestrator-template.js`) |
| `.orch/commit-log.json` | Append-only ledger of commits made by each agent |

## Prerequisites

- **Node.js**: The orchestrator is a Node.js script
- **Git**: Required for worktree management and branching
- **Git Repository**: Project must be a valid git repository

## Quick Reference

| Command | Purpose |
|---------|---------|
| `node .orch/cli.js --init` | Bootstrap state from plan files |
| `node .orch/cli.js --validate` | Check ownership collisions |
| `./orch --start <ID>` | Start task (auto-selects local/worktree mode) |
| `./orch --done <ID>` | Verify DoD, commit, mark complete |
| `./orch --abort <ID>` | Reset in-progress task |
| `./orch --graph` | Output Mermaid.js dependency graph |

## Step 1 -- Contextual Analysis

Before writing tasks:
1. Read all core files: Models, API routes, UI components
2. Design the team: Split by domain (e.g., `api`, `ui`, `infra`)
3. Draft the plan: Create `.orch/plan/TASKS.md` and `AGENT_STATUS.json`

## Step 2 -- Atomic Tasks

A task is "atomic" if it can be finished in 1-2 hours.

- **Exclusive Ownership**: Every file owned by exactly one task
- **DoD Enforcement**: Add `test_command` for quality verification
- **Parallel Safety**: Run `--validate` to check collisions

## Step 3 -- Workspace Lifecycle

1. **`--init`**: Bootstraps system, validates plan, installs pre-commit hook
2. **`--start <ID>`**: 
   - Local Mode if no other tasks running
   - Worktree Mode if parallel work detected
   - Blocks if dependencies incomplete
3. **`--done <ID>`**: Runs test_command, enforces ownership, commits, unblocks dependents

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Tasks too large (>2 hours) | Split into smaller atomic tasks |
| Missing dependencies | Add `depends_on` array to each task |
| No test_command | Add verification command for DoD |
| Overlapping file ownership | Run `--validate` before starting |
| Skipping `--init` | Always bootstrap before starting work |

## Task Definition

```json
{
  "TASK-ID": {
    "title": "What the task accomplishes",
    "agent": "api",
    "phase": 1,
    "status": "ready",
    "depends_on": ["OTHER-TASK-ID"],
    "output_files": ["src/routes/auth.py"],
    "definition_of_done": "Acceptance criteria",
    "test_command": "pytest tests/test_auth.py"
  }
}
```

Completion commits use format: `<agent>(<TASK-ID>): <task title>`
