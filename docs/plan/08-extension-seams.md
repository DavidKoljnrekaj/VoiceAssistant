# Part 8 — Extension seams (not built in the skeleton)

This part is a map, not a session. Each seam names what the skeleton already provides, what a later
part adds, and what Landmark already specified. When one of these is started, write its own plan
file in `docs/plan/` first.

## 1. Tool packs (the company's platforms, email, documents)

**Provided by the skeleton:** `ToolPack { name, tools, domainRules? }`, `defineTool`, the registry with
role and channel gates, zod validation at dispatch, the `tool-security-reviewer` agent, the `/new-tool`
skill, and `extras` on every handler for per-request context.

**Pack contract to keep:** one package per system (`packages/tools-<system>`), its own credentials
resolved per user (a `user_integrations` table: `user_id`, `system`, encrypted credential or a
service-side mapping), reads only until a confirmation protocol exists, outputs small and voice-safe
variants where the tool is allowlisted for voice, `domainRules` contributing the data-model landmines
of that system to `DOMAIN_RULES_HR` (this is where Landmark's TIC / cesija rules would return, owned
by the Landmark pack, not by core).

**Landmark pack specifically:** the 12 read-only voice tools in Landmark's `_shared/tools.ts` port
almost verbatim once a per-user mapping to a Landmark account exists. Two ways to reach the data:
(a) through Landmark's Supabase with a JWT minted or stored for the mapped user (RLS applies; the
`USING (true)` tables need the same explicit scoping Landmark's handlers have), or (b) through an API
Landmark exposes. (a) is faster to build; (b) is cleaner across deployments. Decide when the pack is
planned; Landmark's `docs/AI_CHAT.md` → Security Posture §3 lists the tables where the role gate is the
only gate.

**Email (Microsoft Graph):** read tools (search mail, read thread, list calendar) first; `send_email` /
`reply` need the write protocol below. Tenant consent and token storage are their own decision.

**Company documents:** a retrieval tool over Supabase Storage + a text index. Landmark's `search_help`
(lexical BM25 with Croatian diacritic folding and prefix stemming, `help-score.ts`) is a good first
retriever for a few hundred documents; vectors (Voyage) only if measured to help.

## 2. Write tools and confirmation

The skeleton refuses writes by prompt and by the voice allowlist. A write tool needs: `readOnly: false`,
a `confirmation: 'required'` flag on the definition, a loop-level protocol (the tool returns a
`pending_confirmation` result with a summary; the channel asks; a second call with `confirmed: true`
executes), an audit row per executed write, and a channel UX (chat: a confirm card; voice: spoken
summary plus "Da" / "Ne", never DTMF for content). Keep writes off voice until the protocol has tests.

## 3. WhatsApp channel

Meta Cloud API webhook into `apps/api` (`POST /webhooks/whatsapp`, signature verified), identity from
`users.phone_e164`, session keyed by `(channel 'whatsapp', external_id = wa_id)`, a `TextSink` that
buffers the answer into one message (no streaming on WhatsApp), voice notes transcribed with the same
Soniox adapter, rate limits per phone, the 24-hour customer-service window respected. The loop and the
tools are unchanged; `CHANNEL_ALLOWLIST.whatsapp` starts empty.

## 4. Phone number (PSTN)

LiveKit SIP trunk → the same worker. Identity: `voice_caller_identities` (phone → user, PIN hash,
lockout), **mandatory DTMF PIN for roles that can hear financial data**, unknown or withheld numbers
refused before the model sees anything, a short-lived JWT minted for the mapped user so RLS still
applies, alerting on repeated PIN failures. Landmark's plan §9 specifies all of it, including the
schema; port it when v1 voice has run in production.

## 5. Compaction and long sessions

Port Landmark's `context-window.ts` writer (`maybeCompactSession` after `done`, off the critical path,
60K trigger, 20K keep budget, summary keyed to a boundary row) for chat. Voice stays off. The columns
already exist.

## 6. Attachments

Landmark's attachment pipeline (storage bucket with owner-prefix policies, `ai_message_attachments`
side-table, multimodal content blocks, stripping of old attachment bytes) ports as a unit when needed.
The `content` JSONB shape already allows image / document blocks.

## 7. Multi-organisation

One migration adds `organizations` and `organization_members`, an `organization_id` on `users`,
`ai_sessions` and every pack table, and RLS `USING (organization_id = app_org_id())`. The engine does not
change; `AuthContext` gains `organizationId`.

## 8. MCP as a tool source

If a system already exposes an MCP server, a `packages/tools-mcp` adapter can wrap its tools into
`defineTool` entries at startup (schemas from the server, validation by zod-from-JSON-Schema). Keep the
same role and channel gates; never allowlist an MCP tool for voice without reading its output shape.
