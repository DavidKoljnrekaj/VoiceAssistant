# Backlog — release

Ids: REL-3 (next free)

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

## Resolved

Nothing yet.
