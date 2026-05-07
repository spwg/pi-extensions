# Agent Instructions

These instructions apply to this repository.

## Repository purpose

This repo contains pi coding agent extensions. Current extension:

- `repo-boundary-guard.ts` — prompts before tool calls or shell commands access paths outside the current Git repository.

## Working guidelines

- Keep extension code small, readable, and dependency-light.
- Treat filesystem safety checks conservatively.
- Do not broaden access without an explicit approval path.
- Remember that shell parsing in `repo-boundary-guard.ts` is best-effort, not a sandbox.
- Prefer clear user-facing block/approval messages that include the original path, resolved path, command, and repo root when useful.

## Code style

- TypeScript.
- Use tabs for indentation, matching the existing file.
- Prefer Node built-ins over new dependencies.
- Keep helper functions focused and testable.

## Validation

There is currently no package manifest or automated test suite. After edits, validate with at least:

```bash
git diff --check
git status --short
```

If a TypeScript project setup is added later, also run the relevant typecheck/test commands and update this file.

## Git hygiene

- Do not commit unless the user asks.
- Keep changes focused on the requested task.
- Avoid adding generated files or local machine artifacts.
