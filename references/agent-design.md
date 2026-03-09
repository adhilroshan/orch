# Agent Design Reference

Examples of good agent splits across different project types.

---

## Web App (Full-Stack)

**Django + React / Node + React:**
| Agent | Owns |
|---|---|
| `api` | Models, views/routes, serializers/controllers, URLs, business logic |
| `ml` | Algorithms, ML models, scoring engines, async tasks (if applicable) |
| `ui` | All frontend — components, pages, routing, API service layer |
| `infra` | Migrations, Docker, env config, CI, seed commands, deployment |

**Rule:** Split `api` further by domain when the backend has distinct concern areas
(e.g. `api-core` for users/content, `api-engine` for ML/algorithms).
Split when one backend agent would own 20+ tasks.

---

## CLI Tool / Library

| Agent | Owns |
|---|---|
| `core` | Core logic, data structures, algorithms |
| `io` | Parsers, formatters, file readers/writers, adapters |
| `cli` | CLI interface, argument parsing, output formatting |
| `infra` | Packaging, CI, test fixtures, benchmarks |

---

## Mobile App

| Agent | Owns |
|---|---|
| `backend` | API server, auth, database, business logic |
| `mobile` | Screens, components, navigation, local state |
| `infra` | CI/CD, env config, build scripts |

---

## Microservices

Each service is one agent's domain. A platform agent owns shared infrastructure.

| Agent | Owns |
|---|---|
| `service-auth` | All files in /services/auth/ |
| `service-api` | All files in /services/api/ |
| `service-worker` | All files in /services/worker/ |
| `platform` | Docker Compose, Kubernetes configs, shared libs, CI |

---

## Data / ML Pipeline

| Agent | Owns |
|---|---|
| `ingest` | Data loaders, connectors, raw storage, schema validation |
| `transform` | Feature engineering, cleaning, aggregation logic |
| `model` | Training scripts, evaluation, model artifacts, experiment tracking |
| `serve` | Inference API, caching layer, monitoring hooks |
| `infra` | Orchestration (Airflow/Prefect), Docker, CI, env config |

---

## Agent Personality Examples

Personalities tell an AI agent *how* to work, not just *what* to work on.
Include: working style, communication habit, quality bar.

```
"sara": "Sara Kim — Core API. Methodical and precise. Documents every public
function. Always leaves a note when changing a shared interface."

"james": "James Torres — ML Engineer. Experiments quickly then cleans up.
Writes detailed comments on algorithm decisions. Checks with teammates
before changing model schemas."

"nina": "Nina Osei — Frontend. Strong accessibility instincts. Never ships
without testing keyboard navigation and mobile layout.
Flags backend API inconsistencies immediately."

"raj": "Raj Patel — Infra. Pragmatic and direct. Fixes broken configs without
being asked. Communicates clearly when a task is unblocked so others can proceed."
```

---

## File Ownership Rules

One owner per file, always. If a task needs to touch another agent's file:

Write in the task spec:
"Leave a note on [agent]'s task [ID] describing exactly what you need changed.
Do not edit the file directly."

**Split signals:** If you find yourself writing "both agents edit X" — stop.
Split the file by function, or extract a shared interface file owned by one agent.
