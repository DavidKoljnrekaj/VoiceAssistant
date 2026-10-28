// Per-channel settings: the brief's table (docs/ARCHITECTURE.md → Channels) as data, with the
// four env overrides. The engine reads no env itself: the app parses its env and passes the map.
import { z } from 'zod'

export type Channel = 'chat' | 'voice'
export type Effort = 'low' | 'medium' | 'high'

export interface ChannelSettings {
  model: string
  effort: Effort
  /** `adaptive` omits the `thinking` parameter; `between_tools` sends it on models that accept it
   * (see `modelProfile`). */
  thinking: 'adaptive' | 'between_tools'
  maxTokens: number
  maxIterations: number
  toolTimeoutMs: number
  requestTimeoutMs: number
  /** Rows the history read may return (`ai_session_history(p_max_rows)` for chat; the call's own
   * context for voice). */
  historyMaxRows: number
  compaction: boolean
}

export const CHANNEL_DEFAULTS: Record<Channel, ChannelSettings> = {
  chat: {
    model: 'claude-opus-5-5',
    effort: 'medium',
    thinking: 'adaptive',
    maxTokens: 8192,
    maxIterations: 10,
    toolTimeoutMs: 15_000,
    requestTimeoutMs: 90_000,
    historyMaxRows: 200,
    compaction: false,
  },
  voice: {
    model: 'claude-sonnet-5-5',
    effort: 'low',
    thinking: 'between_tools',
    maxTokens: 1024,
    maxIterations: 4,
    toolTimeoutMs: 6_000,
    requestTimeoutMs: 25_000,
    historyMaxRows: 20,
    compaction: false,
  },
}

const effortSchema = z.enum(['low', 'medium', 'high'])
const modelSchema = z.string().trim().min(1)

const OVERRIDES: Record<Channel, { model: string; effort: string }> = {
  chat: { model: 'AI_CHAT_MODEL', effort: 'AI_CHAT_EFFORT' },
  voice: { model: 'AI_VOICE_MODEL', effort: 'AI_VOICE_EFFORT' },
}

/**
 * The channel's defaults with the env overrides applied: `AI_CHAT_MODEL`, `AI_CHAT_EFFORT`,
 * `AI_VOICE_MODEL`, `AI_VOICE_EFFORT`. An empty or unset variable keeps the default; an invalid
 * one throws, naming the variable and never echoing its value.
 */
export function channelSettings(channel: Channel, env: Record<string, string | undefined>): ChannelSettings {
  const keys = OVERRIDES[channel]
  const settings = { ...CHANNEL_DEFAULTS[channel] }
  const model = read(env, keys.model, modelSchema)
  if (model !== undefined) settings.model = model
  const effort = read(env, keys.effort, effortSchema)
  if (effort !== undefined) settings.effort = effort
  return settings
}

function read<T>(env: Record<string, string | undefined>, key: string, schema: z.ZodType<T>): T | undefined {
  const raw = env[key]
  if (raw === undefined || raw.trim() === '') return undefined
  const result = schema.safeParse(raw)
  if (!result.success)
    throw new Error(`Invalid ${key}: ${result.error.issues.map((i) => i.message).join('; ')}`)
  return result.data
}
