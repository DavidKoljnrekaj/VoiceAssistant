// Short message references (m1, m2 …) in place of Graph ids: Graph's ids are long, the model
// would copy them wrong, and a caller must never hear one. Per user, in this process, for 30
// minutes after the last use; the same message keeps its ref while it lives, and a number is
// never given twice in a process, so a ref left in an old conversation is expired, never another
// message. The API and the
// worker are one process each (decision 0016), so a ref from a chat list is not valid on a call;
// a second instance would need the map in the database (API-15).
export const REF_TTL_MS = 30 * 60_000
/** Refs one user holds at once; the least recently used goes first. */
const MAX_PER_USER = 200
/** A ref as the model may send it. */
export const REF_PATTERN = /^m[1-9][0-9]{0,8}$/

interface Entry {
  graphId: string
  touched: number
}

interface UserRefs {
  next: number
  byRef: Map<string, Entry>
  byId: Map<string, string>
}

export class MessageRefs {
  private readonly users = new Map<string, UserRefs>()

  constructor(private readonly clock: () => Date = () => new Date()) {}

  /** The ref for this message, a new one or the one it already has. */
  refFor(userId: string, graphId: string): string {
    const now = this.clock().getTime()
    const u = this.sweep(userId, now)
    const existing = u.byId.get(graphId)
    if (existing) {
      u.byRef.get(existing)!.touched = now
      return existing
    }
    if (u.byRef.size >= MAX_PER_USER) {
      const [oldest] = [...u.byRef].sort((a, b) => a[1].touched - b[1].touched)
      this.drop(u, oldest![0])
    }
    const ref = `m${u.next++}`
    u.byRef.set(ref, { graphId, touched: now })
    u.byId.set(graphId, ref)
    return ref
  }

  /** The Graph id behind a ref this user was given, or null when unknown or expired. */
  resolve(userId: string, ref: string): string | null {
    if (!REF_PATTERN.test(ref)) return null
    const now = this.clock().getTime()
    const entry = this.sweep(userId, now).byRef.get(ref)
    if (!entry) return null
    entry.touched = now
    return entry.graphId
  }

  private sweep(userId: string, now: number): UserRefs {
    let u = this.users.get(userId)
    if (!u) {
      u = { next: 1, byRef: new Map(), byId: new Map() }
      this.users.set(userId, u)
    }
    for (const [ref, e] of u.byRef) if (now - e.touched >= REF_TTL_MS) this.drop(u, ref)
    return u
  }

  private drop(u: UserRefs, ref: string): void {
    const e = u.byRef.get(ref)
    if (!e) return
    u.byRef.delete(ref)
    u.byId.delete(e.graphId)
  }
}
