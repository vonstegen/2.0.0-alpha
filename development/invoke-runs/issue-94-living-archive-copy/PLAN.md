# Plan: Living Archive Human-First Copy

## Work Units

1. Update Living Archive Start tab copy.
2. Update library importer optional-Obsidian wording.
3. Update Help tab copy.
4. Update Settings Memory bridge copy.
5. Update first-run onboarding copy.
6. Update Living Archive manifest description used by recommended add-on onboarding.
7. Add regression tests in `src/App.test.tsx`.
8. Run focused App tests.
9. Run build and full test suite.
10. Commit, push, and open a PR linked to issue 94.

## Constraints

- Keep changes scoped to copy and tests.
- Preserve existing UI routes and runtime behavior.
- Do not require Obsidian or change add-on grant semantics.
- Record the project status mutation blocker caused by missing GitHub `project` scope.

## Verification Plan

- `npm test -- --run src/App.test.tsx`
- `npm run build`
- `npm test -- --run`
