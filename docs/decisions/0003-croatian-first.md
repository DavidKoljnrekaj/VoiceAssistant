# 0003 — Croatian-first, English fallback

## Context

Users are Croatian speakers; the voice rules Landmark measured (numbers in words, dates, declension of acronyms like TIC, OIB, IBAN) are Croatian-specific. Code is read by people and models that work in English.

## Decision

Prompts and spoken rules are written in Croatian, from developer to model, addressing the model as "Vi". The UI ships `hr` and `en` together; a user's stored language preference wins over the browser locale. Domain terms are never translated. Code, comments, docs and tool descriptions are English. Alternatives: English-first with translation (loses the measured voice rules); per-user prompt language (doubles the prompt lineage and the cache keys).

## Consequences

One prompt lineage per channel. Every Croatian string users hear or read is marked `<!-- needs native review -->` until a native speaker has reviewed it, and the `/done` report lists what is still marked. English-only users get the English UI and Croatian-rule-free answers only when a later decision adds an English prompt lineage.

## Date

2026-10-26
