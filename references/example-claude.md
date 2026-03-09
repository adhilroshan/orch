# CLAUDE.md — TaskFlow API Orchestration

This project uses a multi-agent orchestration system. Every agent works in an isolated Git Worktree to prevent file collisions.

## The Team

| Key | Full Name | Role | Personality |
|---|---|---|---|
| `api` | Sara Kim | Core API Engineer | Methodical and precise. Documents every public function. Leaves clear handoff notes. |
| `ui` | Nina Osei | Frontend Engineer | Strong accessibility instincts. Never ships without testing keyboard nav. |
| `infra` | Raj Patel | Infra & DevOps | Pragmatic and direct. Fixes broken configs. Unblocks dependencies fast. |

## File Ownership

Every file is owned by exactly one task. Never edit a file you do not own.

| Directory/File | Primary Owner | Notes |
|---|---|---|
| `src/routes/` | `api` | |
| `src/models/` | `api` | |
| `frontend/src/` | `ui` | |
| `docker-compose.yml` | `infra` | |
| `migrations/` | `infra` | |

## The .orch/ Directory (Protocol)

State is managed by the orchestrator. **Never edit files in `.orch/` directly.**

1. **Check Status:** Run `node .orch/cli.js` to see the dashboard.
2. **Start Task:** Run `node .orch/cli.js --start <TASK-ID>`.
   - This creates a Git Worktree at `.orch/worktrees/<TASK-ID>`.
   - `cd` into that directory to do your work.
3. **Finish Task:** From the project root, run `node .orch/cli.js --done <TASK-ID>`.
   - This commits your work, removes the worktree, and unblocks downstream tasks.
4. **Handoff:** Run `node .orch/cli.js --note <TASK-ID> "Your message"` to inform others of interface changes.

## Reading Handoff Notes

Before starting a task that depends on another, read its notes:
`node .orch/cli.js --notes <UPSTREAM-ID>`

## Workflow Summary

```bash
# 1. Start your task
node .orch/cli.js --start API-1

# 2. Enter your isolated workspace
cd .orch/worktrees/API-1

# 3. Code, test, and iterate
# ... (do work)

# 4. Finish and clean up (from root)
cd ../../..
node .orch/cli.js --done API-1

# 5. Leave a note for the UI agent
node .orch/cli.js --note API-1 "Auth schema is stable. UI-1 can proceed."
```

## Branching & Commits

- **Branches:** Created automatically as `<agent>/<task-id>`.
- **Commits:** Prefixed automatically with `[TASK-ID]`.
- **Merge:** Merge your completed branch into `main` after `--done` is verified.

## Where to Start

- `api`: Start with `API-1` (User Auth).
- `ui`: Start with `UI-mock` (Mock API).
- `infra`: Start with `INFRA-1` (Scaffolding).
