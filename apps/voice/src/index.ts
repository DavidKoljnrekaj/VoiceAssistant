// @va/voice: the LiveKit Agents worker. The process entry is `src/agent.ts` (the agent
// definition is its default export, as LiveKit requires); nothing imports this package. What
// is exported here is the LiveKit-free surface the bench scripts and tests use.
export const PACKAGE_NAME = '@va/voice'

export { CallIdentity, sha256Hex } from './call.js'
export { type VoiceDeps, voiceLoopConfig } from './config.js'
export { parseVoiceEnv, type VoiceEnv } from './env.js'
export { GREETING_HR } from './greeting.js'
export { acceptDispatchedJob, callTokenOf } from './job.js'
export { MAX_MESSAGES, toAnthropicMessages } from './messages.js'
export { installStdoutRedaction, redactLine } from './redact.js'
export { startOptions, turnHandlingOptions, vadFor } from './session-options.js'
export { assertNoContent, createMetrics, type MetricsWriter, turnEntry } from './metrics.js'
export { CallSession, identityCode, MAX_TURNS_PER_CALL } from './session.js'
export { DeferredStore, persistTurn, runVoiceTurn, type VoiceTurnResult } from './turn.js'
export { warm, type WarmResult } from './warm.js'
