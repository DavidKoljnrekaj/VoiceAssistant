// The worker: takes a dispatched call, resolves the caller from the opaque token in the job
// metadata, listens with Soniox, answers through the shared engine in-process (the
// `AssistantAgent`'s `llmNode`), speaks with ElevenLabs, handles barge-in, writes the turn's
// rows after each answer and deletes the call's credential on hang-up. Ported from Landmark's
// `tools/voice-prototype/src/agent.ts` with its `voice-llm` function folded in; the stub LLM
// is not here (it is a script-only tuning aid).
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  cli,
  defineAgent,
  initializeLogger,
  type JobContext,
  type JobProcess,
  loggerOptions,
  ServerOptions,
  type VAD,
  voice,
} from '@livekit/agents'
import { RoomEvent } from '@livekit/rtc-node'
import Anthropic from '@anthropic-ai/sdk'

import { channelSettings, log, ToolRegistry } from '@va/core'
import { createServiceClient } from '@va/db'
import { demoPack } from '@va/tools-demo'

import { AssistantAgent } from './assistant-llm.js'
import { CallIdentity } from './call.js'
import { LOG_TAG, type VoiceDeps } from './config.js'
import { parseVoiceEnv } from './env.js'
import { GREETING_HR } from './greeting.js'
import { acceptDispatchedJob, callTokenOf } from './job.js'
import { createMetrics, turnEntry } from './metrics.js'
import { loadHints } from './providers/hints.js'
import { createStt } from './providers/stt.js'
import { createTts } from './providers/tts.js'
import { loadVad } from './providers/vad.js'
import { installStdoutRedaction } from './redact.js'
import { CallSession } from './session.js'
import { startOptions, turnHandlingOptions, vadFor } from './session-options.js'
import { warm } from './warm.js'

// No `lk.pii.*` key leaves this process (invariant 9): installed before anything logs.
installStdoutRedaction()

const HERE = dirname(fileURLToPath(import.meta.url))
const env = parseVoiceEnv(process.env)
const metrics = createMetrics(env.VOICE_LOGS_DIR ?? join(HERE, '..', 'logs'))
const deps: VoiceDeps = {
  anthropic: new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    ...(env.ANTHROPIC_BASE_URL ? { baseURL: env.ANTHROPIC_BASE_URL } : {}),
  }),
  registry: new ToolRegistry([demoPack]),
  settings: channelSettings('voice', {
    AI_VOICE_MODEL: env.AI_VOICE_MODEL,
    AI_VOICE_EFFORT: env.AI_VOICE_EFFORT,
  }),
  clock: () => new Date(),
}
const TUNING = {
  endpoint_delay_ms: env.ENDPOINT_DELAY_MS,
  turn_min_delay_ms: env.TURN_MIN_DELAY_MS,
  endpoint_latency_level: env.ENDPOINT_LATENCY_LEVEL,
  interrupt_on: env.INTERRUPT_ON,
  min_interruption_ms: env.INTERRUPT_MIN_MS,
  output_queue_ms: env.OUTPUT_QUEUE_MS,
  vad_threshold: env.VAD_THRESHOLD,
  vad_min_speech_ms: env.VAD_MIN_SPEECH_MS,
}

type UserData = { vad: VAD }
/** How often a connected call bumps `last_seen_at` between turns (the idle window is 3 min). */
const KEEPALIVE_MS = 60_000

export default defineAgent<UserData>({
  prewarm: async (proc: JobProcess<UserData>) => {
    proc.userData.vad = await loadVad(env)
  },
  entry: async (ctx: JobContext<UserData>) => {
    // JSON lines only, so the stdout redaction sees every key LiveKit logs (`dev` is pretty).
    initializeLogger({ pretty: false, level: loggerOptions()?.level ?? 'info' })
    const room = ctx.job.room?.name ?? ''
    const ids: Record<string, unknown> = { job_id: ctx.job.id, room }
    const callToken = callTokenOf(ctx.job.metadata)
    if (!callToken) {
      log('error', LOG_TAG, 'job refused', { ...ids, reason: 'no call token' })
      throw new Error('job without a call token')
    }
    const service = createServiceClient()
    const identity = await CallIdentity.resolve(service, callToken, room, { cacheMs: env.IDENTITY_CACHE_MS })
    if (!identity) {
      log('error', LOG_TAG, 'job refused', { ...ids, reason: 'no live call for the token' })
      throw new Error('no live call for the token')
    }
    ids.session_id = identity.sessionId
    ids.user_id = identity.userId
    log('info', LOG_TAG, 'call accepted', ids)

    // While the greeting plays: resolve the caller once and write the prompt cache.
    const t0 = Date.now()
    void identity
      .ctx()
      .then((auth) => warm(deps, auth))
      .then((r) => metrics.write('warm.jsonl', { room, ...r }))
      .catch((err: unknown) => {
        log('warn', LOG_TAG, 'warm failed', {
          ...ids,
          ms: Date.now() - t0,
          reason: err instanceof Error ? err.constructor.name : typeof err,
        })
      })

    const call = new CallSession(deps, identity)
    const session = new voice.AgentSession({
      vad: vadFor(env, ctx.proc.userData.vad),
      stt: createStt(env, loadHints()),
      tts: createTts(env),
      turnHandling: turnHandlingOptions(env),
    })

    // The framework's own e2e figure per reply: user stopped speaking → the agent's first frame.
    session.on(voice.AgentSessionEventTypes.ConversationItemAdded, (ev) => {
      const entry = turnEntry(ev.item as Parameters<typeof turnEntry>[0], TUNING)
      if (entry) void metrics.write('turns.jsonl', { room, ...entry })
    })

    // Barge-in: the user starts speaking while the agent speaks; how long until the agent stops?
    // `first_words_wall` is when Soniox's first interim words arrived, in every mode, so the two
    // detectors can be compared.
    let agentSpeaking = false
    let userStartedAt: number | null = null
    let firstWordsAt: number | null = null
    session.on(voice.AgentSessionEventTypes.UserStateChanged, (ev) => {
      if (ev.newState === 'speaking' && agentSpeaking && userStartedAt === null) userStartedAt = ev.createdAt
    })
    session.on(voice.AgentSessionEventTypes.UserInputTranscribed, (ev) => {
      if (ev.isFinal || !ev.transcript.trim() || !agentSpeaking || firstWordsAt !== null) return
      firstWordsAt = ev.createdAt
      if (env.INTERRUPT_ON === 'both') void session.interrupt()
    })
    session.on(voice.AgentSessionEventTypes.AgentStateChanged, (ev) => {
      if (ev.newState === 'speaking') {
        agentSpeaking = true
        firstWordsAt = null
      }
      if (ev.oldState === 'speaking' && ev.newState !== 'speaking') {
        agentSpeaking = false
        if (userStartedAt !== null) {
          void metrics.write('bargein.jsonl', {
            room,
            ...TUNING,
            user_started_wall: userStartedAt,
            first_words_wall: firstWordsAt,
            agent_stopped_wall: ev.createdAt,
            stop_ms: ev.createdAt - userStartedAt,
          })
          userStartedAt = null
        }
      }
    })
    session.on(voice.AgentSessionEventTypes.Error, (ev) => {
      log('error', LOG_TAG, 'session error', {
        ...ids,
        source: ev.error.type,
        recoverable: 'recoverable' in ev.error ? ev.error.recoverable : null,
        reason: 'error' in ev.error ? (ev.error.error?.constructor.name ?? null) : null,
      })
    })

    // The credential goes when the caller leaves, when the room closes and on shutdown; the
    // API's `/end` and the sweep are the other paths. All idempotent.
    // A quiet caller is still a live call: the row's idle window (3 min) is kept open while the
    // participant is connected, not only when a turn runs.
    const keepalive = setInterval(() => identity.touch(), KEEPALIVE_MS)
    let ended = false
    const endCall = async (reason: string): Promise<void> => {
      if (ended) return
      log('info', LOG_TAG, 'call ending', { ...ids, reason })
      clearInterval(keepalive)
      await call.settle()
      try {
        await identity.end()
        ended = true
      } catch (err) {
        // Not marked ended: the next path (room close, shutdown) tries the delete again.
        log('error', LOG_TAG, 'call end failed', {
          ...ids,
          reason: err instanceof Error ? err.message : String(err),
        })
      }
    }
    ctx.room.on(RoomEvent.ParticipantDisconnected, () => {
      void endCall('participant_disconnected').then(() => ctx.shutdown('participant left'))
    })
    ctx.room.on(RoomEvent.Disconnected, () => {
      void endCall('room_disconnected')
    })
    ctx.addShutdownCallback(() => endCall('shutdown'))

    await session.start({
      agent: new AssistantAgent(call, deps.settings.model),
      room: ctx.room,
      ...startOptions(env),
    })
    await ctx.connect()
    log('info', LOG_TAG, 'connected', { ...ids, request_id: randomUUID() })
    session.say(GREETING_HR)
  },
})

// The CLI (`dev`, `start`) runs only when this file is the process entry; the job runner
// imports it for the default export.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  cli.runApp(
    new ServerOptions({
      agent: fileURLToPath(import.meta.url),
      agentName: env.AGENT_NAME,
      requestFunc: acceptDispatchedJob,
    }),
  )
}
