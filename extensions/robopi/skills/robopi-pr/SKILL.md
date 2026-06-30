---
name: robopi-pr
description: Use when a RoboPi handoff needs a GitHub pull-request summary, publish checklist, or reviewer context.
---

# RoboPi PR Skill

Use this skill when preparing RoboPi work for publication.

## PR preparation

- Summarize the user-visible intent and final contract.
- List the main implementation changes by area, not by commit chatter.
- Include validation evidence: commands run, tests passed/failed, screenshots, manual checks.
- Call out risks, follow-up work, and anything reviewers should inspect closely.
- Do not claim a PR exists until the publish command/tooling actually creates one.

## Suggested PR body

```markdown
## Summary

- ...

## Validation

- [ ] `command`
- [ ] screenshot/manual check

## Reviewer notes

- ...
```
