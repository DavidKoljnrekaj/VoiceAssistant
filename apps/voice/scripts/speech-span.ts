// Where a recorded take's speech starts and ends, for the scripted caller's clock. Ported from
// Landmark's tools/voice-prototype/src/speech-span.ts.
//
// An energy threshold can't tell a take's speech from its own noise: Landmark's takes carried
// 0.4–0.8 s of breath and room noise at 10–18 % of peak before the first word. So this runs the
// Silero model offline over the whole take, the way silero-vad's get_speech_timestamps does
// (threshold 0.5, released below 0.35, 100 ms of silence closes a segment, segments under 250 ms
// are dropped), without its padding: the span is the speech itself. Silero is sharp where speech
// begins but its probability lingers 150–300 ms after speech ends, so the end comes from a
// second pass over the reversed take, where it is an onset.
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

import { InferenceSession, Tensor } from 'onnxruntime-node'

const RATE = 16000
const WINDOW = 512 // 32 ms, Silero's window at 16 kHz
const CONTEXT = 64
const THRESHOLD = 0.5
const NEG_THRESHOLD = 0.35
const MIN_SILENCE_MS = 100
const MIN_SPEECH_MS = 250

const MODEL = join(
  dirname(createRequire(import.meta.url).resolve('@livekit/agents-plugin-silero')),
  'silero_vad.onnx',
)
let session: Promise<InferenceSession> | null = null

async function probabilities(pcm: Int16Array): Promise<number[]> {
  session ??= InferenceSession.create(MODEL, {
    interOpNumThreads: 1,
    intraOpNumThreads: 1,
    executionMode: 'sequential',
  })
  const s = await session
  let state = new Float32Array(2 * 128)
  let context = new Float32Array(CONTEXT)
  const sr = new Tensor('int64', BigInt64Array.from([BigInt(RATE)]))
  const out: number[] = []
  for (let off = 0; off + WINDOW <= pcm.length; off += WINDOW) {
    const input = new Float32Array(CONTEXT + WINDOW)
    input.set(context, 0)
    for (let i = 0; i < WINDOW; i++) input[CONTEXT + i] = pcm[off + i]! / 32768
    const r = await s.run({
      input: new Tensor('float32', input, [1, CONTEXT + WINDOW]),
      state: new Tensor('float32', state, [2, 1, 128]),
      sr,
    })
    state = new Float32Array(r.stateN!.data as Float32Array)
    context = input.slice(-CONTEXT)
    out.push((r.output!.data as Float32Array)[0]!)
  }
  return out
}

// Start and end of the first and last segment, in ms from the start of the take.
async function segmentSpanMs(pcm: Int16Array): Promise<[number, number]> {
  const ms = (w: number): number => (w * WINDOW * 1000) / RATE
  const segments: [number, number][] = []
  let start: number | null = null
  let silentFrom: number | null = null
  const p = await probabilities(pcm)
  p.forEach((v, w) => {
    if (v >= THRESHOLD) silentFrom = null
    if (start === null) {
      if (v >= THRESHOLD) start = w
      return
    }
    if (v < NEG_THRESHOLD && silentFrom === null) silentFrom = w
    if (silentFrom !== null && ms(w + 1 - silentFrom) >= MIN_SILENCE_MS) {
      segments.push([start, silentFrom])
      start = null
      silentFrom = null
    }
  })
  if (start !== null) segments.push([start, silentFrom ?? p.length])
  const speech = segments.filter(([a, b]) => ms(b - a) >= MIN_SPEECH_MS)
  if (!speech.length) throw new Error('no speech found in the take')
  return [ms(speech[0]![0]), ms(speech[speech.length - 1]![1])]
}

/** The take's speech, in ms from the start of the file. */
export async function speechSpanMs(pcm: Int16Array): Promise<[number, number]> {
  const [start] = await segmentSpanMs(pcm)
  const [fromEnd] = await segmentSpanMs(pcm.slice().reverse())
  return [start, (pcm.length * 1000) / RATE - fromEnd]
}
