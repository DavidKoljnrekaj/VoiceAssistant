// A deadline on the one network read a turn makes before its own 25 s timer exists: the identity
// re-read (PostgREST, then GoTrue; supabase-js's fetch has no timeout of its own). Turns run one
// after another, so a hung read would otherwise stall the whole call, not one turn (V-3). The
// same shape as the API's `withDeadline` (`apps/api/src/deadline.ts`).

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
