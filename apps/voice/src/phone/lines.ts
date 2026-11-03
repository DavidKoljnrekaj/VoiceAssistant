// What a phone caller hears before the model is involved: fixed lines spoken by text-to-speech,
// never model output. The in-app greeting stays in `greeting.ts`. <!-- needs native review -->

export const PHONE_LINES_HR = {
  /** The greeting of a call that needs a PIN: name the assistant, ask for the keypad. */
  greetingPin: 'Dobar dan, ovdje asistent tvrtke. Unesite PIN i pritisnite ljestve.',
  /** The greeting of a call that needs no PIN. */
  greeting: 'Dobar dan, ovdje asistent tvrtke. Izvolite.',
  /** The PIN was right. */
  admitted: 'Hvala. Izvolite.',
  /** After a wrong PIN, with tries left. */
  pinWrong: 'PIN nije točan. Pokušajte ponovno.',
  /** The PIN prompt timed out once; one more chance. */
  pinAgain: 'Nisam primio PIN. Unesite PIN i pritisnite ljestve.',
  /** Too many wrong PINs: the number is locked for a while. */
  pinLocked: 'Previše pogrešnih pokušaja. Pokušajte ponovno za petnaest minuta. Doviđenja.',
  /** Unknown, withheld or unenrolled number. Says nothing about whether the number is known. */
  refused: 'Ovaj broj nije prijavljen za asistenta. Doviđenja.',
  /** The call's cap or the API ended it. */
  goodbye: 'Doviđenja.',
} as const
