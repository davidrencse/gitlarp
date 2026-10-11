// Test runner.
import { test } from 'node:test';
// Assertions.
import assert from 'node:assert/strict';
// HTTP testing library.
import request from 'supertest';
// Random ids.
import { randomUUID } from 'node:crypto';
// App factory.
import { createApp } from '../server/app';
// Publish validation.
import { publishSchema, validatePlan } from '../server/publish';
// File generator.
import { generateFiles } from '../shared/generator';
// Fixtures.
import { fixtureContext, fixtureRepos } from './fixtures/projects';
// Plan type.
import type { Plan } from '../shared/types';
// Express (for the rate limit test).
import express from 'express';
// Rate limiter under test.
import { rateLimit } from '../server/rate-limit';

// The session exposes no token and anonymous repository access is rejected.
test('session exposes no token and unauthenticated repository access is rejected', async () => {
  // Create the app.
  const { app, store } = createApp();
  // Close the store afterwards.
  try {
    // Fetch the session.
    const session = await request(app).get('/api/session').expect(200);
    // No user.
    assert.equal(session.body.user, null);
    // A CSRF token exists.
    assert.ok(session.body.csrf);
    // No token field.
    assert.equal(session.body.token, undefined);
    // Repositories require sign-in.
    await request(app).get('/api/repos').expect(401);
    // Creating a repository requires CSRF.
    await request(app).post('/api/repositories').send({ name: 'test' }).expect(403);
    // A bad OAuth callback redirects with an error.
    await request(app).get('/auth/github/callback?code=invalid&state=invalid').expect(302).expect('Location', '/?auth_error=authorization_failed');
  // Close the store.
  } finally { store.close(); }
});
// Write routes require CSRF and a matching origin even with a session.
test('write routes enforce CSRF and origin even when a session exists', async () => {
  // Create the app.
  const { app, store } = createApp();
  // Close the store afterwards.
  try {
    // Client with cookies.
    const agent = request.agent(app);
    // Get a session.
    const session = await agent.get('/api/session');
    // No CSRF header: refused.
    await agent.post('/api/logout').send({}).expect(403);
    // Foreign origin: refused.
    await agent.post('/api/logout').set('x-csrf-token', session.body.csrf).set('Origin', 'https://attacker.example').send({}).expect(403);
    // Valid CSRF: success.
    await agent.post('/api/logout').set('x-csrf-token', session.body.csrf).send({}).expect(200);
  // Close the store.
  } finally { store.close(); }
});
// Publish validation rejects arbitrary paths, duplicates, stale plans, and branch injection.
test('publish rejects arbitrary paths, duplicate files, stale plans, and branch injection', () => {
  // Fixture context.
  const context = fixtureContext(fixtureRepos[0]);
  // Build a plan.
  const plan: Plan = { id: randomUUID(), repo: context.repo, head: context.head, createdAt: new Date().toISOString(), ...generateFiles(context, ['readme']) };
  // Valid input.
  const input = publishSchema.parse({ planId: plan.id, target: 'branch', branch: 'docs/improvements', createPr: true, files: plan.files.map(f => ({ path: f.path, content: f.content })), messages: plan.commits.map(c => c.message) });
  // It is accepted.
  assert.doesNotThrow(() => validatePlan(plan, input));
  // A different path is rejected.
  assert.throws(() => validatePlan(plan, { ...input, files: [{ path: '../secret', content: 'x' }] }), /match the reviewed plan/);
  // Duplicate files are rejected.
  assert.throws(() => validatePlan(plan, { ...input, files: [...input.files, ...input.files] }), /match the reviewed plan/);
  // An old plan has expired.
  assert.throws(() => validatePlan({ ...plan, createdAt: '2000-01-01T00:00:00Z' }, input), /expired/);
  // A branch with shell characters is invalid.
  assert.equal(publishSchema.safeParse({ ...input, branch: 'main; rm -rf' }).success, false);
  // A double slash in a branch is invalid.
  assert.equal(publishSchema.safeParse({ ...input, branch: 'docs//bad' }).success, false);
  // A custom commit author cannot inject extra Git identity headers.
  const history = { authorName: 'Ada Lovelace', authorEmail: 'ada@example.com', from: '2024-01-01T10:00:00.000Z', to: '2024-06-01T10:00:00.000Z' };
  assert.equal(publishSchema.safeParse({ ...input, history: { ...history, authorName: 'Ada\ncommitter Injected' } }).success, false);
  // A file over 250 KB is invalid.
  assert.equal(publishSchema.safeParse({ ...input, files: [{ path: 'README.md', content: '😀'.repeat(80_000) }] }).success, false);
  // An invalid date counts as expired.
  assert.throws(() => validatePlan({ ...plan, createdAt: 'invalid-date' }, input), /expired/);
});

// Oversized and malformed bodies return accurate client errors.
test('oversized and malformed request bodies return accurate client errors', async () => {
  // Create the app.
  const { app, store } = createApp();
  // Close the store afterwards.
  try {
    // A huge body returns 413.
    const response = await request(app).post('/api/plans').send({ content: 'x'.repeat(2_100_000) }).expect(413);
    // The response is not cached.
    assert.equal(response.headers['cache-control'], 'no-store');
    // Invalid JSON returns 400.
    await request(app).post('/api/plans').set('Content-Type', 'application/json').send('{invalid').expect(400);
  // Close the store.
  } finally { store.close(); }
});

// Production rejects weak secrets, plain HTTP, and APP_URL paths.
test('production rejects weak secrets, plain HTTP, and APP_URL paths', () => {
  // Save the environment variables.
  const previous = { NODE_ENV: process.env.NODE_ENV, SESSION_SECRET: process.env.SESSION_SECRET, APP_URL: process.env.APP_URL };
  // Restore afterwards.
  try {
    // Production with a short secret.
    process.env.NODE_ENV = 'production'; process.env.APP_URL = 'https://gitlarp.example'; process.env.SESSION_SECRET = 'short';
    // Rejected for the secret.
    assert.throws(createApp, /SESSION_SECRET/);
    // A strong secret but an HTTP URL.
    process.env.SESSION_SECRET = 'a'.repeat(48); process.env.APP_URL = 'http://gitlarp.example';
    // Rejected for needing HTTPS.
    assert.throws(createApp, /HTTPS/);
    // A URL with a path is rejected.
    process.env.APP_URL = 'https://gitlarp.example/nested'; assert.throws(createApp, /origin/);
  // Restore the environment.
  } finally {
    // Restore each variable.
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

// Throttling respects the retry window and ignores spoofed IPs.
test('request throttling respects its retry window and does not trust spoofed client IPs', async () => {
  // Fake clock.
  let clock = 0;
  // App allowing 2 requests per second.
  const app = express(); app.use(rateLimit(2, 1000, () => clock)); app.get('/', (_req, res) => res.json({ ok: true }));
  // First request, with a spoofed IP.
  await request(app).get('/').set('X-Forwarded-For', '1.2.3.4').expect(200);
  // Second request, with another spoofed IP.
  await request(app).get('/').set('X-Forwarded-For', '2.3.4.5').expect(200);
  // Third request is limited with Retry-After 1.
  await request(app).get('/').set('X-Forwarded-For', '3.4.5.6').expect(429).expect('Retry-After', '1');
  // After the window it works again.
  clock = 1001; await request(app).get('/').expect(200);
});

// Requests with an unexpected Host header are rejected.
test('requests with an unexpected Host header are rejected', async () => {
  // Create the app.
  const { app, store } = createApp();
  // A bad host gets 421; localhost works.
  try { await request(app).get('/api/session').set('Host', 'evil.example').expect(421); await request(app).get('/api/session').set('Host', 'localhost:5173').expect(200); }
  // Close the store.
  finally { store.close(); }
});
