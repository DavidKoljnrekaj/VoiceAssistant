# Backlog — core

Ids: CORE-3 (next free)

The engine (`packages/core`): loop, tools, prompts, history, sinks, fakes.

## Open

### CORE-1 · Medium · Croatian text in the engine has not had a native review

- **Check:** Confirmed (every file is marked)
- **Where:** `packages/core/src/errors.ts` (`MESSAGES_HR`), `packages/core/src/prompts/*.hr.ts`,
  `buildUserContext` in `packages/core/src/prompts/index.ts`; later the filler and refusal line of
  the spoken sink (3c)
- **What happens:** users read and hear placeholder Croatian written by the port, not by a native
  speaker; the voice prompt is Landmark's with the product name and role names swapped
- **Fix direction:** a native speaker reads every `<!-- needs native review -->` block, the marks
  are removed in one commit, and the voice bench is re-run because a prompt change moves the cache
  key

### CORE-2 · Low · `demo_items` and `demo_notes` exist only in the fakes

- **Check:** Confirmed
- **Where:** `packages/core/src/test/fixtures.ts` seeds them; `packages/tools-demo/src/demo-db.ts`
  types them by hand and narrows `ctx.userClient` to that shape
- **What happens:** the demo pack cannot run against the local stack or the dev project, only
  against the fakes. The decision the plan left open (a migration for the dev project, or fakes
  only) is taken as fakes only for the skeleton
- **Fix direction:** if a demo against a real database is wanted, write the two tables with
  `/new-migration`, regenerate types with `/db-types`, and delete `demo-db.ts`. The migration must
  enforce what the handlers assume: `demo_items` RLS on, SELECT `TO authenticated USING (true)`
  (a company-wide catalogue; say so in the table comment), no write grant; `demo_notes` RLS on,
  INSERT `WITH CHECK (user_id = public.app_user_id())` and SELECT `USING (user_id =
public.app_user_id())` (the insert returns a representation, which needs the SELECT policy),
  no UPDATE or DELETE; pgTAP as admin and member. A real pack never needs the cast: its tables
  are in the generated `Database`

## Resolved

Nothing yet.
