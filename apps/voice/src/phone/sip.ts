// What LiveKit's SIP service puts on the caller's participant: the attributes documented at
// docs.livekit.io/telephony (`sip.phoneNumber` the caller ID, `sip.trunkPhoneNumber` the number
// dialled, `sip.callID` the SIP call id). Pure; the attribute names live here and nowhere else.

export const SIP_ATTRIBUTES = {
  callerId: 'sip.phoneNumber',
  calledNumber: 'sip.trunkPhoneNumber',
  callId: 'sip.callID',
} as const

export interface SipCall {
  /** The caller ID as presented, raw: `normalizeE164` decides what it is. Null when absent. */
  callerId: string | null
  /** The SIP call id, the session's `external_id`; the room name when the trunk sent none. */
  sipCallId: string
}

export function sipCallOf(attributes: Record<string, string>, room: string): SipCall {
  const callerId = attributes[SIP_ATTRIBUTES.callerId]
  const callId = attributes[SIP_ATTRIBUTES.callId]
  return {
    callerId: callerId === undefined || callerId === '' ? null : callerId,
    sipCallId: callId === undefined || callId === '' ? room : callId,
  }
}
