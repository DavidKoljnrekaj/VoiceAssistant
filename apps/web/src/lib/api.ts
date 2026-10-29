// `fetch` to the API with the session's JWT. A non-OK answer is the flat `{ error: { code, message } }`
// envelope from docs/API.md, thrown as ApiHttpError; a missing session is `unauthorized` without a
// request.
import { ApiHttpError } from '../types/api'
import { env } from './env'
import { supabase } from './supabase'

export async function accessToken(): Promise<string> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new ApiHttpError(401, 'unauthorized', 'Niste prijavljeni.')
  return token
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await accessToken()
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${token}`)
  if (init.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  const response = await fetch(`${env.VITE_API_URL}${path}`, { ...init, headers })
  if (!response.ok) throw await ApiHttpError.fromResponse(response)
  return response
}

/** A JSON endpoint: the parsed body on success, ApiHttpError otherwise. */
export async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await apiFetch(path, init)
  return (await response.json()) as T
}
