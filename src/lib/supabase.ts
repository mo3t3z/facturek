import { createClient } from '@supabase/supabase-js'
import { parseEnv } from './env'

const env = parseEnv(import.meta.env)

// Anon key only: every query runs as the logged-in user and is filtered by RLS.
export const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
  auth: { flowType: 'pkce' },
})
