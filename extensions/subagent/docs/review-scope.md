# Review scope

Review package source and docs only.

Include:

```text
README.md
extensions/**
package.json
```

Exclude:

```text
node_modules
.git
package-lock.json
~/.pi/agent/subagent-sessions
```

Use `rg --glob '!node_modules/**' --glob '!.git/**'` for text searches.
