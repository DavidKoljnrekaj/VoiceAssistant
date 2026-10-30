# Backlog — release

Ids: REL-7 (next free)

Things written but not live: migrations to apply (dev first, with the check to run after), secrets
to set, and checks nobody has run. Tick an item when it is done on every environment it names.

## Open

- [ ] Part 1 / Part 7: create branch protection on `main` with the Actions job checks `test`, `db`,
      `docker (api)`, `docker (voice)` and `docker (web)` as required checks, and enable Dependabot
      security updates (repository settings → Code security). `e2e` stays optional.
- [ ] REL-1 · Part 2: apply `20261028100000_users.sql`, `20261028100100_ai_sessions_and_messages.sql` and
      `20261028100200_voice_calls.sql` to the dev project `kdplqbldohrzsewhckgl` (`supabase link` then
      `supabase db push`, both run by the operator), enable pg_cron (Dashboard → Database → Extensions)
      and re-run the last DO block of the voice_calls migration so `voice-calls-sweep` is scheduled.
      Check after applying: `select jobname, schedule from cron.job` shows `voice-calls-sweep` every
      minute; sign up a user and see a `public.users` row appear; then `/db-types` and commit
      `packages/db/src/database.ts`. Also check whether `DB-1` reproduces on the project's image.

- [x] REL-2 · Part 5: the live checklist of `docs/plan/05-voice-worker.md` §10 ran on 2026-10-29
      (`docs/VOICE.md` → The live checklist): worker, greeting, answers, rows, hang-up, bench and
      latency all verified; barge-in 7/7 in `vad` mode and 5/5 (slower) in `stt`, short of the
      20-try count. Still open: the full 20 tries once a take reliably provokes a long answer, and
      the bench against a database that has the demo tables (`CORE-2`).

- [ ] REL-3 · Part 5: apply `20261029100000_demo_tables.sql` to the dev project (after `REL-1`, by the
      operator), then `/db-types`, commit `packages/db/src/database.ts`, and drop the `DemoDatabase`
      cast in `packages/tools-demo/src/demo-db.ts`. Check after applying: as a signed-in user
      `select count(*) from demo_items` works and an insert is refused; the dev project has no demo
      rows until someone loads them (the seed is local only).

- [ ] REL-4 · Part 6: a Lighthouse "installable" audit of the built PWA (the `build` then
      `preview` scripts of `@va/web`, or the deployed HTTPS origin) and a DevTools check
      that Cache Storage holds only the precached shell after a streamed turn. The build was
      inspected on 2026-10-29 (manifest, `sw.js` with `NetworkOnly` for both backend origins);
      the audit itself was not run.

- [ ] REL-5 · Part 6: a voice call from the PWA's call button with the worker running
      (`docs/VOICE.md` → Running locally): the agent is heard, the "Poziv u tijeku" banner shows,
      mute and hang-up work, and `voice_calls` loses its row on hang-up. Not run on 2026-10-29
      (the worker was not started in the session that built the button).

- [ ] REL-6 · Part 7: the operations pieces nobody has run. (a) `compose.dev.yml`: `supabase start`,
      export `SUPABASE_ANON_KEY`, put `api.env` and `voice.env` in `~/.config/va/`, then
      `docker compose -f compose.dev.yml up --build api web`; check `curl localhost:3000/health`
      and a sign-in at `http://127.0.0.1:8080`. (b) Done locally on 2026-10-29: the three images build, the web image serves the
      shell with the caching rules, the api and voice images fail fast naming the missing
      variables and the api image answers `/health`; watch the first `docker (*)` CI jobs on this
      branch's pull request. (c) The repository secrets for
      `e2e.yml` (`E2E_SUPABASE_URL` = the dev project URL, `E2E_SUPABASE_ANON_KEY`,
      `E2E_ALLOWED_SUPABASE_URL` = the same URL, optional `E2E_API_URL`, `E2E_EMAIL`, `E2E_PASSWORD`
      for a test user created on the dev project after `REL-1`), then one manual run of the
      workflow (`OPS-6`). (d) Diff each `apps/*/.env.example` against the matrix in `docs/OPS.md`:
      the session that wrote the matrix could not read the example files (the harness denies
      `.env*`), so a stale comment or a missing name there is possible; `X01`–`X03` only check the
      matrix against the code. (e) `apps/web/.env.example` is a one-line placeholder with no
      variables (review R-O3): write it by hand with `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
      and `VITE_API_URL`, a one-line comment each and no values; the triage session of 2026-10-30
      could not, the deny covers writes too.

## Resolved

Nothing yet.
