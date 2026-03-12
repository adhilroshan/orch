# Example TASKS.md
# TaskFlow API — Example Task Breakdown
# 3 agents: api, ui, infra | 2 phases

## Agent Identities
| Key | Full Name | Role | Personality |
|---|---|---|---|
| `api` | Sara Kim | Core API Engineer | Methodical and precise. Documents every public function. Always leaves a note confirming interface shapes before downstream agents consume them. |
| `ui` | Nina Osei | Frontend Engineer | Strong accessibility instincts. Never ships without testing keyboard nav and mobile layout. Flags API inconsistencies by leaving a note on the upstream task. |
| `infra` | Raj Patel | Infra & DevOps | Pragmatic and direct. Fixes broken configs without being asked. Leaves a clear note when a dependency is unblocked so other agents can proceed. |

---

## INFRA-1: Scaffold project structure and Docker environment
**Agent:** infra
**Phase:** 1
**Depends on:** none
**Output files:** `docker-compose.yml`, `Dockerfile`, `.env.example`, `requirements.txt`
**Definition of Done:** `docker compose up` starts all services with no errors; `.env.example` documents every required variable.

Set up Docker Compose with three services: postgres, redis, api.
Use Python 3.12 slim base image. Mount src/ as a volume for hot reload.
Include a health check for postgres. Create `.env.example` with all vars commented.

---

## INFRA-2: Database migrations and seed data
**Agent:** infra
**Phase:** 1
**Depends on:** INFRA-1
**Output files:** `migrations/001_initial.sql`, `scripts/seed.py`
**Definition of Done:** `python scripts/seed.py` runs without errors and populates users + tasks tables.

Create initial migration: users table (id, email, hashed_password, created_at),
tasks table (id, user_id, title, status, priority, created_at, completed_at).
Seed script creates 2 test users and 5 tasks each.

---

## API-1: User authentication endpoints
**Agent:** api
**Phase:** 1
**Depends on:** none
**Output files:** `src/routes/auth.py`, `src/models/user.py`, `src/utils/jwt.py`
**Definition of Done:** POST /auth/register and POST /auth/login return correct tokens; invalid credentials return 401.

Implement register (email + password), login (returns JWT), and /me (returns current user).
Use bcrypt for password hashing, PyJWT for tokens. Token expiry: 24h.
NOTE: infra agent is setting up DB in parallel — use SQLite for local dev until INFRA-2 is done.

---

## TEST-API-1: Tests for authentication endpoints
**Agent:** api
**Phase:** 1
**Depends on:** API-1
**Output files:** `tests/test_auth.py`
**Definition of Done:** All tests pass with `pytest tests/test_auth.py -v`; covers register, login, /me, and 401 cases.

Test happy path for each endpoint plus: duplicate email on register (409),
wrong password (401), expired token (401), missing token (401).
Use pytest fixtures for test DB — never hit production DB.

---

## API-2: Task CRUD endpoints
**Agent:** api
**Phase:** 1
**Depends on:** API-1, INFRA-2
**Output files:** `src/routes/tasks.py`, `src/models/task.py`
**Definition of Done:** All 5 endpoints return correct status codes and response shapes per API contract.

Implement: GET /tasks, POST /tasks, GET /tasks/:id, PATCH /tasks/:id, DELETE /tasks/:id.
All endpoints require auth. Tasks are scoped to the authenticated user.
PATCH accepts partial updates (title, status, priority). DELETE returns 204.
When schema is finalised, run: `node .orch/cli.js --note API-2 "Schema final: {id, title, status, priority, user_id, created_at}. UI-2 can switch from mocks."`

---

## UI-1: Mock API for frontend development
**Agent:** ui
**Phase:** 1
**Depends on:** none
**Output files:** `frontend/src/mocks/handlers.ts`, `frontend/src/mocks/browser.ts`
**Definition of Done:** All planned API endpoints are mocked using msw; mock server starts with `npm run dev`.

Use msw to mock: auth endpoints (register, login, /me) and task CRUD.
Return realistic data shapes — match the field names API-1 will use.
This unblocks all frontend work before the real API is ready.

---

## UI-2: Task list and detail views
**Agent:** ui
**Phase:** 2
**Depends on:** UI-1, API-2
**Output files:** `frontend/src/pages/TaskList.tsx`, `frontend/src/pages/TaskDetail.tsx`, `frontend/src/api/tasks.ts`
**Definition of Done:** Task list renders, clicking a task opens detail, edit saves successfully — all against real API.

NOTE: Run `node .orch/cli.js --show API-2` before switching from mocks to real API
calls — Sara's note on API-2 will confirm the final response schema when it's ready.
Implement optimistic updates on status change. Show loading and error states.

---

## TEST-UI-2: Tests for task list and detail views
**Agent:** ui
**Phase:** 2
**Depends on:** UI-2
**Output files:** `frontend/src/pages/__tests__/TaskList.test.tsx`
**Definition of Done:** All tests pass with `npm test TaskList`; covers render, click-through, and error state.

Use React Testing Library + msw for API mocking in tests.
Test: list renders tasks, clicking opens detail, status toggle updates UI,
API error shows error message, empty state renders correctly.
