# Archived Skills

These skills documented **one-time migrations** that have already been
applied to this codebase. They are kept (not deleted) because:

1. They explain **why** the code currently looks the way it does.
2. They give the agent a reference if an edit accidentally regresses one
   of the fixed patterns (e.g., someone re-introducing `console.log`).
3. They serve as a template if the same fix becomes relevant in a related
   project.

Do **not** invoke an archived skill to do new feature work — its execution
checklist has already run. Read it only for context.

| Skill | What it migrated | Completion marker |
| --- | --- | --- |
| `route-mounting-hygiene/` | Cleaned up `routes/index.js` duplicate mounts and `/`-root pollution. | `routes/index.js` has comments around `/categories` vs `/admin/categories` and prefixes (`/offers`, `/experience`, `/coupons`) are explicit. (Refactor P1.4) |
| `structured-logging-migration/` | Replaced ad-hoc `console.*` and `JSON.stringify({level:'info'…})` with the shared `logger.js` across controllers + key services. | `orderController.js`, `paymentService.js`, etc. import `logger from "../services/logger.js"`. (Refactor P1.3) |
| `frontend-auth-role-store/` | Replaced duplicate `window.location.pathname` role checks in `axios.js` and `AuthContext.jsx` with a single in-memory `activeRoleStore`. | `frontend/src/core/auth/activeRoleStore.js` exists and is consumed by axios + AuthContext. (Refactor P4.1) |

## When to "un-archive"

If a code review surfaces a NEW occurrence of the pattern these skills
originally targeted (e.g., a new `console.log` slipped in, or a new module
mounts a router at `/`), the agent should:

1. Fix the local regression using guidance from the archived skill.
2. **Do not** move the skill back to `reusable/`. The one-time migration
   stays archived; ongoing enforcement belongs in code review and CI,
   not in a skill that the agent re-runs.
