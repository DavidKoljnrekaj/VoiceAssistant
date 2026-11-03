# Research note — the car is the use case, the phone call is the channel (2026-11-03)

A read of the skeleton against the product's primary request ("answer email and look things up by
voice while driving") and against what the market does for in-car voice, email agents, Croatian
speech and telephony. The decision it led to is [0012](../decisions/0012-phone-call-first.md); the
work it orders is [the integration roadmap](../plan/10-integration-roadmap.md). Figures from vendor
blogs are marked as such; nothing here was measured by us except the skeleton's own bench.

## 1. Where the skeleton stands

Everything a voice agent usually lacks at launch is already here: one loop behind every channel,
persist-before-emit, default-deny tools with the gate re-applied at dispatch, tools reading as the
user under RLS, and a latency bench with recorded figures (`docs/VOICE.md`):

| Measurement (2026-10-29/30, Sonnet 5.5 at `low`, LiveKit Cloud Frankfurt) | Value          |
| ------------------------------------------------------------------------- | -------------- |
| First audio after end of speech, direct answer                            | 2.4–3.3 s      |
| First audio, one tool call (filler)                                       | 3.5–5.4 s      |
| Whole answer p50 / p95 (bench)                                            | 4.2 s / 9–14 s |
| Barge-in stop (`INTERRUPT_ON=vad`)                                        | 0.31–0.34 s    |

What is missing is the product: no real tool pack, no write protocol, no email, no documents, no
telephony, no native-reviewed Croatian (`CORE-1`, `VOICE-2`), and nowhere the worker runs when a
developer machine is off (`VOICE-1`, `OPS-3`). All of it is listed as seams in
`docs/plan/08-extension-seams.md`; this note changes their order.

## 2. The car: the in-app call cannot be the car channel

The skeleton's voice channel is a WebRTC call inside a browser PWA. In a car that is the weakest
possible delivery:

- **iOS suspends WebRTC and the microphone** when the screen locks or the PWA leaves the
  foreground. The only reported workaround is an audible "heartbeat" audio hack; the supported
  path is a native app with the `voip` or `audio` background mode
  ([Apple developer forum](https://developer.apple.com/forums/thread/774239),
  [WebKit bug 239996](https://bugs.webkit.org/show_bug.cgi?id=239996),
  [a 2026 vendor summary of background modes](https://callsphere.ai/blog/vw4e-ios-background-audio-recording-ai-dictation-2026)).
- **Android Auto allows no third-party voice assistant.** Its app categories are navigation, audio
  and messaging; chatbots are not on the allowlist, Gemini is the only assistant
  ([Android Authority](https://www.androidauthority.com/chatgpt-apple-carplay-vs-android-auto-3653922/)).
- **CarPlay opened an entitlement for conversational voice apps** in February 2026, native only,
  iOS 26.4+, at most three template screens, Siri stays the system assistant
  ([AppleInsider](https://appleinsider.com/articles/26/02/18/ai-agents-are-coming-to-carplay-but-theyre-not-getting-the-keys)).
- So the PWA in a car is a phone on a mount with the screen awake. Croatian traffic law permits
  hands-free calls and not interaction with a hand-held screen while driving.

**The channel that works in every car with no app, no OS permission and no screen is a phone
call.** The driver presses the steering-wheel button, says the assistant's name from contacts, and
the car's Bluetooth hands-free profile carries the audio. The skeleton's own Part 8 §4 ("phone
number via LiveKit SIP") is therefore the car channel, not a later extra. LiveKit was chosen for
the in-app call, and it is the right framework for this too: SIP trunking is native, EU region
pinning is documented (`<sub>.eu.sip.livekit.cloud`, trunk region Dublin or Frankfurt), the same
worker takes the call ([LiveKit EU data residency](https://docs.livekit.io/deploy/admin/regions/data-residency.md),
[LiveKit telephony](https://docs.livekit.io/telephony/)).

Two related findings:

- **LiveKit Connectors** bridge WhatsApp calls and Twilio Media Streams into a room without a SIP
  trunk. A WhatsApp call gives identity for free from the caller's `wa_id` and costs the caller
  nothing; Meta reports user-initiated calls as free on the Calling API. The docs label
  Connectors beta while the blog says GA, so it is the second route, not the first
  ([LiveKit Connectors](https://docs.livekit.io/telephony/connectors.md),
  [announcement](https://livekit.com/blog/introducing-livekit-connectors)).
- **Phone audio is narrowband and noisy.** Soniox's Croatian figures come from clean audio
  ([Soniox, vendor-reported: 1.25 % WER against 1.47–3.16 % for others](https://soniox.com/soniox-app/for/executive-assistants-dictate-correspondence-in-croatian)).
  The first thing to do once a trunk exists is to re-run the call test through a real car over
  Bluetooth: end-of-turn detection and name recognition will behave differently, and the prompt's
  "ask before fetching if a name was heard unsurely" rule will matter more.

The PWA keeps its value as the place where everything said in the car lands afterwards (§5).

## 3. Email: what the market converged on

Compared: Gemini in Android Auto, Microsoft 365 Copilot "voice catch-up" in Outlook mobile,
Speaking Email (iOS and CarPlay), Google's Gmail MCP server, Microsoft's Work IQ mail, and the
email-agent guides from Nylas, MLflow and Sysdig.

- **Gemini in Android Auto** summarises unread mail and pulls details (addresses, bookings) out of
  it by voice; it does not reply, and it cannot be interrupted mid-sentence in the car
  ([Google](https://blog.google/products-and-platforms/platforms/android/android-auto-gemini-tips)).
- **Copilot voice catch-up** (Outlook mobile, licence required, not in the car) is the closest UX
  to the product: it reads recent unread mail in a triage loop and offers flag, pin, archive,
  delete and draft a reply; the user can interrupt and redirect
  ([Microsoft message centre RM516575](https://mc.merill.net/message/RM516575)).
- **Speaking Email** reads one message at a time, skips signatures and disclaimers, replies by
  dictation; its CarPlay edition picks recipients from contacts by voice and reads the message
  back before sending ([Speaking Email CarPlay](https://speakingemailcarplay.com/),
  [App Store](https://apps.apple.com/us/app/speaking-email-voice-reader/id991406423)).
- **Google's Gmail MCP server reads, drafts and labels but does not send**; Google's guidance is
  never to give a model `gmail.send` directly. Microsoft's Work IQ mail can reply but not start a
  thread ([overview](https://www.dragapp.com/blog/best-ai-agents-for-gmail/)).
- **The safety shape every guide agrees on:** read and triage freely, draft by default, send only
  after an explicit confirmation enforced in deterministic code, never by the model's judgement;
  treat email bodies as untrusted data (indirect prompt injection); never hold a send tool when the
  task only reads; keep a recipient allowlist in code; cap sends per user per day; and watch for
  the "confirmation bypass" injection that tells the agent the user already confirmed
  ([Nylas](https://developer.nylas.com/docs/cookbook/agents/prevent-prompt-injection.md),
  [MLflow](https://mlflow.org/articles/prompt-injection-defense/),
  [Sysdig](https://www.sysdig.com/learn-cloud-native/prompt-injection),
  [checklist](https://www.kunalganglani.com/blog/indirect-prompt-injection-ai-agents)).
- **For voice specifically:** speak back recipient by name, subject and gist; only an explicit
  "da" triggers the send tool; never read or dictate addresses, because speech-to-text mishears
  them ([a voice-agent post](https://dev.to/qasim157/voice-agents-that-follow-up-by-email-5ej6)).

What this means for the skeleton:

- Part 8 §2's confirmation protocol is the right shape and needs one sharpening: the confirmation
  must be **unforgeable**. The channel, not the model, issues a one-time confirmation id after the
  user says yes; the send tool refuses without it. A `confirmed: true` written by the model is
  worth nothing.
- Invariant 4 (every voice tool is `readOnly: true`) and the voice prompt ("ne možete unositi
  promjene") both break on purpose when replies are allowed from the car. That is a decision to
  record when the write protocol is built: a write tool reaches voice only with the confirmation
  protocol, and only reply, flag and "remind me" ever reach the car. Delete never does.
- The triage loop needs short item ids ("reply to the second") and a working set in call state,
  because the 20-row history window would drop the current thread mid-triage.
- Provider: Microsoft Graph (delegated OAuth, `offline_access`, refresh tokens encrypted in a
  `user_integrations` row, narrowest scopes, tenant admin consent) if the company is on Microsoft
  365; the same shape with Gmail scopes if it is on Google Workspace. Nylas unifies both at a
  per-mailbox price ([Graph OAuth guide](https://www.unipile.com/microsoft-graph-oauth-email/),
  [Nylas scopes](https://developer.nylas.com/docs/cookbook/use-cases/build/microsoft-oauth-scopes.md)).

## 4. Documents and the company API

- The company API the user plans is the right boundary. It should accept the user's identity so
  permission trimming happens there, return small structured results, and expose **named
  parameterised queries**, never anything that resembles free SQL. That is how Landmark's twelve
  read-only voice tools worked.
- Document search: lexical with Croatian diacritic folding first (Landmark's `help-score.ts`),
  embeddings only if a measurement says so. Enterprise RAG guides in 2026 agree on indexing in place
  with role-based trimming and on agentic re-search, and none covers voice
  ([Datanorth](https://datanorth.ai/blog/what-is-rag),
  [Ragie on SharePoint](https://www.ragie.ai/blog/indexing-enterprise-documents-a-developers-guide-to-integrating-sharepoint-for-rag)).
- **Tool count will hurt voice first.** Email, documents and the database together are 20+ tools.
  Keep the voice allowlist under about a dozen curated tools, consider modes. Anthropic's deferred
  tool loading saves chat context but adds a round trip voice cannot afford
  ([write-up](https://dev.to/gentic_news/how-claude-codes-tool-search-saves-90-of-your-context-window-1j1f)).

## 5. Cross-channel handoff

Nobody in the market does this well, and the schema already supports it: every call turn is
persisted into `ai_sessions`/`ai_messages`. "Stavit ću to u aplikaciju" from the car, and the
driver finds the draft, the document link and the transcript in the PWA at the office. That turns
the PWA's in-car limitation into its role: the review and admin surface.

## 6. Stack check

- **Framework.** LiveKit Agents against Pipecat, Vapi and OpenAI Realtime: the market split is
  managed or single-model for prototypes, open frameworks for custom pipelines and telephony, and
  LiveKit where telephony or scale matters ([comparison](https://futureagi.com/blog/pipecat-alternatives-2026/),
  [AssemblyAI](https://www.assemblyai.com/blog/best-voice-agent-api)). Speech-to-speech models are
  faster but would lose the tool gate, the Croatian quality and persist-before-emit.
- **Speech.** Soniox leads Croatian STT on its own figures; there is no Croatian TTS benchmark
  anywhere, so a native listening test is the only way to judge ElevenLabs there. The open native
  review items are now on the critical path.
- **Cost.** Vendor blogs put a LiveKit pipeline at roughly $0.05–0.18 per minute all-in before the
  model; the figures conflict and none is ours. For one company's users this is not a constraint.
- **Compliance.** Email content will flow to Anthropic, Soniox and ElevenLabs: a DPA with each,
  EU endpoints everywhere, no audio recording, and a transcript retention policy (`OPS-4`,
  `OPS-5`) become mandatory the day email is connected. Phone numbers become personal data in an
  identities table.
- **Local market.** No Croatian product does business email or documents by voice; the local voice
  agents are HZZO's phone assistant and tourism call bots
  ([Dnevnik.hr](https://dnevnik.hr/vijesti/hrvatska/hzzo-od-danas-uvodi-glasovnog-ai-asistenta-hana-za-pozivne-brojeve---919849.html)).

## 7. Order that follows

Hosting for the worker, then the phone number, then the write protocol in chat, then the email
pack read-only and reply, then the company API pack, then the handoff and the PWA as the companion.
A native wrapper only if the in-app call must survive the lock screen. The roadmap is
`docs/plan/10-integration-roadmap.md`.
