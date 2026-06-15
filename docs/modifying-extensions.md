# Modifying extensions

Keep extensions small, explicit, and easy for models to use.

## Principles

- Prefer tiny public schemas.
- Prefer local defaults over model-controlled knobs.
- Keep extension ownership clear.
- Share code only when it removes real duplication.
- Keep docs current with the code; do not document old behavior.

## Boundaries

```text
goal        goal lifecycle, state, UI, accounting
subagent    child Pi sessions, model routing, child usage
browser     local browser automation
web_search  search, fetch, parse, Markdown formatting
shared      small cross-extension primitives
```

Do not move behavior into `shared/` unless at least two extensions need the same primitive.

## Public APIs

Model-facing schemas should expose intent, not implementation details.

Good:

```text
action, target, text
query, url, mode, section
task, tasks, sessionFile, options
```

Avoid:

```text
timeouts, ports, tab ids, max chars, internal selectors, process flags
```

## Change workflow

1. Read the owning extension files and docs.
2. Make the smallest coherent change.
3. Update docs for current behavior.
4. Run checks.

```text
npm run check
```

## Review scope

Review source and docs only:

```text
README.md
package.json
docs/**
extensions/**
```

Exclude generated or external files:

```text
node_modules
.git
package-lock.json
~/.pi/agent/subagent-sessions
```

## Extension docs

- `extensions/goal/docs/`
- `extensions/subagent/docs/`
- `extensions/browser/docs/`
- `extensions/web-search/docs/`
