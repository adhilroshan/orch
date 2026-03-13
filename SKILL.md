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

## Quick Start

```bash
# Install
npx skills add adhilroshan/orch

# Ask agent to plan a project
"Plan this project using the orch skill"

# Bootstrap
node .orch/cli.js --init

# Start working
./orch --start TASK-1
```

## Core Concepts

- **Atomic Tasks**: Can finish in 1-2 hours
- **File Ownership**: Each file owned by exactly one task
- **DoD Enforcement**: Add `test_command` for verification
- **Resource Locking**: Declare `["port:3000"]` to prevent conflicts
- **Worktree Isolation**: Parallel tasks get isolated Git worktrees

## CLI Reference

| Command | Purpose |
|---------|---------|
| `./orch` | Dashboard (tasks by phase) |
| `./orch --init` | Bootstrap from plan files |
| `./orch --validate` | Check ownership collisions |
| `./orch --stats` | Velocity analytics |
| `./orch --start <ID>` | Start task |
| `./orch --start <ID> --worktree` | Force worktree |
| `./orch --done <ID>` | Verify DoD, commit, complete |
| `./orch --abort <ID>` | Reset in-progress |
| `./orch --note <ID> <MSG>` | Add note |
| `./orch --notes <ID>` | Read notes |
| `./orch --summary <ID>` | View summary |
| `./orch --graph` | Mermaid.js dependency graph |

For complete CLI reference, task definition schema, agent personas, and file structure, see [orch-reference.md](./orch-reference.md).
