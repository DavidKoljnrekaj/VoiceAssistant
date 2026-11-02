// @va/db: generated Supabase types, the two client factories, the env schema and the values
// the schema fixes (`voice-calls.ts`). No queries.
export { createServiceClient, createUserClient, type DbClient } from './clients.js'
export type { Database, Json, Tables, TablesInsert, TablesUpdate, Enums } from './database.js'
export { dbEnvSchema, getDbEnv, parseDbEnv, resetDbEnvCache, type DbEnv } from './env.js'
export { VOICE_CALL_IDLE_MS } from './voice-calls.js'
