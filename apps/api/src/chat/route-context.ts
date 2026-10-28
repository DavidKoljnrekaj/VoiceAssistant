// The per-turn context line: where the user is in the PWA, prepended in memory to the typed
// text and never persisted (Landmark). The route is sanitised, never labelled: this product has
// no route table yet, so the raw path is what the model sees.
import type { InMemoryMessage } from '@va/core'

const MAX_ROUTE_LENGTH = 200

/** A client path as `/segment[/segment]` without query or hash; null for anything else. */
export function sanitizeRoute(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  let path = raw.trim()
  if (path.length === 0 || path.length > MAX_ROUTE_LENGTH || !path.startsWith('/')) return null
  const q = path.indexOf('?')
  if (q !== -1) path = path.slice(0, q)
  const h = path.indexOf('#')
  if (h !== -1) path = path.slice(0, h)
  // eslint-disable-next-line no-control-regex -- routes never contain control characters
  if (/[\s\x00-\x1f\x7f]/.test(path)) return null
  return path
}

/** <!-- needs native review --> */
export function contextLine(route: string): string {
  return `[Kontekst: korisnik je trenutno na ${route}]`
}

/** Prepends the context line to the first text block of the last (user) message, in memory. */
export function prependRouteContext(messages: InMemoryMessage[], route: string | null): void {
  if (!route) return
  const last = messages.at(-1)
  if (!last || last.role !== 'user') return
  const idx = last.content.findIndex((b) => b.type === 'text')
  if (idx === -1) return
  const block = last.content[idx]!
  last.content[idx] = { ...block, text: `${contextLine(route)}\n\n${String(block.text ?? '')}` }
}
