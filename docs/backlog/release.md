# Backlog — release

Ids: REL-5 (next free)

Things written but not live: migrations to apply (dev first, with the check to run after), secrets
to set, and checks nobody has run. Tick an item when it is done on every environment it names.

## Open

- [ ] Part 1: create branch protection on `main` with the Actions job checks `test` and `db` as required
      checks, and enable Dependabot security updates (repository settings → Code security).
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

- [ ] REL-3 · Part 6: a Lighthouse "installable" audit of the built PWA (the `build` then
      `preview` scripts of `@va/web`, or the deployed HTTPS origin) and a DevTools check
      that Cache Storage holds only the precached shell after a streamed turn. The build was
      inspected on 2026-10-29 (manifest, `sw.js` with `NetworkOnly` for both backend origins);
      the audit itself was not run.

- [ ] REL-4 · Part 6: a voice call from the PWA's call button with the worker running
      (`docs/VOICE.md` → Running locally): the agent is heard, the "Poziv u tijeku" banner shows,
      mute and hang-up work, and `voice_calls` loses its row on hang-up. Not run on 2026-10-29
      (the worker was not started in the session that built the button).

## Resolved

Nothing yet.
