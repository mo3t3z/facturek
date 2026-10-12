import { z } from 'zod'

// Everything prefixed VITE_ is compiled into the JavaScript bundle and is therefore PUBLIC.
// Only two values are allowed there: the project URL and the anon / publishable key.

/** Decodes the payload of a JWT without verifying it. Returns null if it is not a JWT. */
function jwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.')
  if (parts.length !== 3 || parts[1] === undefined) return null
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const json = atob(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '='))
    const payload: unknown = JSON.parse(json)
    return typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** True for any key that must never reach a browser. */
export function isPrivilegedKey(key: string): boolean {
  if (key.startsWith('sb_secret_')) return true
  return jwtPayload(key)?.role === 'service_role'
}

const envSchema = z.object({
  // http(s) only: the value is used as the base of every API request.
  VITE_SUPABASE_URL: z.url().refine((value) => /^https?:\/\//i.test(value), { message: 'not http(s)' }),
  VITE_SUPABASE_ANON_KEY: z
    .string()
    .min(1)
    .refine((key) => !isPrivilegedKey(key), { message: 'privileged key' }),
})

export type Env = z.infer<typeof envSchema>

/**
 * Fails fast at startup. The error names the variables that are wrong and NEVER contains
 * their values, so a key cannot end up in a console or an error report.
 */
export function parseEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse({
    VITE_SUPABASE_URL: raw.VITE_SUPABASE_URL,
    VITE_SUPABASE_ANON_KEY: raw.VITE_SUPABASE_ANON_KEY,
  })
  if (!result.success) {
    const privileged = result.error.issues.some((issue) => issue.message === 'privileged key')
    if (privileged) {
      throw new Error(
        'VITE_SUPABASE_ANON_KEY holds a SECRET / service_role key. That key bypasses all row level security and must never be shipped to a browser. Use the anon (publishable) key.',
      )
    }
    const names = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].join(', ')
    throw new Error(`Invalid environment variables: ${names}. See .env.example.`)
  }
  return result.data
}
