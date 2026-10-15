// The HTTP security headers of the deployed app, in ONE place.
//
// Used twice by vite.config.ts: by `vite preview` (so the built app can be checked locally
// under the same policy) and by the build, which writes them into dist/_headers (the format
// of Netlify and Cloudflare Pages; another host gets the same values in its own format, see
// docs/DEPLOYMENT.md).
//
// Why each one (CLAUDE.md, "TODO at deployment"):
//   * Content-Security-Policy: a SPA keeps its session where JavaScript can read it, so an
//     injected script would BE the user. The policy allows scripts and styles from our own
//     origin only (no inline script, no eval), and network calls to our origin and the ONE
//     Supabase project. frame-ancestors 'none': no other site can frame the app.
//   * X-Content-Type-Options: the browser never guesses a type (a text file run as script).
//   * Referrer-Policy no-referrer: the confirmation link carries a token in its URL
//     (/auth/confirm?token_hash=...); no request may send that URL to anyone.
//   * Permissions-Policy: the app needs no camera, microphone or location.
// No import: vite.config.ts loads this file before any build exists.

/** The origin of the Supabase project ("https://xyz.supabase.co"), never a path. */
function supabaseOrigin(supabaseUrl: string): string {
  const url = new URL(supabaseUrl)
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('VITE_SUPABASE_URL must be http or https')
  return url.origin
}

export function securityHeaders(supabaseUrl: string): Record<string, string> {
  const supabase = supabaseOrigin(supabaseUrl)
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self' ${supabase}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ')
  return {
    'Content-Security-Policy': csp,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  }
}

/** The same headers in the _headers file format: one rule for every path. */
export function headersFile(supabaseUrl: string): string {
  const lines = Object.entries(securityHeaders(supabaseUrl)).map(([name, value]) => `  ${name}: ${value}`)
  return ['/*', ...lines, ''].join('\n')
}
