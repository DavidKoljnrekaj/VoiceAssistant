// Scripted caller: signs in as a test user, starts a call through the API (`POST
// /voice/sessions`, as the call button does), joins the room it returns, plays recorded
// questions into it as its "microphone", and timestamps the agent's audio as it arrives.
// Measures from the caller's side, transport included. Ported from Landmark's
// tools/voice-prototype/src/call-test.ts; the worker takes only dispatched jobs, so there is no
// local-room path.
//
//   latency  = end of the question's speech -> first audible agent audio
//   barge-in = start of an interrupting question -> agent audio goes quiet
//
//   node --import tsx scripts/call-test.ts latency <wav> [<wav> ...]    16 kHz mono 16-bit takes
//   node --import tsx scripts/call-test.ts bargein <wav> [<wav> ...]    the take must provoke a long answer
//   node --import tsx scripts/call-test.ts ask     <wav> [<wav> ...]    asks each; prints what was heard and said
//
//   VA_API_URL (http://localhost:3000), SUPABASE_URL, SUPABASE_ANON_KEY, VA_EMAIL, VA_PASSWORD
//
// Results go to logs/calltest.jsonl (timings only) and the console, tagged with LABEL if set
// (e.g. LABEL=stt for the worker's INTERRUPT_ON, which the caller can't see). "Start" and "end" of
// a take's speech come from scripts/speech-span.ts (Silero, offline), not from its loudness. In
// `ask` mode what the agent heard and said is printed to the console for the person running the
// script; it is never written to the log. Recorded WAVs stay outside the repo.
import { readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  AudioFrame,
  AudioSource,
  AudioStream,
  LocalAudioTrack,
  type RemoteTrack,
  Room,
  RoomEvent,
  TrackKind,
  TrackPublishOptions,
  TrackSource,
} from '@livekit/rtc-node'

import { createMetrics } from '../src/metrics.js'
import { speechSpanMs } from './speech-span.js'

const metrics = createMetrics(
  process.env.VOICE_LOGS_DIR ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'logs'),
)
const RATE = 16000
const FRAME = 160 // 10 ms
const LOUD = 600 // int16 RMS above which an agent frame counts as speech
// This much quiet means the agent stopped. Its own pauses between phrases run past 300 ms, and
// once interrupted it stays quiet until it answers the interrupting take, 2 s or more later.
const QUIET_MS = 1000

function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback
  if (!v) throw new Error(`${name} is not set`)
  return v
}

function readWav(path: string): Int16Array {
  const buf = readFileSync(path)
  if (buf.toString('ascii', 0, 4) !== 'RIFF') throw new Error(`${path}: not a WAV file`)
  let off = 12
  let fmtOk = false
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4)
    const size = buf.readUInt32LE(off + 4)
    if (id === 'fmt ')
      fmtOk =
        buf.readUInt16LE(off + 10) === 1 &&
        buf.readUInt32LE(off + 12) === RATE &&
        buf.readUInt16LE(off + 22) === 16
    if (id === 'data') {
      if (!fmtOk) throw new Error(`${path}: expected 16 kHz mono 16-bit`)
      return new Int16Array(buf.buffer.slice(buf.byteOffset + off + 8, buf.byteOffset + off + 8 + size))
    }
    off += 8 + size + (size % 2)
  }
  throw new Error(`${path}: no data chunk`)
}

const rms = (x: Int16Array): number => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / Math.max(1, x.length))
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

type Take = { name: string; pcm: Int16Array; speechMs: [number, number] }

function logRow(entry: Record<string, unknown>): void {
  void metrics.write('calltest.jsonl', { label: process.env.LABEL ?? null, ...entry })
  console.log(JSON.stringify(entry))
}

/** The call through the API, as the call button starts it. */
async function connection(): Promise<{ url: string; token: string; room: string; end: () => Promise<void> }> {
  const supabaseUrl = env('SUPABASE_URL')
  const login = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: env('SUPABASE_ANON_KEY'), 'content-type': 'application/json' },
    body: JSON.stringify({ email: env('VA_EMAIL'), password: env('VA_PASSWORD') }),
  })
  if (!login.ok) throw new Error(`sign-in failed: ${login.status}`)
  const { access_token: jwt } = (await login.json()) as { access_token: string }
  const api = env('VA_API_URL', 'http://localhost:3000')
  const call = (path: string) =>
    fetch(`${api}${path}`, { method: 'POST', headers: { authorization: `Bearer ${jwt}` } })
  const started = await call('/voice/sessions')
  if (!started.ok) throw new Error(`POST /voice/sessions failed: ${started.status} ${await started.text()}`)
  const s = (await started.json()) as { url: string; token: string; room: string; session_id: string }
  return {
    url: s.url,
    token: s.token,
    room: s.room,
    end: async () => {
      await call(`/voice/sessions/${s.session_id}/end`)
    },
  }
}

async function main(): Promise<void> {
  const [mode, ...wavs] = process.argv.slice(2)
  if (!mode || !['latency', 'bargein', 'ask'].includes(mode) || !wavs.length) {
    console.error('usage: node --import tsx scripts/call-test.ts latency|bargein|ask <wav> [<wav> ...]')
    process.exit(2)
  }
  const takes: Take[] = []
  for (const wav of wavs) {
    const pcm = readWav(wav)
    takes.push({ name: basename(wav), pcm, speechMs: await speechSpanMs(pcm) })
  }
  const conn = await connection()

  // Agent audio: the time of the latest loud frame, and of its first loud frame after a mark.
  let lastLoudAt = 0
  const loudTimes: number[] = [] // every loud agent frame, for the barge-in timeline
  let firstLoudAfter: { mark: number; at: number | null } = { mark: Infinity, at: null }
  const room = new Room()
  // What the agent heard (the caller's speech, transcribed) and what it said, as LiveKit
  // publishes them. Console only.
  const transcripts: Array<{ from: 'caller' | 'agent'; text: string }> = []
  room.registerTextStreamHandler('lk.transcription', (reader, sender) => {
    void reader.readAll().then((text) => {
      const own = sender.identity === room.localParticipant?.identity
      const trackId = reader.info.attributes?.['lk.transcribed_track_id']
      const trackOwnerIsCaller =
        trackId !== undefined && room.localParticipant?.trackPublications.has(trackId)
      const from = own || trackOwnerIsCaller ? 'caller' : 'agent'
      // Each interim version of the caller's speech is its own stream; only the final one counts.
      if (from === 'caller' && reader.info.attributes?.['lk.transcription_final'] === 'false') return
      if (text.trim()) transcripts.push({ from, text: text.trim() })
    })
  })
  room.on(RoomEvent.TrackSubscribed, async (track: RemoteTrack) => {
    if (track.kind !== TrackKind.KIND_AUDIO) return
    for await (const frame of new AudioStream(track, RATE, 1)) {
      if (rms(frame.data) > LOUD) {
        const now = performance.now()
        lastLoudAt = now
        loudTimes.push(now)
        if (firstLoudAfter.at === null && now > firstLoudAfter.mark) firstLoudAfter.at = now
      }
    }
  })
  await room.connect(conn.url, conn.token, { autoSubscribe: true, dynacast: false })

  // The "microphone": real-time 10 ms frames, silence whenever no take is playing. A 50 ms
  // queue, not the default 1000 ms: captureFrame() returns when a frame is queued, so a long
  // queue would put every "sent" timestamp up to a second ahead of the real audio.
  const source = new AudioSource(RATE, 1, 50)
  await room.localParticipant!.publishTrack(
    LocalAudioTrack.createAudioTrack('mic', source),
    new TrackPublishOptions({ source: TrackSource.SOURCE_MICROPHONE }),
  )
  let queue: Int16Array[] = []
  let onFrameSent = null as ((left: number) => void) | null
  let lastStartWall = 0 // Date.now() of the latest take's speech start, comparable with the worker's log
  let playing = false
  const silence = new Int16Array(FRAME)
  void (async () => {
    for (;;) {
      const f = queue.shift()
      if (f) playing = true
      await source.captureFrame(new AudioFrame(f ?? silence, RATE, 1, FRAME))
      if (f) onFrameSent?.(queue.length)
      if (!queue.length) playing = false
    }
  })()

  // Play a take; resolve with the performance.now() of its first frame and its speech start and end frames.
  function play({ pcm, speechMs }: Take): Promise<{ played: number; start: number; end: number }> {
    const s = Math.floor(speechMs[0] / 10)
    const e = Math.min(Math.ceil(speechMs[1] / 10), Math.floor(pcm.length / FRAME)) - 1
    const frames = Array.from({ length: Math.floor(pcm.length / FRAME) }, (_, i) =>
      pcm.slice(i * FRAME, (i + 1) * FRAME),
    )
    const total = frames.length
    return new Promise((resolve) => {
      let played = 0
      let start = 0
      onFrameSent = (left) => {
        const idx = total - 1 - left
        if (idx === 0) played = performance.now()
        if (idx === s) {
          start = performance.now()
          lastStartWall = Date.now()
        }
        if (idx === e) {
          onFrameSent = null
          resolve({ played, start, end: performance.now() })
        }
      }
      queue = frames
    })
  }
  async function untilAgentQuiet(maxMs = 30000, quietMs = 1500): Promise<void> {
    const t0 = performance.now()
    while (performance.now() - t0 < maxMs) {
      if (lastLoudAt && performance.now() - lastLoudAt > quietMs && !playing) return
      await sleep(50)
    }
  }

  console.log(`room ${conn.room}: waiting for the agent's greeting...`)
  const t0 = performance.now()
  while (!lastLoudAt && performance.now() - t0 < 20000) await sleep(50)
  if (!lastLoudAt) throw new Error('no agent audio within 20 s: is the worker running with AGENT_NAME?')
  await untilAgentQuiet()

  for (const take of takes) {
    const speech_ms = take.speechMs.map(Math.round)
    if (mode === 'ask') {
      // A real answer can pause after its filler sentence while tools run, so "done" is 4 s of quiet.
      const mark = transcripts.length
      firstLoudAfter = { mark: Infinity, at: null }
      const { end } = await play(take)
      firstLoudAfter.mark = end
      const tWait = performance.now()
      while (firstLoudAfter.at === null && performance.now() - tWait < 20000) await sleep(10)
      await untilAgentQuiet(60000, 4000)
      await sleep(500) // the last transcript segment lands after the audio
      const since = transcripts.slice(mark)
      const heard = since
        .filter((t) => t.from === 'caller')
        .map((t) => t.text)
        .join(' ')
      const said = since
        .filter((t) => t.from === 'agent')
        .map((t) => t.text)
        .join(' ')
      logRow({
        mode,
        take: take.name,
        speech_ms,
        latency_ms: firstLoudAfter.at === null ? null : Math.round(firstLoudAfter.at - end),
        heard_len: heard.length,
        said_len: said.length,
      })
      console.log(`  heard: ${heard}\n  said:  ${said}`)
    } else if (mode === 'latency') {
      firstLoudAfter = { mark: Infinity, at: null }
      const { end } = await play(take)
      firstLoudAfter.mark = end
      const tWait = performance.now()
      while (firstLoudAfter.at === null && performance.now() - tWait < 10000) await sleep(10)
      logRow({
        mode,
        take: take.name,
        speech_ms,
        latency_ms: firstLoudAfter.at === null ? null : Math.round(firstLoudAfter.at - end),
      })
      await untilAgentQuiet()
    } else {
      // Ask for a long answer with this take, then interrupt it 2 s into the agent's speech with the same take.
      firstLoudAfter = { mark: Infinity, at: null }
      const { end } = await play(take)
      firstLoudAfter.mark = end
      const tWait = performance.now()
      while (firstLoudAfter.at === null && performance.now() - tWait < 10000) await sleep(10)
      if (firstLoudAfter.at === null) {
        logRow({ mode, take: take.name, speech_ms, error: 'no answer to interrupt' })
        continue
      }
      await sleep(2000)
      const { played, start, end: interruptEnd } = await play(take)
      firstLoudAfter = { mark: interruptEnd, at: null } // the agent's answer to the interruption, waited for below
      // Timeline: loud/quiet runs of the agent's audio from 1 s before to 4 s after the interruption.
      await sleep(Math.max(0, start + 4000 - performance.now()))
      const runs: string[] = []
      let runStart: number | null = null
      let prev = -Infinity
      for (const t of loudTimes.filter((t) => t >= start - 1000 && t <= start + 4000)) {
        if (runStart === null) runStart = t
        else if (t - prev > 60) {
          runs.push(`${Math.round(runStart - start)}..${Math.round(prev - start)}`)
          runStart = t
        }
        prev = t
      }
      if (runStart !== null) runs.push(`${Math.round(runStart - start)}..${Math.round(prev - start)}`)
      // Stop = the end of the loud stretch the agent was in when the take began playing: the last
      // loud frame before QUIET_MS of quiet. Followed from the take's first frame, not its first
      // word, because Silero can fire on the breath before the word; such a stop comes out negative.
      const before = loudTimes.filter((t) => t < played)
      let stopped: number = before.length ? before[before.length - 1]! : played
      for (const t of loudTimes.filter((t) => t >= played)) {
        if (t - stopped >= QUIET_MS) break
        stopped = t
      }
      // A try only counts if the agent was talking when the take began; otherwise there was nothing to stop.
      if (!loudTimes.some((t) => t >= played - 300 && t < played)) {
        logRow({
          mode,
          take: take.name,
          speech_ms,
          start_wall: lastStartWall,
          error: 'agent not speaking when the interruption began',
          loud_runs_ms: runs.join(' '),
        })
      } else {
        logRow({
          mode,
          take: take.name,
          speech_ms,
          start_wall: lastStartWall,
          stop_ms: Math.round(stopped - start),
          loud_runs_ms: runs.join(' '),
        })
      }
      // The agent answers the interrupting take, sometimes only after the 4 s window: wait for
      // that answer to start and finish, or the next question lands on top of it.
      const tAnswer = performance.now()
      while (firstLoudAfter.at === null && performance.now() - tAnswer < 10000) await sleep(10)
      await untilAgentQuiet()
    }
  }
  await room.disconnect()
  await conn.end()
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
