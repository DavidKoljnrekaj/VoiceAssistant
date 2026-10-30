// One deadline for everything a request does before its first byte: authentication (GoTrue and
// the profile re-read) and, for /chat, the pre-stream pipeline (up to five PostgREST round trips).
// supabase-js's fetch has no timeout of its own, so a hung Supabase would otherwise hold the
// request open for ever. The stream has its own 90 s timeout once `: ready` is written.
export const PRE_STREAM_TIMEOUT_MS = 10_000

/** `{ timedOut: true }` when `ms` elapse before `work` settles; the timer is cleared either way. */
export async function withDeadline<T>(
  work: Promise<T>,
  ms: number,
): Promise<{ timedOut: false; value: T } | { timedOut: true }> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<{ timedOut: true }>((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), ms)
  })
  try {
    return await Promise.race([work.then((value) => ({ timedOut: false as const, value })), timeout])
  } finally {
    clearTimeout(timer)
  }
}
