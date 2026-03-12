---
name: orch
description: Sets up a complete multi-agent task orchestration system using Node.js and Git Worktrees. Creates isolated development environments for each agent while tracking dependencies, file ownership, and project-wide progress. Use this skill for planning implementation tasks, coordinating parallel work, and managing agent handoffs in complex projects. Trigger for "plan this project", "orchestrate agents", or "split work into tasks".
---

# Agent Orchestration Skill

This skill implements a multi-agent orchestration system. It uses **Node.js** for coordination and **Git Worktrees** to provide isolated working directories when tasks run in parallel, preventing local file collisions and reducing git conflicts.

## Output Files

| File | Purpose |
|---|---|
| `.orch/plan/TASKS.md` | Human-readable specification of all tasks and dependencies. |
| `.orch/plan/AGENT_STATUS.json` | Initial state source (imported by the orchestrator during `--init`). |
| `.orch/cli.js` | The Node.js orchestrator (created by copying `assets/orchestrator-template.js`). |
| `.orch/commit-log.json` | Append-only ledger of commits made by each agent, including task id, branch, timestamp, and commit SHA. |
| Agent handbook (e.g. `CLAUDE.md`, `AGENTS.md`) | Keeps the team on track with roles and protocol. |
| `orch`, `orch.cmd`, `orch.ps1` | Root wrapper scripts to run the orchestrator across Unix-like shells, `cmd.exe`, and PowerShell. |

After creating the plan files, run `node .orch/cli.js --init` or the generated wrapper for your shell to bootstrap the project state.

## Prerequisites

* **Node.js**: The orchestrator is a Node.js script.
* **Git**: Required for worktree management and branching.
* **Git Repository**: Project must be a valid git repository (`git init`).

---

## The .orch/ Directory (Encapsulated)

The `.orch/` directory contains all orchestration metadata, keeping the project root clean.

```
project-root/
  .orch/
    plan/               (Source of Truth: TASKS.md and AGENT_STATUS.json)
    status.json         (Live Machine State: managed by orchestrator)
    commit-log.json     (Append-only ledger of task completion commits)
    notes/              (Append-only per-task markdown threads)
    summaries/          (Task completion summaries with session notes)
    orch.log            (Audit trail of every operation)
    worktrees/          (Isolated workspaces for parallel work)
    archive/            (History of legacy plans)
```

---

## Step 1 -- Contextual Analysis & Planning

Before writing tasks:
1. **Read all core files:** Models, API routes, and primary UI components.
2. **Design the team:** Split by domain (e.g., `api`, `ui`, `infra`).
3. **Draft the plan:** Create `.orch/plan/TASKS.md` and `.orch/plan/AGENT_STATUS.json`.

---

## Step 2 -- Atomic Tasks & Quality Guardrails

A task is "atomic" if it can be finished in 1--2 hours.
* **Exclusive Ownership:** Every file path must be owned by exactly one task. The pre-commit hook blocks commits to unowned files.
* **DoD Enforcement:** Add a `test_command` to tasks to enforce quality before completion.
* **Parallel Safety:** Run `node .orch/cli.js --validate` to check for missing dependencies and file ownership collisions within a phase.

---

## Step 3 -- Smart Workspace Lifecycle

The orchestrator automatically handles the complexity of parallel work:

1. **`node .orch/cli.js --init`**: Bootstraps the system, validates the plan, installs a git pre-commit hook for ownership enforcement, and moves any legacy root plan files into `.orch/plan/`.
2. **`./orch --start <ID>`**: 
   * Starts in **Local Mode** (root directory) if no other tasks are running.
   * Starts in **Parallel Mode** (Worktree) if other tasks are already active or if `--worktree` is passed.
   * Blocks start if dependencies are not complete.
   * Presents **Upstream Handoff Notes** immediately upon start.
3. **`./orch --done <ID>`**: Runs `test_command`, blocks unauthorized file edits, commits changes, and unblocks dependents.
   * Saves session summary to `.orch/summaries/<ID>.md`.
   * Records the resulting commit in `.orch/commit-log.json`.

---

## CLI Reference

```bash
node .orch/cli.js                   # Dashboard grouped by phase
node .orch/cli.js --init            # Bootstrap state from .orch/plan/
node .orch/cli.js --validate        # Verify plan integrity and ownership collisions
node .orch/cli.js --stats           # View project velocity and analytics
node .orch/cli.js --start <ID>      # Start task (Smart Workspace + Handoffs)
node .orch/cli.js --done <ID>       # Enforce DoD, ownership, commit, and mark complete
node .orch/cli.js --abort <ID>      # Abort in-progress task and reset to ready
node .orch/cli.js --summary <ID>    # View task completion summary
node .orch/cli.js --graph           # Output Mermaid.js dependency graph
node .orch/cli.js --note <ID> <MSG> # Add timestamped handoff note
node .orch/cli.js --notes <ID>      # Read notes for a task
```

Completion commits use the format `<agent>(<TASK-ID>): <task title>`.
node .orch/cli.js --spawn-child <ID> --title "..." --agent "..." --files "a.js" [--adapter <n>]
node .orch/cli.js --children <ID>      # List children and their statuses
node .orch/cli.js --await-children <ID> # Block until all children settle (exit 0/1)
