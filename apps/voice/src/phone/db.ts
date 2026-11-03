// The phone channel's tables come from `@va/db`'s generated `Database` (migration
// 20261103120000_phone_channel.sql, `/db-types` run 2026-11-03, `REL-10`). What stays here is the
// row type the modules share.
import type { Tables } from '@va/db'

export type CallerIdentityRow = Tables<'voice_caller_identities'>
