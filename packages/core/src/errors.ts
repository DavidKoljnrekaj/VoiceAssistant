// The error catalogue: one stable code per failure, a Croatian message for the user, and the
// mapping from the Anthropic SDK's typed errors. HTTP pre-stream failures carry a code and a
// message in a flat envelope; mid-stream failures are `error` events with the same two fields.
import Anthropic from '@anthropic-ai/sdk'

export type ErrorCode =
  | 'unauthorized'
  | 'no_profile'
  | 'bad_request'
  | 'message_too_long'
  | 'session_not_found'
  | 'payload_too_large'
  | 'rate_limited'
  | 'internal_error'
  | 'model_rate_limited'
  | 'model_timeout'
  | 'model_unreachable'
  | 'model_bad_request'
  | 'model_auth_failed'
  | 'model_error'
  | 'model_refused'
  | 'persistence_error'
  | 'request_timeout'
  | 'tool_limit_reached'
  | 'cancelled'

/** User-facing messages. Ported from Landmark where it had one. <!-- needs native review --> */
export const MESSAGES_HR: Record<ErrorCode, string> = {
  unauthorized: 'Niste prijavljeni ili je prijava istekla.',
  no_profile: 'Vaš račun nema korisnički profil. Obratite se administratoru.',
  bad_request: 'Neispravan zahtjev.',
  message_too_long: 'Poruka je predugačka.',
  session_not_found: 'Razgovor nije pronađen.',
  payload_too_large: 'Zahtjev je prevelik.',
  rate_limited: 'Previše zahtjeva. Pokušajte ponovno za nekoliko minuta.',
  internal_error: 'Došlo je do greške. Pokušajte ponovno.',
  model_rate_limited: 'Model je trenutno preopterećen. Pokušajte ponovno za nekoliko trenutaka.',
  model_timeout: 'Model nije odgovorio na vrijeme. Pokušajte ponovno.',
  model_unreachable: 'Greška u komunikaciji s modelom. Pokušajte ponovno.',
  model_bad_request: 'Interna greška pri pripremi upita. Prijavite ovo administratoru.',
  model_auth_failed: 'Greška u autentikaciji s modelom. Prijavite ovo administratoru.',
  model_error: 'Greška pri pozivu modela. Pokušajte ponovno.',
  model_refused: 'Na to vam ne mogu odgovoriti.',
  persistence_error: 'Greška pri spremanju odgovora.',
  request_timeout: 'Odgovor je trajao predugo. Pokušajte ponovno.',
  tool_limit_reached: 'Dostignut je limit poziva alata. Pokušajte preformulirati pitanje.',
  cancelled: 'Zahtjev je prekinut.',
}

export interface MappedError {
  code: ErrorCode
  message: string
  /** True for our-fault errors (bad request shape, bad key) and the unknown fall-through; false
   * for expected operational states (rate limit, timeout, unreachable, overloaded). */
  shouldLog: boolean
}

/**
 * Maps an error thrown by the Anthropic SDK to a code and message. `APIConnectionTimeoutError`
 * is checked before `APIConnectionError`: it is a subclass. A 529 (overloaded) is an operational
 * state like a 429, not an internal error, so it maps to `model_rate_limited`.
 */
export function mapAnthropicError(err: unknown): MappedError {
  if (err instanceof Anthropic.RateLimitError) return mapped('model_rate_limited', false)
  if (err instanceof Anthropic.APIConnectionTimeoutError) return mapped('model_timeout', false)
  if (err instanceof Anthropic.APIConnectionError) return mapped('model_unreachable', false)
  if (err instanceof Anthropic.BadRequestError) return mapped('model_bad_request', true)
  if (err instanceof Anthropic.AuthenticationError) return mapped('model_auth_failed', true)
  if (err instanceof Anthropic.InternalServerError && err.status === 529) {
    return mapped('model_rate_limited', false)
  }
  return mapped('model_error', true)
}

function mapped(code: ErrorCode, shouldLog: boolean): MappedError {
  return { code, message: MESSAGES_HR[code], shouldLog }
}
