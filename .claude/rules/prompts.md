---
paths:
  - 'packages/core/src/prompts/**'
---

# Prompts

- **Pure and deterministic** given the channel and the context object. No clock, no locale, no env
  reads inside a builder; the caller passes what varies.
- **The static block is byte-identical per channel** and carries the cache breakpoint. Per-user
  context goes in the second block; per-turn context in the last user message (or a
  `role: "system"` message in `messages[]` on models that support it) so the cached prefix survives.
- **Written from developer to model**, addressing the model as "Vi", in Croatian. Domain terms stay
  untranslated. Tool names are not repeated in the prompt except where it must say _when_ to call one.
- **`DOMAIN_RULES_HR` is one constant** used verbatim by every channel; only the presentation blocks
  differ per channel.
- **Voice rules:** one to three sentences; no markup; numbers, amounts, percentages and dates in
  words; acronyms TIC/OIB/IBAN written lower-case and declined as words; never announce lookups;
  ask before guessing a misheard name.
- **Changing a prompt changes the cache key.** Say so in the commit message and re-run the bench
  (`/bench-voice`) for voice prompts.
- Croatian text that users will hear or read is marked `<!-- needs native review -->` until a native
  speaker has reviewed it; the `/done` report lists what is still marked.
