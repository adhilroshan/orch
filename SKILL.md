---
name: agent-orchestration
description: Sets up a complete multi-agent task orchestration system using Node.js and Git Worktrees. Creates isolated development environments for each agent while tracking dependencies, file ownership, and project-wide progress. Use this skill for planning implementation tasks, coordinating parallel work, and managing agent handoffs in complex projects. Trigger for "plan this project", "orchestrate agents", or "split work into tasks".
---

# Agent Orchestration Skill

This skill implements a high-integrity multi-agent orchestration system. It uses **Node.js** for coordination and **Git Worktrees** to provide each agent with an isolated working directory, preventing local file collisions and git conflicts.

## Output Files

| File | Purpose |
|---|---|
| `.orch/plan/TASKS.md` | Human-readable specification of all tasks and dependencies. |
| `.orch/plan/AGENT_STATUS.json` | Initial state source (imported by the orchestrator during `--init`). |
| `.orch/cli.js` | The Node.js orchestrator (created by copying `references/orchestrator-template.js`). |
| `CLAUDE.md` | Agent handbook - keeps the team on track with roles and protocol. |
| `orch` | Tiny root wrapper script to run the orchestrator easily (`./orch`). |

After creating the plan files, agents run `./orch --init` to bootstrap the project state.

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
    notes/              (Append-only per-task markdown threads)
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
* **Exclusive Ownership:** Every file path must be owned by exactly one task.
* **DoD Enforcement:** Add a `test_command` to tasks to enforce quality before completion.
* **Parallel Safety:** Run `./orch --validate` to check for file ownership collisions in the same phase.

---

## Step 3 -- Smart Workspace Lifecycle

The orchestrator automatically handles the complexity of parallel work:

1. **`./orch --init`**: Bootstraps the system and moves any legacy root files to `.orch/plan/`.
2. **`./orch --start <ID>`**: 
   * Starts in **Local Mode** (root directory) if no other tasks are running.
   * Starts in **Parallel Mode** (Worktree) if other tasks are already active.
   * Presents **Upstream Handoff Notes** immediately upon start.
3. **`./orch --done <ID>`**: Runs `test_command`, commits changes, and unblocks dependents.

---

## CLI Reference

```bash
./orch                   # Dashboard grouped by phase
./orch --init            # Bootstrap state from .orch/plan/
./orch --validate        # Verify parallel safety and plan integrity
./orch --stats           # View project velocity and analytics
./orch --start <ID>      # Start task (Smart Workspace + Handoffs)
./orch --done <ID>       # Enforce DoD, commit, and mark complete
./orch --graph           # Output Mermaid.js dependency graph
./orch --note <ID> <MSG> # Add timestamped handoff note
```
