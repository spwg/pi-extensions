# pi-extensions

Small extensions for the [pi coding agent](https://github.com/mariozechner/pi-coding-agent).

## Extensions

### `repo-boundary-guard.ts`

A safety extension that helps prevent accidental access outside the current Git repository.

It watches tool calls and user shell commands for paths that resolve outside the repo root. When it detects outside-repo access, it asks for confirmation in the pi UI. If no UI is available, it blocks the operation.

Covered operations include:

- pi file tools that use a `path` input, such as `read`, `write`, `edit`, `grep`, `find`, and `ls`
- `bash` tool calls
- user-initiated bash commands

The bash path detection is best-effort. It catches common cases like absolute paths, `~`, `~/...`, `..`, `../...`, and paths containing `/../`, but it is not a full shell sandbox.

## Usage

Copy or reference `repo-boundary-guard.ts` from your pi extension configuration.

Example extension export:

```ts
import repoBoundaryGuard from "./repo-boundary-guard";

export default repoBoundaryGuard;
```

Then enable the extension in your pi setup according to the pi extension documentation.

## Development

This repository currently contains standalone TypeScript extension files. There is no package manifest or build step yet.

When changing an extension:

1. Keep behavior conservative and explicit.
2. Prefer blocking or asking for confirmation over silently allowing risky access.
3. Test with commands that access both inside and outside the repository.

## License

No license has been added yet.
