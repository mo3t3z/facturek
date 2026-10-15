/// <reference types="vitest/config" />
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { headersFile, securityHeaders } from './src/lib/securityHeaders.ts'

/** Writes dist/_headers with the security headers of src/lib/securityHeaders.ts. */
function securityHeadersFile(supabaseUrl: string | undefined): Plugin {
  return {
    name: 'security-headers-file',
    apply: 'build',
    writeBundle(options) {
      if (!supabaseUrl) throw new Error('VITE_SUPABASE_URL is required to build the security headers')
      writeFileSync(resolve(options.dir ?? 'dist', '_headers'), headersFile(supabaseUrl))
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const supabaseUrl = loadEnv(mode, process.cwd(), 'VITE_').VITE_SUPABASE_URL
  return {
    plugins: [react(), tailwindcss(), securityHeadersFile(supabaseUrl)],
    // `npm run preview` serves the BUILT app with the same headers as production, so the
    // policy can be checked locally before any deployment.
    preview: supabaseUrl ? { headers: securityHeaders(supabaseUrl) } : {},
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      // `npm run test:coverage`. Only the money module is measured, and it must be fully
      // covered: every statement, branch, function and line. The run fails below 100 %.
      coverage: {
        provider: 'v8',
        include: ['src/lib/money/**/*.ts'],
        exclude: ['**/*.test.ts'],
        reporter: ['text'],
        thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
      },
    },
  }
})
