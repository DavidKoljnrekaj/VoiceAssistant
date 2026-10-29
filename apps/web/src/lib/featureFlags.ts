/**
 * Compile-time switches, as in Landmark: a constant rather than a VITE_ variable, so a flag cannot
 * be on in one deployment and off in another by accident. Flipping one is a code change.
 */

/**
 * The in-app voice call button. On: the API (`POST /voice/sessions`) and the worker exist in this
 * repository. A per-user gate before a trial is `WEB-1`.
 */
export const VOICE_CALLS_ENABLED = true
