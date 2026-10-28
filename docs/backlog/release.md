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

- [ ] REL-2 · Part 5: run the live checklist of `docs/plan/05-voice-worker.md` §10 with the keys in
      `~/.config/va/voice.env`: the worker started with `AGENT_NAME`, a call through the API,
      `pnpm --filter @va/voice bench 3` (record the figures in `docs/VOICE.md` → Measurements),
      `call-test ask` with a recorded take, and `call-test bargein` 20 tries each with
      `INTERRUPT_ON=vad` and `stt`. Check: the greeting is heard, a demo question is answered through
      `search_items`, the turn's rows are in `ai_messages`, and the `voice_calls` row is gone after
      the hang-up. No keys were available in the session that built Part 5.

## Resolved

Nothing yet.
