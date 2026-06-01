# Cursor Skills Index

This folder holds project-scoped skills for the Cursor agent. Skills are
organized by **lifecycle status**, not by topic:

```
.cursor/skills/
├── reusable/                       ← long-term engineering patterns referenced every PR
├── archived/                       ← one-time refactor migrations already completed
├── db-audit-execution-playbook/    ← active multi-PR migration (graduates to archived/ after Phase 7 soak)
├── progressive-target-scaffolding/ ← active scaffolding for domain extraction
└── <topic>/                        ← new task-focused skills land here, then graduate
```

## When the agent reads which folder

| Trigger | Folder to consult |
| --- | --- |
| "How should I structure / refactor / extract X?" | `reusable/` |
| "Is this pattern already established here?" | `reusable/` first, then `archived/` |
| "Why does the codebase look this way?" (history) | `archived/` |
| Active multi-PR task in flight | Top-level (graduates later) |

## Promotion rules

1. A new skill starts at the top level (`.cursor/skills/<name>/skill.md`).
2. After it has been used in at least two distinct tasks AND its guidance is
   stable, move it to `reusable/`.
3. After its one-time migration step is complete and the codebase already
   conforms (subsequent edits would be no-ops), move it to `archived/`.

Archived skills are **kept, not deleted** — they preserve the institutional
memory of *why* the codebase looks the way it does and help new agents avoid
reverting fixed problems.
