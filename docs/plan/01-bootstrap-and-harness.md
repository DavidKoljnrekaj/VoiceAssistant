# Part 1 — Repository bootstrap and the Claude Code harness

## Prompt for the session

```
You are bootstrapping a new TypeScript monorepo for an AI voice assistant. The two documents below
are the project brief (Part 0) and the specification for this part (Part 1). Read both fully, then:

1. Restate the deliverables and the acceptance checklist in your own words and ask me only about
   things the spec leaves open (for example the package scope name).
2. Initialise the repository and implement Part 1 exactly as specified: workspace, tooling,
   empty packages with one smoke test each, CLAUDE.md, .claude/ (settings, rules, hooks, skills,
   agents), CI workflows, and the docs skeleton including docs/plan/ with these two documents.
3. Prove the harness works: show the Stop hook blocking a red typecheck, the test-guard hook
   asking before an assertion is removed, and the format hook running Prettier.
4. Commit in small conventional commits on main (this is the first commit series), then report.

Do not add any product code. Do not install Supabase, LiveKit or React dependencies yet beyond
what an empty package needs to typecheck and run one test.
```

## Goal

A repository where a fresh Claude Code session can run the tests first try, where the project's
rules load only when relevant, where the hooks catch the mistakes rules cannot, and where every
later part has a place to land.

## Deliverables

```
.git (branch main)             .gitignore  .editorconfig  .node-version  .npmrc
package.json  pnpm-workspace.yaml  tsconfig.base.json  eslint.config.js  .prettierrc  vitest.workspace.ts
packages/core  packages/db  packages/tools-demo  apps/api  apps/voice  apps/web   (each: package.json, tsconfig.json, src/index.ts, src/index.test.ts)
CLAUDE.md
.claude/settings.json
.claude/rules/{architecture,engine,tools,api,voice,web,db,testing,prompts,i18n}.md
.claude/hooks/{guard-tests,stop-verify,format,session-context}.mjs
.claude/skills/{done,new-migration,db-types,backlog,new-tool,bench-voice}/SKILL.md
.claude/agents/{convention-reviewer,tool-security-reviewer}.md
.github/workflows/{test,db-tests}.yml  .github/dependabot.yml
.vscode/settings.json  .vscode/extensions.json
docs/{ARCHITECTURE,CORE,API,VOICE,WEB,TESTING}.md  docs/decisions/  docs/backlog/  docs/plan/
```

## Specification

### 1. Repository and workspace

- `git init -b main`. First commit: the workspace files only.
- `.node-version` → `24`. `.npmrc` → `engine-strict=true`, `save-exact=true`.
- `pnpm-workspace.yaml`: `packages: ['packages/*', 'apps/*']`.
- Root `package.json` (`private: true`, `"type": "module"`, `engines.node: ">=24"`, `packageManager: pnpm@10.x`):

| Script | Runs |
|---|---|
| `dev` | `pnpm -r --parallel --filter ./apps/* dev` |
| `build` | `pnpm -r build` |
| `typecheck` | `pnpm -r typecheck` |
| `lint` | `eslint .` |
| `format` | `prettier --write .` |
| `test` | `vitest run` (workspace) |
| `test:watch` | `vitest` |
| `test:db` | `supabase test db` (Part 2) |
| `db:types` | Part 2 |
| `audit` | `pnpm audit --prod --audit-level=high` |

- `tsconfig.base.json`: `strict`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`,
  `exactOptionalPropertyTypes`, `module: NodeNext`, `moduleResolution: NodeNext`, `target: ES2023`,
  `verbatimModuleSyntax`, `skipLibCheck`. Apps and packages extend it; `apps/web` overrides to
  `module: ESNext` / `moduleResolution: bundler` / `jsx: react-jsx` / `lib: DOM`.
- Each package: `name` `@va/<name>`, `"type": "module"`, `exports` pointing at `src/index.ts` (workspace
  consumers run TypeScript sources directly through Vite / tsx; a `build` step with `tsc` emits `dist/`
  for Docker images later). Scripts `typecheck: tsc --noEmit -p tsconfig.json`, `test: vitest run`.
- `vitest.workspace.ts` lists every package so the root `pnpm test` runs all suites. Each package's
  `vitest.config.ts` sets `environment: 'node'` (web: `jsdom` later, not now).
- ESLint flat config at the root: `@eslint/js` recommended, `typescript-eslint` recommended, `no-unused-vars`
  with `_` prefixes ignored, React plugins (`react-hooks`, `react-refresh`) scoped to `apps/web/**`, and the
  layer rule from Landmark: files under `apps/web/src/**/hooks/**` may not import the Supabase client
  (`no-restricted-syntax` on the import specifier). Ignore `dist`, `coverage`, `node_modules`.
- Prettier: `semi: false`, `singleQuote: true`, `printWidth: 110`, `trailingComma: 'all'`.
- `.gitignore`: node_modules, dist, coverage, `.env`, `.env.*` (keep `!.env*.example`), `*.local`,
  `.claude/settings.local.json`, `supabase/.temp/`, `supabase/.branches/`, `logs/`, `*.log`,
  `*.tsbuildinfo`, `playwright-report/`, `test-results/`, `apps/voice/logs/`, `graphify-out/`.
- `.editorconfig`: 2 spaces, LF, final newline, utf-8.
- `.vscode/settings.json`: ESLint as formatter-on-save with Prettier, `typescript.tsdk` to the workspace
  TypeScript. `.vscode/extensions.json`: eslint, prettier.
- Smoke test per package: `src/index.ts` exports a `PACKAGE_NAME` constant; `src/index.test.ts` asserts it.
  The point is that `pnpm test`, `pnpm typecheck` and `pnpm lint` are green on the first commit.

### 2. `CLAUDE.md` (under 200 lines)

Write it from this outline. Keep commands and invariants; push detail into `.claude/rules/` and `docs/`.

```markdown
# <Product> — Claude Code context

## What this is
One paragraph: company AI assistant, chat + voice now, WhatsApp / phone / email / documents later.
One shared engine (`packages/core`) behind every channel. Reference implementation: Landmark at
/home/user/Dev/Pannonia/Landmark (read its docs/voice/ when porting; never copy its domain rules).

## Commands
Table: dev, typecheck, lint, test, test:db, db:types, audit, plus per-app dev commands.
Before saying work is done run /done. CI runs typecheck, lint, unit tests, audit, pgTAP on every push.

## Stack
Node 24, pnpm, TypeScript strict; Hono (api); @anthropic-ai/sdk; Supabase (Postgres, Auth, Storage);
LiveKit Agents + Soniox + ElevenLabs (voice); React + Vite PWA (web); Vitest, pgTAP, Playwright.

## Layout
The tree from the brief, one line per package, with the dependency direction rule.

## Invariants
The ten invariants from the brief, one line each.

## Channels
The chat / voice settings table from the brief (short form).

## Data layer
Migrations are written with /new-migration and never applied without being asked. RLS on every table.
Tools read through ctx.userClient; persistence through ctx.serviceClient with explicit user/session
filters. Generated types: packages/db/src/database.ts via /db-types (check the linked project first).

## Testing
Vitest beside the code; fakes for services, not SDKs; scenario ids; failing test first for bugs;
never weaken an assertion (a hook asks). Details load from .claude/rules/testing.md.

## Git
main protected; feat/fix/chore branches; conventional commits with scope; squash merge; one behaviour
change per commit.

## Docs, decisions, backlog
docs/<PACKAGE>.md per package; docs/decisions/ for choices; docs/backlog/ for what is found and not
fixed (/backlog). The implementation plan is docs/plan/.

## Rules
.claude/rules/*.md load by path when you touch the matching files. Read the package's doc in docs/
before working in it.
```

### 3. `.claude/settings.json`

```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "permissions": {
    "allow": [
      "Bash(pnpm install)", "Bash(pnpm typecheck)", "Bash(pnpm lint)", "Bash(pnpm lint *)",
      "Bash(pnpm test)", "Bash(pnpm test *)", "Bash(pnpm -r *)", "Bash(pnpm --filter *)",
      "Bash(pnpm exec vitest *)", "Bash(pnpm exec tsc *)", "Bash(pnpm exec eslint *)",
      "Bash(pnpm exec prettier *)", "Bash(pnpm build)", "Bash(pnpm audit *)",
      "Bash(supabase start)", "Bash(supabase stop)", "Bash(supabase status)",
      "Bash(supabase test db)", "Bash(supabase db reset)",
      "Bash(git status *)", "Bash(git diff *)", "Bash(git log *)", "Bash(git add *)",
      "Bash(git commit *)", "Bash(git switch *)", "Bash(git checkout -b *)"
    ],
    "ask": [
      "Bash(pnpm add *)", "Bash(pnpm remove *)", "Bash(pnpm up *)",
      "Bash(supabase db *)", "Bash(supabase migration *)", "Bash(supabase link *)",
      "Bash(supabase gen *)", "Bash(supabase functions *)", "Bash(supabase secrets *)",
      "Bash(supabase projects *)", "Bash(psql *)", "Bash(git push *)", "Bash(git rebase *)",
      "Bash(docker *)", "Bash(rm -rf *)"
    ],
    "deny": [
      "Read(./.env)", "Read(./.env.*)", "Read(./apps/*/.env)", "Read(./apps/*/.env.*)",
      "Read(./packages/*/.env)", "Read(./packages/*/.env.*)"
    ]
  },
  "attribution": { "commit": "Co-Authored-By: Claude <noreply@anthropic.com>", "pr": "" },
  "hooks": {
    "SessionStart": [{ "hooks": [{ "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/session-context.mjs\"", "once": true }] }],
    "PreToolUse": [{ "matcher": "Edit|Write", "hooks": [{ "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/guard-tests.mjs\"" }] }],
    "PostToolUse": [{ "matcher": "Edit|Write", "hooks": [{ "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/format.mjs\"", "async": true }] }],
    "Stop": [{ "hooks": [{ "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/stop-verify.mjs\"", "timeout": 300 }] }]
  }
}
```

`deny` on `.env*` keeps secrets out of context. `supabase db reset` is allowed because it is local
only; everything that can touch a linked project asks. The repo cannot grant itself auto mode; that
stays a user-level setting.

### 4. `.claude/rules/*.md` (each with `paths:` frontmatter)

Write every file in full. The content below is the required substance; sessions may tighten wording.

**`architecture.md`** — `paths: ["apps/**", "packages/**"]`
- Dependency direction: `web → api` (HTTP only); `api → core → db`; `voice → core → db`; `tools-* → core` (types). `core` never imports an app, HTTP, LiveKit or React.
- Package layout: `src/index.ts` is the public surface; nothing imports another package's internals (`@va/core/src/...` is forbidden; use the exports map).
- Layers inside apps: `routes/` or `components/` → `hooks/` → `services/` → clients. Hooks never touch Supabase directly (ESLint).
- Files 150–300 lines target; split by concern, not by size.
- Import order; named exports; no barrel re-export of everything (export what the doc lists).

**`engine.md`** — `paths: ["packages/core/**"]`
- The ten invariants from the brief, as a checklist to run against every change.
- Persistence order per iteration (stream → persist assistant row → emit blocks → dispatch concurrently → persist tool_result row → emit results → loop).
- Abort handling contract: checked before each model call, between model call and dispatch, and after dispatch; on abort persist synthetic results then return silently; the request owner decides whether to emit `error`.
- Timeouts: clear every timer; pass the abort signal to handlers; a timed-out handler is told to stop.
- Prompt builders are pure. Cache breakpoints: last tool, static system block, last message block (slid every iteration).
- Model profiles: never send `thinking: disabled`; `between_tools` only on `claude-sonnet-5-5` at effort ≤ high; no forced `tool_choice`; no prefill; `fallbacks: "default"` with its beta on Opus 5.5 / Sonnet 5.5 only.
- Unknown content block types (thinking, fallback) are persisted but never emitted.

**`tools.md`** — `paths: ["packages/core/src/tools/**", "packages/tools-*/**"]`
- `defineTool` contract: zod input, `description` written for the model (what / when / non-obvious constraints), `requiredRoles`, `readOnly` truthful, handler `(input, ctx, extras, signal)`.
- Reads through `ctx.userClient`; explicit scoping wherever RLS is permissive; never interpolate raw input into PostgREST `.or()` filters; escape `%` and `_` in `ilike`.
- Output shape: small, stable, numbers raw, dates ISO; cap list sizes (`limit` ≤ 100, default 20); voice variants cap at 3–5 items.
- A new tool reaches voice only by editing the worker's `VOICE_ALLOWLIST` (`apps/voice/src/tools.ts`); the diff must say why it is safe to speak aloud.
- Every tool ships with a scenario test through the loop (not only a handler unit test).
- Run the `tool-security-reviewer` agent on a new or changed handler before committing.

**`api.md`** — `paths: ["apps/api/**"]`
- Authenticate every request (`Authorization: Bearer <jwt>`), re-read the profile; never trust claims.
- Error envelope and status table (401 unauthorized, 403 no_profile, 400 bad_request / message_too_long, 404 session_not_found, 413 payload_too_large, 429 rate_limited, 500 internal_error). Mid-stream errors are `error` events.
- SSE contract (events, comments, keepalive 15 s, `X-Accel-Buffering: no`, `Cache-Control: no-cache`).
- Service-role writes always filter by `user_id` / `session_id`.
- A pre-stream failure cleans up anything the request created (session row).
- No message content in logs; log `request_id`, `user_id`, `session_id`, codes, timings.

**`voice.md`** — `paths: ["apps/voice/**", "packages/core/src/sinks/spoken*"]`
- Latency budget: first sound ≤ 1.5 s after end of speech (target), whole single-project answer ≤ 4 s. Measure before and after any change on the hot path with the bench scripts.
- The filler is spoken once per user turn by the sink, never by the model; the prompt forbids announcing lookups.
- Everything the model says is rewritten by `speakable()` before TTS; keep that function deterministic and tested.
- Never log transcripts or audio; log timings, lengths, ids.
- `@livekit/agents` and all `@livekit/agents-plugin-*` move together, pinned exactly.
- The worker takes only dispatched jobs (`AGENT_NAME` set); the stub LLM path exists only for local tuning runs.
- Settings are env vars documented in `docs/VOICE.md`; defaults are Landmark's measured values.

**`web.md`** — `paths: ["apps/web/**"]`
- Layers: components (props-driven) → hooks (state, call services) → services (fetch / supabase-js). Hooks never import the Supabase client (ESLint).
- The chat provider sits above the router (state survives navigation).
- Failed loads show an error state, never an empty list; figures that failed render as `—`.
- i18n: every string through `t()`, hr and en keys added together, domain terms untranslated, ask before translating ambiguous strings.
- Confirmations through the shared dialog, never `window.confirm`.
- The PWA service worker never caches `/chat`, `/voice/*` or Supabase requests.

**`db.md`** — `paths: ["supabase/**", "packages/db/**"]`
- Write migrations with `/new-migration`; never apply, push, link or generate against a project without being asked in this conversation. The local stack (`supabase start`, `db reset`, `test db`) is free to use.
- File naming `YYYYMMDDHHMMSS_snake_case.sql`; opening comment says why; idempotent (`IF NOT EXISTS`, `DROP POLICY IF EXISTS`, `CREATE OR REPLACE`).
- Every table: `ENABLE ROW LEVEL SECURITY`, policies `TO authenticated` using `public.app_user_id()`, explicit `REVOKE`/`GRANT`, `COMMENT ON`.
- `SECURITY DEFINER` functions set `search_path` and check the caller themselves.
- Every function, policy or trigger gets a pgTAP test in the same commit, acting as a real user of each role.
- After a migration is applied somewhere, regenerate types with `/db-types`.

**`testing.md`** — `paths: ["**/*.test.ts", "supabase/tests/**", "packages/core/src/test/**"]`
- Fakes answer the wire protocol (Anthropic `POST /v1/messages` JSON and SSE; PostgREST, GoTrue), routed through `globalThis.fetch`; the real SDKs stay in the loop.
- A scenario starts from a freshly seeded world and must consume exactly the model turns it scripted.
- Assert on wire output, rows and requests, never on internals; name scenarios with ids.
- Fixing a bug: failing test first, named after the backlog id, asserting what the user sees.
- Never delete, skip or loosen an assertion to get green; a wrong expectation is changed on purpose, with the reason in the commit and in the `/done` report.
- Behaviour that looks wrong but is out of scope is pinned as-is and logged in the backlog with an `OQ-` prefix.

**`prompts.md`** — `paths: ["packages/core/src/prompts/**"]`
- Pure and deterministic given the channel and the context; no clock, no env.
- Static block byte-identical per channel; it carries the cache breakpoint. Per-user context in the second block; per-turn context in the last user message (or a `role: "system"` message in `messages[]` on models that support it) so the cached prefix survives.
- Written from developer to model, "Vi"; Croatian; domain terms untranslated.
- Shared `DOMAIN_RULES_HR` is one constant used verbatim by every channel; presentation blocks differ.
- Voice rules: one to three sentences; no markup; numbers, amounts, percentages and dates in words; acronyms TIC/OIB/IBAN written lower-case and declined as words; never announce lookups; ask before guessing a misheard name.
- Changing a prompt changes the cache key: note it in the commit and re-run the bench.
- Croatian that users will hear or read is marked `<!-- needs native review -->` until reviewed.

**`i18n.md`** — `paths: ["apps/web/src/locales/**", "apps/web/src/**/*.tsx"]` (the five Landmark rules: ask before translating ambiguous strings; shared strings under `common.*`; domain terms literal in both files; re-scan for hardcoded strings; stored preference over browser locale).

### 5. Hooks (`.claude/hooks/`)

All are Node ESM scripts reading the hook JSON on stdin; exit 0 to allow, print `hookSpecificOutput`
for a decision, exit 2 with stderr to block a Stop. Port Landmark's two and add two.

- **`guard-tests.mjs`** (PreToolUse Edit|Write) — port verbatim from Landmark, widen the file regex to
  `\.test\.(ts|tsx)$|/supabase/tests/.*\.sql$`. If an edit removes or rewrites an assertion line or adds
  `.skip/.only/.todo`, return `permissionDecision: "ask"` with the removed lines quoted.
- **`stop-verify.mjs`** (Stop) — port Landmark's, adapted to the monorepo: collect changed `.ts/.tsx`
  files (`git diff --name-only HEAD` + untracked), map each to its workspace package (first two path
  segments), run `pnpm --filter <pkg> typecheck` for each affected package and `pnpm exec vitest related --run <files>`
  from the root; on failure exit 2 with the last 60 lines so the session fixes it; stamp a green run by
  hash in `node_modules/.cache/stop-verify` so an unchanged tree is not re-verified; `stop_hook_active`
  guard so it blocks once per turn.
- **`format.mjs`** (PostToolUse Edit|Write, async) — run `pnpm exec prettier --write <file>` for
  `.ts/.tsx/.json/.md/.yml` files under the project; never fail (`|| true`). Claude writes mostly formatted
  code; the hook does the last 10 % so CI never fails on formatting.
- **`session-context.mjs`** (SessionStart, once) — print to stdout: current branch, whether `.env` files
  exist for each app (names only), the linked Supabase project ref from `supabase/.temp/project-ref` if any
  (with a reminder that the production ref must never be the linked one during development), Node and pnpm
  versions. This becomes additional context for the session.

Add `.claude/hooks/README.md` describing each hook, when it fires and how to disable one locally
(`"disableAllHooks": true` in `settings.local.json`).

### 6. Skills (`.claude/skills/<name>/SKILL.md`)

Port Landmark's four and add two. Use `!`command`` lines to inject live state where it helps.

- **`done`** — `description: Run before saying a change is finished…`. Steps: (1) verify: `pnpm typecheck`
  for affected packages, `pnpm test`, `pnpm exec eslint <changed files>`, `pnpm test:db` if `supabase/**`
  changed and Docker is available (else say so); (2) housekeeping checklist: regression test named after the
  backlog id and seen failing; changed assertions listed with reasons; mutations logged; strings in hr and en;
  docs updated (`docs/<PACKAGE>.md`, `docs/ARCHITECTURE.md`); migrations written not applied and listed in
  `docs/backlog/release.md`; backlog entries added or closed; Croatian user-facing text marked for native
  review; (3) report in one short list.
- **`new-migration`** — port from Landmark, minus the ERP and shared-schema steps. Keep: latest migrations
  listing, "write, never apply", naming, idempotency, RLS + grants + comments, `SECURITY DEFINER` rules,
  pgTAP test in the same commit (fail without the migration, pass with it), release checklist entry,
  `/db-types` reminder.
- **`db-types`** — `disable-model-invocation: true`. Name the linked project (`cat supabase/.temp/project-ref`)
  and wait for a yes; run `pnpm db:types`; `git diff --stat packages/db/src/database.ts`; `pnpm typecheck`;
  summarise what changed in `public`.
- **`backlog`** — port from Landmark: area files and next free ids injected with `grep -h -A1 'Ids:' docs/backlog/*.md`;
  add / close procedure; never reuse an id.
- **`new-tool`** (new) — `argument-hint: "<pack> <tool_name> <one line of what it does>"`. Steps: read
  `.claude/rules/tools.md` and `docs/CORE.md` → Tools; create `packages/<pack>/src/tools/<name>.ts` with
  `defineTool` (zod input with descriptions, model-facing description, roles, `readOnly`), the handler reading
  through `ctx.userClient`; register it in the pack's `index.ts`; decide and state whether it goes on the
  voice allowlist and why; add a scenario test through the loop using the fakes (`fixtures` seeded); run the
  `tool-security-reviewer` agent; update `docs/CORE.md` → Tool catalogue.
- **`bench-voice`** (new) — how to run `apps/voice/scripts/llm-bench.ts` and `call-test.ts` (Part 5), which
  env files they need (outside the repo, `~/.config/<product>/`), what to record in `docs/VOICE.md` → Measurements,
  and the rule that a hot-path change is measured before and after.

### 7. Agents (`.claude/agents/*.md`)

- **`convention-reviewer`** — `tools: Read, Grep, Glob, Bash`, `model: opus`. Reviews `git diff main...HEAD`
  plus uncommitted changes against: the ten invariants; layer and dependency direction; services throw;
  error envelopes; i18n in both locales; logs without content; migrations idempotent with RLS, grants and a
  pgTAP test; tests assert wire + rows; Croatian user-facing text marked for review. Output: verdict,
  findings `file:line — what — consequence — fix`, not-checked list. Does not edit.
- **`tool-security-reviewer`** — `tools: Read, Grep, Glob`, `model: opus`. For every changed tool handler:
  reads through `userClient`; explicit scoping where RLS is `USING (true)` (grep the migrations for the table's
  policies and say what they allow); no raw input in `.or()` / `ilike` without escaping; `readOnly` matches the
  handler (no insert/update/delete/rpc that writes); output bounded; if on the voice allowlist, output is safe to
  read aloud (no ids, no secrets, lists capped); description tells the model when *not* to call it. Output as
  above. Does not edit.

### 8. CI (`.github/workflows/`)

- **`test.yml`** on push and PR to `main`: `actions/checkout@v4`, `pnpm/action-setup@v4`, `actions/setup-node@v4`
  with Node 24 and pnpm cache, `pnpm install --frozen-lockfile`, `pnpm audit --prod --audit-level=high`
  (every workspace lockfile is one lockfile with pnpm, so one audit covers all), `pnpm typecheck`, `pnpm lint`,
  `pnpm test`. `concurrency` cancel-in-progress per ref. Timeout 10 min.
- **`db-tests.yml`** on push and PR to `main`: `supabase/setup-cli@v1` with the same version as local
  (`supabase --version` shows 2.99.0 on this machine; pin and bump together), `supabase start`,
  `supabase test db`. No secrets. It will have nothing to test until Part 2; create it now so Part 2 only
  adds tests.
- **`dependabot.yml`**: npm at `/` weekly, cooldown 14 days, groups `minor-and-patch` and `livekit`
  (`@livekit/*` move together); github-actions weekly.

### 9. Docs skeleton

- `docs/ARCHITECTURE.md`: the brief's layout, the dependency direction, the one-picture diagram, the channel
  table, and a "where things live" table that every later part extends.
- `docs/CORE.md`, `docs/API.md`, `docs/VOICE.md`, `docs/WEB.md`: a title and "to be written in Part N".
- `docs/TESTING.md`: the testing conventions from the brief and the rule file, with the commands.
- `docs/decisions/README.md` + `0000-template.md` (Context / Decision / Consequences / Date) and
  `0001-node-monorepo-and-supabase.md`, `0002-single-organisation.md`, `0003-croatian-first.md`,
  `0004-voice-stack.md`, `0005-models-per-channel.md`, `0006-hono-and-zod.md`,
  `0007-abort-as-first-class-exit-no-db-beacon.md`, `0008-chat-streams-token-deltas.md` — each one page,
  content from the brief's decision table.
- `docs/backlog/README.md` (format, severities, ranking; port from Landmark, trimmed) and area files
  `core.md`, `api.md`, `voice.md`, `web.md`, `db.md`, `ops.md`, `release.md`, each with `Ids: <AREA>-1 (next free)`.
- `docs/plan/`: these files.

### 10. First push

Create the GitHub repository (the `gh` CLI is not installed on this machine; create it in the browser
under the same account as Landmark), add the remote, push `main`, enable branch protection with the two
workflows as required checks, enable Dependabot security updates.

## Acceptance checklist

- [ ] `pnpm install && pnpm typecheck && pnpm lint && pnpm test` green on a clean clone.
- [ ] CI green on the first push; both workflows exist.
- [ ] `CLAUDE.md` < 200 lines; a new session can answer "how do I run the tests" from it alone.
- [ ] Each rule file loads only for its paths (verify by touching a file and asking the session which rules it has).
- [ ] `guard-tests.mjs` asks when an assertion is removed from `packages/core/src/index.test.ts` (demonstrate, then revert).
- [ ] `stop-verify.mjs` blocks a turn once when typecheck is red (demonstrate with a deliberate type error, then revert).
- [ ] `format.mjs` reformats a badly formatted file after an Edit.
- [ ] `session-context.mjs` output appears at session start.
- [ ] `docs/decisions/0001`–`0008` exist; `docs/backlog/` area files exist with next-free ids.
- [ ] No secrets in the repo; `.env*.example` files only (empty for now).

## Do not

- Add product code or real dependencies beyond what an empty package needs.
- Put harness-enforceable rules (attribution, permissions) into `CLAUDE.md`; they live in `settings.json`.
- Create general-purpose agents ("backend engineer"); the two agents above are specific on purpose.
- Add MCP servers now. If library docs are needed later, `context7` pinned to an exact version is the
  one worth adding, as a separate decision.

## Landmark references

- `CLAUDE.md`, `.claude/settings.json`, `.claude/hooks/guard-tests.mjs`, `.claude/hooks/stop-verify.mjs`,
  `.claude/rules/*.md`, `.claude/skills/*/SKILL.md`, `.claude/agents/convention-reviewer.md`
- `.github/workflows/test.yml`, `.github/workflows/db-tests.yml`, `.github/dependabot.yml`
- `docs/backlog/README.md`, `docs/REGRESSION_PREVENTION.md` (why the hooks exist), `docs/TESTING.md`
- `eslint.config.js` (the hooks-must-not-import-supabase rule, the `confirm` ban)
