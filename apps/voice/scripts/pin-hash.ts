// Prints the scrypt hash of a keypad PIN for the enrolment SQL in docs/RELEASE-RUNBOOK.md →
// Enrolling a caller. The PIN is read from the terminal, never from argv (argv lands in shell
// history and process listings), and nothing but the hash is printed.
//
//   pnpm --filter @va/voice pin-hash
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'

import { hashPin, PIN_MAX_DIGITS, PIN_MIN_DIGITS } from '../src/phone/pin.js'

const rl = createInterface({ input: stdin, output: stdout })
const pin = (await rl.question(`PIN (${PIN_MIN_DIGITS}-${PIN_MAX_DIGITS} digits): `)).trim()
rl.close()
try {
  stdout.write(`${await hashPin(pin)}\n`)
} catch (err) {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
}
