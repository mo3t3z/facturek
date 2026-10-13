/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
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
})
