// Test runner.
import { test } from 'node:test';
// Assertions.
import assert from 'node:assert/strict';
// Read the Windows launcher to protect its .env opt-in behavior.
import { readFile } from 'node:fs/promises';
// HTTP testing library.
import request from 'supertest';
// App factory.
import { createApp } from '../server/app';
// Loopback check under test.
import { isLoopback } from '../server/local-github';

// The launcher must not override the user's local GitHub CLI opt-in.
test('Windows launcher respects GITHUB_LOCAL_AUTH from .env', async () => {
  const launcher = await readFile(new URL('../run.bat', import.meta.url), 'utf8');
  assert.doesNotMatch(launcher, /^set\s+"?GITHUB_LOCAL_AUTH=/im);
});

// Local sign-in validates the chosen account, rotates CSRF, and keeps credentials on the server.
test('local connection validates the selected account, rotates CSRF, and keeps credentials server-side', async () => {
  // Save the real fetch.
  const originalFetch = globalThis.fetch;
  // Save the environment variables that will change.
  const previous = { local: process.env.GITHUB_LOCAL_AUTH, url: process.env.APP_URL, mode: process.env.NODE_ENV };
  // Enable local auth in a development setup.
  process.env.GITHUB_LOCAL_AUTH = '1'; process.env.APP_URL = 'http://localhost:5173'; process.env.NODE_ENV = 'development';
  // A fake CLI token and a read counter.
  const secret = 'gho_local_test_secret_never_return_to_browser'; let reads = 0;
  // Fake GitHub fetch.
  globalThis.fetch = async (_url, options) => {
    // Verify the token is sent as a Bearer header.
    assert.equal((options?.headers as Record<string, string>).Authorization, `Bearer ${secret}`);
    // Return a fake user.
    return Response.json({ login: 'local-user', name: 'Local User', avatar_url: '', id: 302 });
  };
  // Create the app with a fake local GitHub helper.
  const { app, store } = createApp({ localGitHub: { status: async () => ({ login: 'local-user' }), token: async () => { reads++; return secret; } } });
  // Clean up afterwards.
  try {
    // Client with cookies and an initial session.
    const agent = request.agent(app); const before = await agent.get('/api/session').expect(200);
    // The local login is reported and no user is signed in.
    assert.equal(before.body.localLogin, 'local-user'); assert.equal(before.body.user, null);
    // The token is not exposed.
    assert.ok(!JSON.stringify(before.body).includes(secret));
    // Without CSRF the request is refused.
    await agent.post('/api/connect/local').send({ login: 'local-user' }).expect(403);
    // A foreign Origin is refused.
    await agent.post('/api/connect/local').set('x-csrf-token', before.body.csrf).set('Origin', 'https://attacker.example').send({ login: 'local-user' }).expect(403);
    // The CLI token was never read.
    assert.equal(reads, 0);
    // A different login is a conflict.
    await agent.post('/api/connect/local').set('x-csrf-token', before.body.csrf).send({ login: 'different-user' }).expect(409);
    // Still not signed in.
    assert.equal((await agent.get('/api/session')).body.user, null);
    // The correct login connects.
    const connected = await agent.post('/api/connect/local').set('x-csrf-token', before.body.csrf).send({ login: 'local-user' }).expect(200);
    // The user is returned and the CSRF token changes.
    assert.equal(connected.body.user.login, 'local-user'); assert.notEqual(connected.body.csrf, before.body.csrf);
    // The token is not in the response.
    assert.ok(!JSON.stringify(connected.body).includes(secret));
    // The auth method is local.
    assert.equal((await agent.get('/api/session')).body.authMethod, 'local');
    // Log out.
    await agent.post('/api/logout').set('x-csrf-token', connected.body.csrf).send({}).expect(200);
    // No user afterwards.
    assert.equal((await agent.get('/api/session')).body.user, null);
  } finally {
    // Close the store and restore fetch.
    store.close(); globalThis.fetch = originalFetch;
    // Restore each environment variable.
    for (const [key, value] of Object.entries({ GITHUB_LOCAL_AUTH: previous.local, APP_URL: previous.url, NODE_ENV: previous.mode })) {
      // Delete it if it was not set before.
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

// Local credentials cannot be used in production, from remote origins, or when disabled.
test('local credentials cannot be imported in production, from remote origins, or when disabled', async () => {
  // Environment variables to change.
  const keys = ['GITHUB_LOCAL_AUTH', 'APP_URL', 'NODE_ENV', 'SESSION_SECRET', 'TRUST_PROXY'] as const;
  // Save them and trust loopback proxies.
  const previous = keys.map(key => process.env[key]); let reads = 0; process.env.TRUST_PROXY = 'loopback';
  // Restore afterwards.
  try {
    // Three disallowed setups.
    for (const [mode, url, enabled] of [['production', 'https://localhost', '1'], ['development', 'http://remote.example', '1'], ['development', 'http://localhost:5173', '0']]) {
      // Apply each setup with a strong secret.
      process.env.NODE_ENV = mode; process.env.APP_URL = url; process.env.GITHUB_LOCAL_AUTH = enabled; process.env.SESSION_SECRET = 'a-secure-test-session-secret-at-least-32-bytes';
      // Create the app with fakes that count reads.
      const { app, store } = createApp({ localGitHub: { status: async () => { reads++; return { login: 'local-user' }; }, token: async () => { reads++; return 'must-not-be-read'; } } });
      // Close the store afterwards.
      try {
        // Request a session with the right host and headers.
        const agent = request.agent(app); const session = await agent.get('/api/session').set('Host', new URL(url).host).set('X-Forwarded-Proto', 'https').expect(200);
        // No local login is offered.
        assert.equal(session.body.localLogin, null);
        // Local connect is denied.
        const denied = await agent.post('/api/connect/local').set('Host', new URL(url).host).set('X-Forwarded-Proto', 'https').set('Cookie', session.headers['set-cookie'][0].split(';')[0]).set('x-csrf-token', session.body.csrf).set('Origin', url).send({ login: 'local-user' }).expect(403);
        // The error says local connections work only on this computer.
        assert.match(denied.body.error, /only on this computer/);
      } finally { store.close(); }
    }
    // The CLI was never used.
    assert.equal(reads, 0);
    // Loopback detection works.
    assert.equal(isLoopback('::ffff:127.0.0.1'), true); assert.equal(isLoopback('192.168.1.8'), false);
  // Restore the environment.
  } finally { keys.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; }); }
});
