/*
  The phone channel's caller identities (docs/plan/11-phone-channel.md §2; decision 0012, 0013;
  Landmark's plan §9 ported).

  A caller dials the assistant's number; caller ID is the only thing the trunk hands the worker,
  and it is spoofable. voice_caller_identities maps an enrolled number to a user and holds the
  keypad PIN that authenticates the call (every pilot caller has one, decision 0013), with the
  failure counter and the lockout the worker enforces before any model call. ai_sessions gets
  caller_identity_id so a phone session says which enrolled number it came from without storing
  the number next to the transcript.

  - One active identity per number (partial unique index); an inactive row may keep a number the
    user no longer has. A user may have several numbers ("mobitel", "auto").
  - pin_hash is scrypt (apps/voice/src/phone/pin.ts); null means no PIN, which enrolment refuses
    for every role the worker's PHONE_PIN_ROLES names. Never a PIN in clear.
  - The number is personal data (docs/SECURITY.md → Personal data); the same retention and
    subject-access handling as public.users. It is never logged in clear.

  RLS: service role only in this part, like voice_calls. Enrolment is an admin step in the
  release runbook (SQL as the service role) until the companion app's admin page adds narrow
  policies with their own pgTAP test. anon and authenticated see nothing: a signed-in user must
  not be able to read which numbers are enrolled or their lock state.

  After applying: nothing to do by hand. Regenerate packages/db/src/database.ts with /db-types;
  then enrol the pilot caller (docs/RELEASE-RUNBOOK.md → Enrolling a caller).
*/

CREATE TABLE IF NOT EXISTS public.voice_caller_identities (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  phone_e164          text NOT NULL CHECK (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  label               text,
  pin_hash            text,
  pin_failed_attempts integer NOT NULL DEFAULT 0 CHECK (pin_failed_attempts >= 0),
  pin_locked_until    timestamptz,
  active              boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid REFERENCES public.users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS voice_caller_identities_phone_active_idx
  ON public.voice_caller_identities (phone_e164) WHERE active;
CREATE INDEX IF NOT EXISTS voice_caller_identities_user_id_idx
  ON public.voice_caller_identities (user_id);

ALTER TABLE public.voice_caller_identities ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.voice_caller_identities FROM anon, authenticated;
GRANT ALL ON public.voice_caller_identities TO service_role;

COMMENT ON TABLE public.voice_caller_identities IS
  'Enrolled phone numbers for the phone channel: number -> user, with the keypad PIN hash, the failure counter and the lockout. Service role only; enrolment is an admin step, never over the phone.';
COMMENT ON COLUMN public.voice_caller_identities.phone_e164 IS
  'The caller ID the trunk presents, in E.164. One active row per number. Personal data: never logged in clear.';
COMMENT ON COLUMN public.voice_caller_identities.label IS
  'What the user calls this number ("mobitel", "auto"). Free text, optional.';
COMMENT ON COLUMN public.voice_caller_identities.pin_hash IS
  'scrypt hash of the 4-6 digit keypad PIN (apps/voice/src/phone/pin.ts). Null means no PIN; the worker refuses such a caller for every role PHONE_PIN_ROLES names.';
COMMENT ON COLUMN public.voice_caller_identities.pin_failed_attempts IS
  'Wrong PINs in a row. Reset to 0 by a correct PIN; at PHONE_PIN_MAX_FAILURES the worker sets pin_locked_until.';
COMMENT ON COLUMN public.voice_caller_identities.pin_locked_until IS
  'While in the future the number is refused before any PIN prompt. Set by the worker after too many wrong PINs; cleared by a correct PIN once it has passed.';
COMMENT ON COLUMN public.voice_caller_identities.active IS
  'False keeps the row (its sessions still point at it) but frees the number and refuses calls from it.';
COMMENT ON COLUMN public.voice_caller_identities.created_by IS
  'The admin who enrolled the number, when enrolment went through the app; null for the runbook''s SQL.';

ALTER TABLE public.ai_sessions
  ADD COLUMN IF NOT EXISTS caller_identity_id uuid
    REFERENCES public.voice_caller_identities(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.ai_sessions.caller_identity_id IS
  'For channel ''phone'': the enrolled number the call came from. The number itself stays in voice_caller_identities; null for other channels or once the identity is deleted.';
