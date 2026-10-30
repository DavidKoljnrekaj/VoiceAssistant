---
name: new-tool
description: Add a tool to a tool pack with defineTool — zod input, model-facing description, roles, readOnly, handler reading as the user — plus registration, the voice allowlist decision, a scenario test through the loop and the security review.
argument-hint: '<pack> <tool_name> <one line of what it does>'
---

# New tool

Arguments: `$ARGUMENTS` (pack, tool name, one line of what it does).

Existing tools in the pack:

!`ls packages/*/src/tools 2>/dev/null || echo "(no tool packs yet — Part 3)"`

1. Read `.claude/rules/tools.md` and `docs/CORE.md` → Tools before writing anything.
2. Create `packages/<pack>/src/tools/<name>.ts` with `defineTool`:
   - zod input schema with a `.describe()` on every field; sensible caps (`limit` ≤ 100, default 20)
   - `description` written for the model: what it does, when to call it, when **not** to, and any
     non-obvious constraint (date ranges, units, what the ids mean)
   - `requiredRoles`; `readOnly` truthful (no insert/update/delete/rpc that writes when true)
   - handler `(input, ctx, extras, signal)` reading through `ctx.userClient`, honouring `signal`,
     scoping explicitly where a policy is permissive, escaping `%` and `_` before `ilike`, never
     interpolating raw input into `.or()`
   - output small and stable: numbers raw, dates ISO, lists capped
3. Register it in the pack's `src/index.ts` (the pack's `tools` array).
4. **Decide and state whether it goes on the voice allowlist** (`VOICE_ALLOWLIST` in
   `apps/voice/src/tools.ts`; core names no pack's tools) and why its output is safe to read
   aloud (no ids, no secrets, ≤ 5 items). If it goes on, say so in the commit message.
5. Add a scenario test through the loop using the fakes (`fixtures` seeded, a scripted model turn
   that calls the tool), asserting the request the handler sent and the `tool_result` the model
   received. Give it a scenario id.
6. Run the `tool-security-reviewer` agent on the handler and fix what it finds.
7. Update `docs/CORE.md` → Tool catalogue (name, roles, readOnly, channels, one line).
