// A thin, injectable wrapper over livekit-server-sdk: the dispatch of our agent into a room and
// the browser's join token. Tests inject a fake that records dispatches and returns a canned
// token; the real one exists only when the three LiveKit variables are set.
import { AccessToken, AgentDispatchClient } from 'livekit-server-sdk'

import type { ApiEnv } from '../env.js'

export interface JoinTokenInput {
  identity: string
  name?: string
  room: string
  ttlSeconds: number
}

export interface LiveKitPort {
  /** The `wss://` URL the browser connects to. */
  url: string
  createDispatch(room: string, agentName: string, metadata: string): Promise<void>
  joinToken(input: JoinTokenInput): Promise<string>
}

export function createLiveKit(
  env: Pick<ApiEnv, 'LIVEKIT_URL' | 'LIVEKIT_API_KEY' | 'LIVEKIT_API_SECRET'>,
): LiveKitPort | null {
  const { LIVEKIT_URL: url, LIVEKIT_API_KEY: apiKey, LIVEKIT_API_SECRET: apiSecret } = env
  if (!url || !apiKey || !apiSecret) return null
  const dispatch = new AgentDispatchClient(url.replace(/^ws/, 'http'), apiKey, apiSecret)
  return {
    url,
    async createDispatch(room, agentName, metadata) {
      await dispatch.createDispatch(room, agentName, { metadata })
    },
    async joinToken(input) {
      const at = new AccessToken(apiKey, apiSecret, {
        identity: input.identity,
        ...(input.name ? { name: input.name } : {}),
        ttl: input.ttlSeconds,
      })
      at.addGrant({
        roomJoin: true,
        room: input.room,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
      })
      return await at.toJwt()
    },
  }
}
