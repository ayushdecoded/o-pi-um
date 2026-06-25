# o-pi-um

Personal Pi package.

## Extensions

- `goal`: durable Goal loop with visible slice work orders, guarded resume, compact rollups, and status UI.
- `subagent`: tmux-backed child Pi sessions, parallel fan-out, follow-ups by `sessionFile`, and project model routes.
- `compaction`: routes native Pi compaction through the `.pi/MODELS.md` `Compaction` model.
- `footer`: compact TUI footer with context, parent usage, subagent usage, cache hit, cost, and model.
- `browser`: local browser automation with compact snapshots and element refs. Public params are `action`, `target`, and `text`.
- `web_search`: DuckDuckGo Lite search and URL reading with Markdown output, page structure modes, sections, and newline-separated multi-search/multi-fetch.

## Layout

```text
extensions/
  goal/          goal loop, state, UI, accounting, prompt helpers
  subagent/      tmux-backed child sessions and model routing
  compaction/    routed model selection for native Pi compaction
  footer/        compact TUI footer including subagent usage totals
  browser/       Chrome/CDP and Zen/Firefox BiDi browser automation
  web-search/    DuckDuckGo Lite search, page fetching, parsing, formatting
  shared/        small shared primitives
skills/
  find-skills/   hidden native Pi skill command
```

Each extension owns its tool schema, runtime behavior, and docs. Package skills are loaded through Pi's native skill system. Shared code should stay small and be used only when it removes real duplication.

## Development

```text
npm install
npm run check
npm run format
```

`npm run check` runs typecheck and format check.

## Hidden skills

Package skills are declared in `package.json` and loaded by Pi's native skill system. Skills marked:

```yaml
disable-model-invocation: true
```

are hidden from automatic model invocation but remain explicitly callable through native `/skill:<name>` commands, for example `/skill:find-skills`.

## Review scope

Review package source and docs only:

```text
README.md
package.json
extensions/**
skills/**
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
