import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // 60s: stdio-server integration tests cold-start slowly on loaded CI runners.
    testTimeout: 60000,
    hookTimeout: 30000,
  },
})
