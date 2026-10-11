// Strict assertions.
import assert from 'node:assert/strict';
// Start child processes.
import { spawn } from 'node:child_process';
// Reserve a local port so the public origin and direct test URL share a host.
import { createServer } from 'node:net';
// File helpers.
import { cp, mkdtemp, rm } from 'node:fs/promises';
// Random secret generator.
import { randomBytes } from 'node:crypto';
// OS temp directory.
import { tmpdir } from 'node:os';
// Path helpers.
import path from 'node:path';

// Install into an isolated temporary directory to prove tsx and other development
// packages are not needed by the deployed process. Never prune the workspace.
// Create an isolated temporary directory.
const directory = await mkdtemp(path.join(tmpdir(), 'gitlarp-production-'));
// Handle to the server process.
let server;
// Everything below is cleaned up in finally.
try {
  // Copy the files needed by the production server.
  for (const item of ['package.json', 'package-lock.json', 'dist', 'server-dist']) await cp(item, path.join(directory, item), { recursive: true });
  // Find npm through the environment variable set by npm run.
  const npm = process.env.npm_execpath;
  // Fail if not started through npm.
  if (!npm) throw new Error('Run this check using npm run test:production.');
  // Install production dependencies only.
  await new Promise((resolve, reject) => {
    // Run npm ci with only production packages.
    const install = spawn(process.execPath, [npm, 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: directory, stdio: 'inherit' });
    // Reject on spawn errors.
    install.on('error', reject);
    // Resolve on success, otherwise fail.
    install.on('exit', code => code === 0 ? resolve() : reject(new Error(`Production dependency installation failed (${code}).`)));
  });
  // Reserve a port before startup so APP_URL can match the Host header exactly.
  const port = await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (!address || typeof address === 'string') return reject(new Error('Could not reserve a local port.'));
      probe.close(error => error ? reject(error) : resolve(address.port));
    });
  });
  // Start the production server in the temp folder.
  server = spawn(process.execPath, ['server-dist/index.js'], { cwd: directory, env: {
    // Production settings: secret, HTTPS URL, and so on.
    ...process.env, NODE_ENV: 'production', SESSION_SECRET: randomBytes(48).toString('hex'), APP_URL: `https://127.0.0.1:${port}`,
    // Proxy trust, random port, loopback host, no OAuth credentials.
    TRUST_PROXY: 'loopback', PORT: String(port), HOST: '127.0.0.1', GITHUB_CLIENT_ID: '', GITHUB_CLIENT_SECRET: '',
  }, stdio: ['ignore', 'pipe', 'pipe'] });
  // Wait for the server to report its port.
  await new Promise((resolve, reject) => {
    // Collect the output for error messages.
    let output = '';
    // Time out after 10 seconds.
    const timeout = setTimeout(() => reject(new Error(`Production server startup timed out: ${output}`)), 10_000);
    // Do not keep the process alive for the timer.
    timeout.unref();
    // Watch stdout.
    server.stdout.on('data', data => {
      // Add to the output.
      output += data;
      // Look for the listening message.
      const match = output.match(/listening at http:\/\/localhost:(\d+)/);
      // Resolve once the reserved port is listening.
      if (match) { clearTimeout(timeout); resolve(Number(match[1])); }
    });
    // Also collect stderr.
    server.stderr.on('data', data => { output += data; });
    // Fail on a spawn error.
    server.on('error', error => { clearTimeout(timeout); reject(error); });
    // Fail if the server exits early.
    server.on('exit', code => { clearTimeout(timeout); reject(new Error(`Production server exited (${code}): ${output}`)); });
  });
  // Server base URL.
  const base = `http://127.0.0.1:${port}`;
  // Fetch the home page.
  const page = await fetch(base); assert.equal(page.status, 200);
  // Check it is HTML.
  const html = await page.text(); assert.match(html, /<!doctype html>/i);
  // Find the entry script path.
  const entry = html.match(/<script[^>]+src="([^"]+)"/i)?.[1]; assert.ok(entry);
  // Check the CSP header.
  assert.match(page.headers.get('content-security-policy') || '', /script-src 'self'/);
  // Fetch the session endpoint as if behind an HTTPS proxy.
  const session = await fetch(`${base}/api/session`, { headers: { 'X-Forwarded-Proto': 'https' } });
  // Check that the response is OK and not cached.
  assert.equal(session.status, 200); assert.equal(session.headers.get('cache-control'), 'no-store');
  // Check the cookie is HttpOnly.
  assert.match(session.headers.get('set-cookie') || '', /HttpOnly/);
  // Check the cookie is Secure.
  assert.match(session.headers.get('set-cookie') || '', /Secure/);
  // Check the cookie is SameSite=Lax.
  assert.match(session.headers.get('set-cookie') || '', /SameSite=Lax/);
  // Check the session JSON shape.
  const data = await session.json(); assert.equal(data.user, null); assert.equal(data.configured, false); assert.ok(data.csrf);
  // Check that protected endpoints return 401.
  assert.equal((await fetch(`${base}/api/repos`)).status, 401);
  // Load Playwright.
  const { chromium } = await import('@playwright/test');
  // Launch a browser.
  const browser = await chromium.launch();
  // Close the browser at the end.
  try {
    // Open a page and set up lists for scripts and errors.
    const view = await browser.newPage(); const scripts = []; const errors = [];
    // Record the JavaScript files requested.
    view.on('request', request => { const pathname = new URL(request.url()).pathname; if (pathname.startsWith('/assets/') && pathname.endsWith('.js')) scripts.push(pathname); });
    // Record page errors.
    view.on('pageerror', error => errors.push(error.message));
    // Open the app and wait for the network to settle.
    await view.goto(base, { waitUntil: 'networkidle' });
    // Check the sign-in heading.
    await view.getByRole('heading', { name: 'Connect your GitHub', exact: true }).waitFor();
    // Check that only the entry script loads at startup.
    assert.deepEqual(scripts, [entry], 'Startup must not download Markdown, Workbench, or ZIP chunks.');
    // No repository cards at startup.
    assert.equal(await view.locator('.repo-card').count(), 0);
    // GitHub sign-in is disabled without OAuth.
    assert.equal(await view.getByRole('button', { name: 'Continue with GitHub' }).isDisabled(), true);
    // Type a short token.
    await view.getByLabel('Fine-grained personal access token (recommended)', { exact: true }).fill('short');
    // A short token keeps the submit button disabled.
    assert.equal(await view.getByRole('button', { name: 'Connect with token' }).isDisabled(), true);
    // Check the WebGL backdrop canvas exists.
    assert.equal(await view.locator('.liquid-backdrop canvas').count(), 1);
    // No page errors.
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
  // Report success.
  console.log('Production smoke check passed: runtime-only server, security headers/cookies, authentication boundary, connection UI, WebGL canvas, and deferred preview chunks.');
// Always clean up.
} finally {
  // Stop the server if it is still running.
  if (server && server.exitCode === null) {
    // Wait for it to exit.
    const stopped = new Promise(resolve => server.once('exit', resolve));
    // Kill the server and wait.
    server.kill(); await stopped;
  }
  // directory comes only from mkdtemp under the OS temporary directory.
  // Safety check: only delete our own temp directory.
  const root = path.resolve(tmpdir()); const target = path.resolve(directory);
  // Refuse anything unexpected.
  if (path.dirname(target) !== root || !path.basename(target).startsWith('gitlarp-production-')) throw new Error('Unexpected temporary directory.');
  // Delete the temporary directory.
  await rm(target, { recursive: true, force: true });
}
