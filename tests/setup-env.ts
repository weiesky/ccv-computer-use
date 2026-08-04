/**
 * Vitest global setup.
 *
 * Guarantees a clean permission environment for every test file, regardless
 * of the developer's shell: sandbox mode must be OFF by default so existing
 * tests (`keyBlocklist`, `deniedApps`, …) assert the normal gated behavior.
 * Tests that exercise sandbox mode enable it themselves via `vi.stubEnv`
 * (which this file's delete also keeps deterministic).
 */
delete process.env.CCV_SANDBOX_MODE
