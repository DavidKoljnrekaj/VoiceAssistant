---
name: db-types
description: Regenerate packages/db/src/database.ts from the linked Supabase project, naming the linked project first and waiting for a yes.
disable-model-invocation: true
---

# Regenerate database types

Linked project ref: !`cat supabase/.temp/project-ref 2>/dev/null || echo "not linked"`

1. **Name the linked project to the user and wait for a yes.** The link may be left on the wrong
   project, and the production ref must never be the linked one during development. Ask which
   project the types should come from if the user has not said. Never re-link without being asked.
2. Run `pnpm db:types`. It writes `packages/db/src/database.ts`.
3. `git diff --stat packages/db/src/database.ts`, then `pnpm typecheck`.
4. Summarise what changed in `public`: tables, columns, functions added or removed, and which
   packages the typecheck flagged.
