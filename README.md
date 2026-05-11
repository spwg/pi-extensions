# pi-extensions

Small extensions for the [pi coding agent](https://github.com/mariozechner/pi-coding-agent).

## Extensions

### `goal.ts`

A `/goal <objective>` command for objective mode. It keeps the agent working toward a terminal state until the assistant emits the exact completion token:

```text
</objective_complete>
```

Additional commands:

- `/goal status` — show the active goal
- `/goal stop` — cancel objective mode

While active, the extension injects objective-mode instructions each turn and queues a follow-up prompt when the completion token is absent.

## Usage

Enable these files from your global pi settings, for example:

```json
{
  "extensions": [
    "/Users/spencergreene/github/pi-extensions/goal.ts"
  ]
}
```

Then run `/reload` in an existing pi session.

## Development

This repository contains standalone TypeScript extension files with a typecheck script.

When changing an extension:

1. Keep behavior conservative and explicit.
2. Run `npm run typecheck`.

## License

No license has been added yet.
