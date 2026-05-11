# Agent Instructions

These instructions apply to this repository.

## Repository purpose

This repo contains pi coding agent extensions. Current extensions:

- `goal.ts` — adds `/goal <objective>` objective mode, looping until the assistant emits `</objective_complete>`.

## Working guidelines

- Keep extension code small, readable, and dependency-light.
- For `goal.ts`, keep the completion-token contract explicit and avoid hidden infinite loops without user-visible state.

## Code style

- TypeScript.
- Use tabs for indentation, matching the existing file.
- Prefer Node built-ins over new dependencies.
- Keep helper functions focused and testable.

## Validation

After edits, validate with at least:

```bash
npm run typecheck
git diff --check
git status --short
```

## Git hygiene

- Do not commit unless the user asks.
- Keep changes focused on the requested task.
- Avoid adding generated files or local machine artifacts.
