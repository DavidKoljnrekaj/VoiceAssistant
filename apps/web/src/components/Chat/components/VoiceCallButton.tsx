import { Loader2, Mic, MicOff, Phone, PhoneOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { VoiceCallState } from '../hooks/useVoiceCall'

interface VoiceCallButtonProps {
  state: VoiceCallState
  muted: boolean
  agentSpeaking: boolean
  onStart: () => void
  onEnd: () => void
  onToggleMute: () => void
}

/** The call button in the chat header: idle → connecting → live (mute, hang up). Props-driven. */
export default function VoiceCallButton({
  state,
  muted,
  agentSpeaking,
  onStart,
  onEnd,
  onToggleMute,
}: VoiceCallButtonProps) {
  const { t } = useTranslation()
  const iconButton = 'rounded-md p-1.5 transition-colors hover:bg-gray-200 dark:hover:bg-gray-700'

  if (state === 'idle') {
    return (
      <button
        type="button"
        onClick={onStart}
        aria-label={t('call.start')}
        title={t('call.start')}
        className={`${iconButton} text-gray-600 dark:text-gray-300`}
        data-testid="call-start"
      >
        <Phone className="h-5 w-5" aria-hidden="true" />
      </button>
    )
  }
  if (state === 'connecting') {
    return (
      <span role="status" aria-label={t('call.connecting')} className="p-1.5 text-gray-500">
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
      </span>
    )
  }
  return (
    <div className="flex items-center gap-1" role="group" aria-label={t('call.live')}>
      <span
        className={`h-2 w-2 rounded-full bg-green-500 ${agentSpeaking ? 'animate-pulse' : ''}`}
        aria-hidden="true"
      />
      <button
        type="button"
        onClick={onToggleMute}
        aria-label={muted ? t('call.unmute') : t('call.mute')}
        title={muted ? t('call.unmute') : t('call.mute')}
        aria-pressed={muted}
        className={`${iconButton} text-gray-600 dark:text-gray-300`}
      >
        {muted ? (
          <MicOff className="h-5 w-5" aria-hidden="true" />
        ) : (
          <Mic className="h-5 w-5" aria-hidden="true" />
        )}
      </button>
      <button
        type="button"
        onClick={onEnd}
        aria-label={t('call.end')}
        title={t('call.end')}
        className={`${iconButton} text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/30`}
      >
        <PhoneOff className="h-5 w-5" aria-hidden="true" />
      </button>
    </div>
  )
}
