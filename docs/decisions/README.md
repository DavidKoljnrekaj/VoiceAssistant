# Decisions

One page per decision: context, the decision, consequences, date. Numbered in order; never
renumbered or deleted. A reversed decision gets a new entry that points at the old one.

Copy `0000-template.md` for a new entry. The first eight were taken in the plan
(`docs/plan/00-brief.md` § 2 and `09-appendix.md` § A) and recorded here in Part 1.

| #                                                        | Decision                                                     |
| -------------------------------------------------------- | ------------------------------------------------------------ |
| [0001](./0001-node-monorepo-and-supabase.md)             | Node monorepo (pnpm) + Supabase                              |
| [0002](./0002-single-organisation.md)                    | Own Supabase project, single organisation                    |
| [0003](./0003-croatian-first.md)                         | Croatian-first, English fallback                             |
| [0004](./0004-voice-stack.md)                            | LiveKit Agents (Node) + Soniox + ElevenLabs behind adapters  |
| [0005](./0005-models-per-channel.md)                     | Opus 5.5 for chat, Sonnet 5.5 with `between_tools` for voice |
| [0006](./0006-hono-and-zod.md)                           | Hono + zod                                                   |
| [0007](./0007-abort-as-first-class-exit-no-db-beacon.md) | Abort is a first-class loop exit; no DB cancel beacon        |
| [0008](./0008-chat-streams-token-deltas.md)              | Chat streams token deltas plus canonical blocks              |
| [0009](./0009-manual-loop-not-tool-runner.md)            | The manual Messages loop, not the SDK Tool Runner            |
| [0010](./0010-engine-as-llm-node.md)                     | The engine as the agent's `llmNode`, not a loopback shim     |
| [0011](./0011-voice-history-is-the-calls-own-rows.md)    | The voice history is the call's own rows, not LiveKit's text |
