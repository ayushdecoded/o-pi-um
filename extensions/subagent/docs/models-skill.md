---
name: model-routing-setup
disableModelInvocation: true
description: Draft a concise .pi/MODELS.md model routing file for this project after inspecting available models and project needs.
allowed-tools:
  - "web_search"
  - "Read"
  - "Write"
---

# Model Routing Setup

Draft `.pi/MODELS.md` for the current project. Keep it minimal and valid.

## Rules

- Inspect available authenticated models and the project shape before proposing choices.
- Prefer already-authenticated models unless there is a clear reason to suggest another.
- Use one `model:` and one `thinking:` line per section.
- Optional fallback fields are allowed when useful: `secondary_model:` and `secondary_thinking:`.
- Show the draft and get user confirmation before writing.
- If an existing file is present, do not overwrite without confirmation.

## Required sections

Use exactly these headings:

- `Planning`
- `Complex coding`
- `Medium coding`
- `Exploration`
- `Quick edits`
- `Design`
- `Compaction`

Valid thinking values: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`.
