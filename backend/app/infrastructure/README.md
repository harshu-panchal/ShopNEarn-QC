# `app/infrastructure/`

Canonical home for pure infrastructure services — code that wraps a third-party
SDK or a managed runtime concern (cache, email, push, maps, media, sms, search,
queue). These are intentionally kept separate from `app/services/` (which is
reserved for domain services) and `app/controller/` (HTTP adapters).

## Current state — forward-compat shim phase

Each file in this directory is a one-line re-export forwarding to the original
location under `app/services/`. This was introduced as part of refactor Phase
2.5 to establish the namespace without moving file content. The current import
graph is:

```
domain code → app/infrastructure/<category>/<file>.js
                    ↓ re-exports
              app/services/<file>.js   (actual implementation)
```

## Migration plan (Phase 5)

Phase 5 will flip the direction: the implementation lives here, and the legacy
path under `app/services/<file>.js` becomes the shim. The flip is reversible by
swapping which file holds the implementation and which is the re-export.

## When adding a new infra wrapper

Put the actual implementation here (e.g. `app/infrastructure/queue/myQueue.js`)
and import from `app/infrastructure/...` directly. Do not place new infra code
under `app/services/`.
