# o-pi-um

Personal Pi extension package.

## Extensions

- `skill-commands`: registers slash commands for hidden skills marked `disable-model-invocation: true`.
- `goal`: durable Goal loop with visible slice work orders, guarded resume, compact rollups, and status UI.
- `subagent`: tmux-backed child Pi sessions, parallel fan-out, follow-ups by `sessionFile`, and project model routes.
- `compaction`: routes native Pi compaction through the `.pi/MODELS.md` `Compaction` model.
- `footer`: compact TUI footer with context, parent usage, subagent usage, cache hit, cost, and model.
- `browser`: local browser automation with compact snapshots and element refs. Public params are `action`, `target`, and `text`.
- `web_search`: DuckDuckGo Lite search and URL reading with Markdown output, page structure modes, sections, and newline-separated multi-search/multi-fetch.

## Layout

```text
extensions/
  skill-commands/ hidden skill slash-command bridge
  goal/          goal loop, state, UI, accounting, prompt helpers
  subagent/      tmux-backed child sessions and model routing
  compaction/    routed model selection for native Pi compaction
  footer/        compact TUI footer including subagent usage totals
  browser/       Chrome/CDP and Zen/Firefox BiDi browser automation
  web-search/    DuckDuckGo Lite search, page fetching, parsing, formatting
  shared/        small shared primitives
skills/
  find-skills/   hidden skill command fixture
```

Each extension owns its tool schema, runtime behavior, and docs. Shared code should stay small and be used only when it removes real duplication.

## Development

```text
npm install
npm run check
npm run format
```

`npm run check` runs typecheck and format check.

## Hidden skill commands

`skill-commands` scans Pi skill locations, including package-local `skills/`, for skills with:

```yaml
disable-model-invocation: true
```

Those skills are hidden from automatic model invocation but become explicit slash commands named after the skill. Command arguments are appended to the injected skill turn as the user request.

## Review scope

Review package source and docs only:

```text
README.md
package.json
extensions/**
```

Exclude:

```text
node_modules
.git
package-lock.json
~/.pi/agent/subagent-sessions
```

Useful search pattern:

```text
rg --glob '!node_modules/**' --glob '!.git/**' <query>
```

## Extension docs

- Goal docs: `extensions/goal/docs/`
- Subagent docs: `extensions/subagent/docs/`
- Compaction docs: `extensions/compaction/README.md`
- Browser docs: `extensions/browser/docs/`
- Web search docs: `extensions/web-search/docs/`
