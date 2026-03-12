# Hierarchical Agents

The orchestrator supports **parent → child** agent spawning: a running agent can
dynamically create sub-tasks under itself, wait for them to finish, and then
continue — or complete itself.  This is fully tool-agnostic; children are
spawned through the same adapter system as top-level tasks.

---

## Concepts

### Parent task
A normal task that spawns one or more children.  It does not complete until
it explicitly calls `--done` on itself (or the agent calls `markDone()`).
Its `children` field in `status.json` lists every sub-task ID it created.

### Child task
A task whose ID is `<parentId>.c<N>` (e.g. `PLAN-3.c1`).  It has a
`parent_task` field pointing back.  Children can themselves spawn children,
creating an arbitrarily deep tree.

### Auto-notification
When **all** direct children of a parent settle (complete or failed), the
orchestrator automatically appends a `[CHILDREN COMPLETE]` or
`[CHILDREN FAILED]` note to the parent's note file.  The parent agent should
watch for this note and then call `--done` on itself.

---

## When to spawn children

Good candidates for child spawning:

- **Fan-out parallelism** — "analyse these 12 files" → spawn one child per file
- **Dynamic sub-problems** — agent discovers at runtime that N independent
  pieces of work exist (e.g. an API agent finds 5 unimplemented endpoints)
- **Specialisation** — a coordinator agent delegates to domain specialists it
  didn't know it would need until it read the codebase

Avoid spawning children for work that:
- Already exists as a sibling task in `status.json`
- Touches files owned by another agent (ownership rules still apply)
- Could be done inline in ~10 minutes

---

## Child task IDs

```
PLAN-3        ← parent
PLAN-3.c1     ← first child
PLAN-3.c2     ← second child
PLAN-3.c1.c1  ← grandchild (child of PLAN-3.c1)
```

The depth is unlimited but keep trees shallow (≤ 2 levels) in practice.

---

## API reference

### From within an agent (Node.js)

```js
const api = require('./.orch/agent-api');

// Spawn a child and get its ID
const childId = api.spawnChild('PLAN-3', {
  title:       'Extract schema from users.ts',
  agent:       'priya',
  outputFiles: ['analysis/users-schema.json'],
  dependsOn:   [],             // additional deps (beyond the parent itself)
  definitionOfDone: 'users-schema.json written with all field types',
});

// Check what's happening
console.log(api.getStatus(childId));

// Wait for all children to settle
const { allComplete, results } = await api.waitForChildren('PLAN-3');
if (!allComplete) throw new Error('Some children failed');

// Mark parent done
api.markDone('PLAN-3');
```

### From the CLI / shell script

```bash
# Spawn a child
node .orch/cli.js --spawn-child PLAN-3 \
  --title "Extract schema from users.ts" \
  --agent priya \
  --files "analysis/users-schema.json" \
  --adapter claude-code

# List children (with statuses)
node .orch/cli.js --children PLAN-3

# Block until all children settle (exits 0 = all done, 1 = some failed)
node .orch/cli.js --await-children PLAN-3 && node .orch/cli.js --done PLAN-3
```

### From the agent-api.js CLI

```bash
# Same as above but via the thin wrapper
node .orch/agent-api.js spawn-child PLAN-3 --title "..." --agent priya --files "a.js"
node .orch/agent-api.js children PLAN-3
node .orch/agent-api.js wait-children PLAN-3
```

---

## Adapter contract

**Adapters do not change.**  A child task is just a task — it goes through
the same `--spawn` → adapter `launch()` flow as any other task.

If you want a specific adapter for child tasks (e.g. always headless):

```js
api.spawnChild('PLAN-3', { ... }, { adapter: 'claude-code', headless: true });
```

Or on the CLI:

```bash
node .orch/cli.js --spawn-child PLAN-3 --title "..." --agent priya \
  --files "out.json" --adapter shell --headless true
```

### Writing a child-aware adapter

No changes required — but adapters can inspect `context.task.parent_task`
if they want to adjust their behaviour (e.g. a leaner prompt for children):

```js
launch(context) {
  const isChild = !!context.task.parent_task;
  const prompt  = isChild
    ? buildChildPrompt(context)
    : buildFullPrompt(context);
  // ...
}
```

---

## status.json shape

```json
{
  "PLAN-3": {
    "title": "Analyse codebase and spawn analysis tasks",
    "agent": "priya",
    "status": "in_progress",
    "children": ["PLAN-3.c1", "PLAN-3.c2"],
    "parent_task": null
  },
  "PLAN-3.c1": {
    "title": "Extract schema from users.ts",
    "agent": "priya",
    "status": "complete",
    "children": [],
    "parent_task": "PLAN-3"
  },
  "PLAN-3.c2": {
    "title": "Extract schema from orders.ts",
    "agent": "priya",
    "status": "in_progress",
    "children": [],
    "parent_task": "PLAN-3"
  }
}
```

---

## Ownership rules still apply

Children inherit no special permission from their parent.  Each child task
must list its own `output_files`.  If a child needs to write a file owned by
another agent, it must leave a note on that agent's task — same as any
sibling task would.

---

## Failure handling

If any child fails:
1. The orchestrator notes `[CHILDREN FAILED]` on the parent.
2. The parent agent reads the note and decides whether to retry, skip, or
   propagate the failure by calling `--fail PLAN-3 "child PLAN-3.c2 failed"`.
3. `--await-children` exits with code `1` when any child fails, so shell
   scripts can branch on it.
