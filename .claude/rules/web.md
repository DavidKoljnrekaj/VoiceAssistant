---
paths:
  - 'apps/web/**'
---

# Web (`@va/web`, React PWA)

- **Layers:** components (props-driven) → hooks (state, call services) → services (`fetch` to the
  api, `supabase-js` for reads under RLS). Hooks never import the Supabase client (ESLint).
- **The chat provider sits above the router** so conversation state survives navigation.
- **Failed loads show an error state**, never an empty list; a figure that failed renders as `—`.
- **i18n:** every string goes through `t()`; `hr` and `en` keys are added together; domain terms stay
  untranslated; ask before translating an ambiguous string (`.claude/rules/i18n.md`).
- **Confirmations** go through the shared dialog, never `window.confirm` (ESLint).
- **The PWA service worker never caches** `/chat`, `/voice/*` or Supabase requests.
- **Streaming:** render token deltas as provisional text; replace with the `turn` event's canonical
  text; drop provisional text on `persistence_error`.
- Default exports only for React components; everything else named.
