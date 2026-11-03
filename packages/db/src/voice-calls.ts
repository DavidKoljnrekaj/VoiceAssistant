// Values the schema fixes and the apps must agree with. Each names the SQL it mirrors; change
// both sides together.

/**
 * The idle window of a `voice_calls` row. A row whose `last_seen_at` is older than this counts
 * as absent: the worker's lookup refuses it (`apps/voice/src/call.ts`) and the API's concurrent
 * count skips it (`apps/api/src/rate-limit.ts`). The `voice-calls-sweep` pg_cron job deletes it
 * with the same window, written as the SQL literal `interval '3 minutes'` in
 * `supabase/migrations/20261028100200_voice_calls.sql` (the sweep's DELETE).
 */
export const VOICE_CALL_IDLE_MS = 3 * 60_000

/**
 * The hard cap on a `voice_calls` row: `expires_at` never passes `created_at + 15 minutes`,
 * the constraint `voice_calls_expires_within_cap` in
 * `supabase/migrations/20261102100000_voice_calls_expiry_cap.sql`. The API and the voice worker
 * compute `expires_at` with it.
 */
export const VOICE_CALL_CAP_MS = 15 * 60_000
