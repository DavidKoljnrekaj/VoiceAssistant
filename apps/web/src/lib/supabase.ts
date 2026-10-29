// The one browser Supabase client: auth, and reads under RLS from services. Hooks never import it
// (ESLint, .claude/rules/web.md).
import { createClient } from '@supabase/supabase-js'

import type { Database } from '../types/database'
import { env } from './env'

export const supabase = createClient<Database>(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)
