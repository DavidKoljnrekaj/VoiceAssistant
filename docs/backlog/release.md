# Backlog — release

Ids: REL-2 (next free)

Things written but not live: migrations to apply (dev first, with the check to run after), secrets
to set, and checks nobody has run. Tick an item when it is done on every environment it names.

## Open

- [ ] Part 1: create branch protection on `main` with `Tests` and `Database tests` as required
      checks, and enable Dependabot security updates (repository settings → Code security).
- [ ] REL-1 · Part 2: apply `20261028100000_users.sql`, `20261028100100_ai_sessions_and_messages.sql` and
      `20261028100200_voice_calls.sql` to the dev project `kdplqbldohrzsewhckgl` (`supabase link` then
      `supabase db push`, both run by the operator), enable pg_cron (Dashboard → Database → Extensions)
      and re-run the last DO block of the voice_calls migration so `voice-calls-sweep` is scheduled.
      Check after applying: `select jobname, schedule from cron.job` shows `voice-calls-sweep` every
      minute; sign up a user and see a `public.users` row appear; then `/db-types` and commit
      `packages/db/src/database.ts`. Also check whether `DB-1` reproduces on the project's image.

## Resolved

Nothing yet.
