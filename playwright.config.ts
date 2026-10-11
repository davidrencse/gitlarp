// Playwright config helper.
import { defineConfig } from '@playwright/test';

// Export the config.
export default defineConfig({
  // Test directory, file pattern, and timeout.
  testDir: './tests', testMatch: '**/*.spec.ts', timeout: 45_000,
  // Browser settings: base URL, viewport, traces on failure, software WebGL.
  use: { baseURL: 'http://localhost:5173', viewport: { width: 1440, height: 1000 }, trace: 'retain-on-failure', launchOptions: { args: ['--enable-unsafe-swiftshader'] } },
  // Simple list output.
  reporter: 'list',
  // Start the dev server before the tests (reuse locally).
  webServer: { command: 'npm run dev', url: 'http://localhost:5173', reuseExistingServer: !process.env.CI, timeout: 60_000 },
});
