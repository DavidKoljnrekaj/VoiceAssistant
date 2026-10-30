---
name: done
description: Run before saying a change is finished, ready to commit, or ready for review — verifies it (typecheck for the affected packages, unit tests, lint on changed files, pgTAP when supabase/ changed) and walks the project's housekeeping (tests, docs, migrations, i18n, backlog, Croatian review marks).
---

# Done check

Changed so far:

!`git status --short`

!`git diff --stat HEAD`

## 1. Verify

Run these and fix what fails. Report failures with their output; never call the work done while
one is red.

- `pnpm --filter ./<pkg> typecheck` for every package with changed files (or `pnpm typecheck`)
- `pnpm test`
- `pnpm exec eslint <changed .ts/.tsx/.js files>`
- `supabase/**` changed: `pnpm test:db` after `supabase start`, if Docker is available. If it is
  not, say so in the report and leave the pgTAP run for the user
- A screen changed: look at it running if you can (`/run`); otherwise say it was not seen
- A hot-path voice change: `/bench-voice` before and after, numbers in `docs/VOICE.md`

## 2. Housekeeping — check each that applies to the diff

- **Regression test:** a fix for a backlog id has a test named after the id (`it('CORE-12: …')`)
  that asserts what the user sees — the wire event, the row, the refusal — not an intermediate
  value, and that **failed before the fix**. Say in the report that you saw it fail
- **Changed tests:** every existing assertion that was removed, loosened or re-pointed is listed in
  the report with the reason. "It was failing" is not a reason. `git diff -- '*.test.ts'` shows them
- **Mutations:** every service-role write filters by `user_id` / `session_id`; nothing logs message
  content
- **Strings:** new UI text is in both `apps/web/src/locales/hr` and `en`; ambiguous translations
  were asked about, not guessed
- **Croatian user-facing text** (prompts, greeting, filler, error messages) is marked
  `<!-- needs native review -->` until reviewed; list what is still marked
- **Docs:** the package's `docs/<PACKAGE>.md` reflects the change; `docs/ARCHITECTURE.md` if the
  layout or a dependency edge changed; `docs/API.md` if an event or endpoint changed
- **Migrations:** written, not applied; each listed as an unticked "Apply …" item in
  `docs/backlog/release.md` with the check to run after applying
- **Allowlist:** a tool added to `VOICE_ALLOWLIST` (`apps/voice/src/tools.ts`) has the reason in the commit message
- **Backlog:** anything found and not fixed has an entry (`/backlog`); anything fixed is closed

## 3. Report

One short list: what was verified and how, what was skipped and why, and any backlog ids added or
closed.
