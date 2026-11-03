# 0012 — The phone call is the first voice channel; the PWA is the companion

## Context

The product's primary request is a voice assistant used while driving: hear and answer email,
look through company documents and data. The skeleton's voice channel is a WebRTC call inside the
browser PWA. Research on 2026-11-03 (`docs/research/2026-11-03-call-first.md`) found that this
cannot be the car channel: iOS suspends WebRTC and the microphone when the screen locks or the PWA
leaves the foreground, Android Auto admits no third-party voice assistant, and CarPlay's new
entitlement for conversational apps is native-only. A phone call over the car's Bluetooth
hands-free profile works in every car with no app, no OS permission and no screen, and the
skeleton's own seam for it (Part 8 §4, LiveKit SIP into the same worker) was waiting on "v1 voice
in production".

## Decision

The phone number (LiveKit SIP trunk into the existing worker, channel `phone`) is built next, before
WhatsApp text and before any further PWA work beyond what the phone channel needs (caller
enrolment). The in-app call stays as built and remains the desk and test channel; the PWA becomes
the companion surface: the place where every call's turns, drafts and document links are reviewed
afterwards, and where callers are enrolled. A native wrapper for the in-app call is considered only
if the companion needs a call that survives the lock screen. Alternatives: a native app with the
`voip` background mode first (weeks of platform work, still shut out of Android Auto, and the
phone call is needed anyway for cars without CarPlay); WhatsApp calling through LiveKit Connectors
first (identity for free, but the connector is labelled beta and callers must have WhatsApp); keep
the plan's order and ship the PWA call to drivers (unusable on a locked phone).

## Consequences

Part 8's seam order changes: hosting (`VOICE-1`, `OPS-3`) becomes a prerequisite, the phone channel
is Part 11 (`docs/plan/11-phone-channel.md`), the write protocol and email follow it, WhatsApp
moves behind them. Caller identity (caller ID plus a DTMF PIN for roles that hear sensitive data,
a server-minted short-lived JWT so RLS still applies) is the first real security feature of the
product and is reviewed as such. The channel table gains a `phone` column that inherits the voice
settings. The PWA's call button stays behind its flag (`WEB-1`) and its lock-screen limitation is
recorded (`WEB-16`). Everything a caller says in the car is persisted as a session the PWA shows,
so the handoff ("I will put it in the app") needs no new storage.

## Date

2026-11-03
