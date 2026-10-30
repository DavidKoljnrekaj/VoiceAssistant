# Hooks

Node ESM scripts wired in `.claude/settings.json`. Each reads the hook's JSON on stdin. Exit 0
allows; a printed `hookSpecificOutput` carries a decision; exit 2 with stderr blocks a Stop and
hands the text back to the session. Why they exist: rules describe mistakes, hooks catch the ones
rules cannot (a removed assertion, a red typecheck at the end of a turn, unformatted code).

| Hook                  | Event                             | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `guard-tests.mjs`     | PreToolUse `Edit\|Write`          | When an edit to an existing `*.test.ts(x)`, `*.spec.ts(x)` or `supabase/tests/**/*.sql` removes or rewrites an assertion line, or adds `.skip` / `.only` / `.todo`, it returns `permissionDecision: "ask"` with the removed lines quoted. Additions pass silently.                                                                                                                                                                                           |
| `stop-verify.mjs`     | Stop                              | Collects changed `.ts/.tsx` files under `apps/*` and `packages/*` (tracked diff plus untracked), runs `pnpm --filter ./<pkg> typecheck` for each affected package and `pnpm exec vitest related --run <files>` from the root. On failure it exits 2 with the last 60 lines so the session fixes it. Blocks once per turn (`stop_hook_active`). A green run is stamped by hash in `node_modules/.cache/stop-verify`, so an unchanged tree is not re-verified. |
| `format.mjs`          | PostToolUse `Edit\|Write` (async) | Runs `pnpm exec prettier --write` on the edited file if it is inside the project and has a `.ts/.tsx/.js/.mjs/.json/.md/.yml` extension. Never fails.                                                                                                                                                                                                                                                                                                        |
| `session-context.mjs` | SessionStart (once)               | Prints the branch, Node / pnpm / Supabase CLI versions, whether each app has `.env` files (names only), and the linked Supabase project ref if any, with the reminder that it must never be the production ref.                                                                                                                                                                                                                                              |

## Running one by hand

Each hook takes the same JSON Claude Code sends:

```sh
echo '{"tool_name":"Edit","tool_input":{"file_path":"'$PWD'/packages/core/src/index.test.ts","old_string":"expect(a)","new_string":""}}' \
  | CLAUDE_PROJECT_DIR=$PWD node .claude/hooks/guard-tests.mjs
echo '{}' | CLAUDE_PROJECT_DIR=$PWD node .claude/hooks/stop-verify.mjs; echo "exit $?"
```

## Disabling locally

Create `.claude/settings.local.json` (git-ignored) with `{ "disableAllHooks": true }` to switch
every hook off for your machine, or override a single event with an empty list, for example
`{ "hooks": { "Stop": [] } }`. Hook configuration is read at session start; restart the session
after changing it.
