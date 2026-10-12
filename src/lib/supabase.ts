import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/database.types'
import { parseEnv } from './env'

const env = parseEnv(import.meta.env)

// Anon key only: every query runs as the logged-in user and is filtered by RLS.
export const supabase = createClient<Database>(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
  auth: { flowType: 'pkce' },
})
