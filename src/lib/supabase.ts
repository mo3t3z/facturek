import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/database.types'
import { parseEnv } from './env'

const env = parseEnv(import.meta.env)

// Anon key only: every query runs as the logged-in user and is filtered by RLS.
export const supabase = createClient<Database>(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
  auth: {
    // supabase-js stores and refreshes the session itself. We never touch the tokens.
    persistSession: true,
    autoRefreshToken: true,
    // Our email links carry a token_hash that /auth/confirm verifies explicitly. Nothing
    // in this app ever expects tokens in the URL, so the client must not read them from it.
    detectSessionInUrl: false,
  },
})
