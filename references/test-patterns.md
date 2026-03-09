# Test Task Patterns by Tech Stack

Every feature task gets a paired TEST-* task. The test task depends on the feature task.
A feature is not complete until its test is also done.

---

## Python / Django / FastAPI

**Pattern:** pytest + fixtures

Task spec template:
- Write tests in `tests/test_<module>.py`
- Use pytest fixtures for DB state — never rely on global state
- Test the happy path, one edge case, and one failure mode per function
- Run with: `pytest tests/test_<module>.py -v`
- DoD: all tests green, coverage > 80% for this module

---

## Node.js / Express

**Pattern:** Jest + supertest

Task spec template:
- Write tests in `__tests__/<module>.test.js`
- Use supertest for endpoint tests, jest.mock() for external calls
- Test: 200 happy path, 400 bad input, 401 unauth (if applicable), 404 not found
- Run with: `npm test -- --testPathPattern=<module>`
- DoD: all assertions pass, no console errors

---

## React / Next.js (Frontend)

**Pattern:** Vitest + React Testing Library (or Jest)

Task spec template:
- Write tests in `src/components/__tests__/<Component>.test.tsx`
- Test: renders without crashing, key user interactions, loading/error states
- Use `userEvent` for interactions, not `fireEvent`
- Run with: `npm test <Component>`
- DoD: component renders, interactions trigger correct state changes, no a11y violations

---

## Ruby on Rails

**Pattern:** RSpec + FactoryBot

Task spec template:
- Write specs in `spec/<type>/<name>_spec.rb`
- Use FactoryBot for test data, never raw ActiveRecord in specs
- Test: valid factory, validations, key scopes/methods, one request spec per endpoint
- Run with: `bundle exec rspec spec/<path>`
- DoD: all examples green, no pending examples

---

## Go

**Pattern:** Standard `testing` package + testify

Task spec template:
- Write tests in `<package>/<file>_test.go`
- Use table-driven tests for multiple input cases
- Mock interfaces, not concrete types
- Run with: `go test ./... -v -run TestFunctionName`
- DoD: all tests pass, race detector clean (`-race` flag)

---

## General Rules (all stacks)

- Test tasks depend on the feature task, not the other way around
- Never mock the thing you're testing — mock its dependencies
- One `TEST-*` task per feature task (don't batch unrelated features into one test task)
- The Definition of Done for any test task always includes: "CI passes"
- If a test task would take more than 2 hours, the feature task was too large — split both
