// Test runner.
import { test } from 'node:test';
// Assertions.
import assert from 'node:assert/strict';
// HTTP testing library.
import request from 'supertest';
// App factory.
import { createApp } from '../server/app';
// Fixtures.
import { fixtureContext, fixtureRepos } from './fixtures/projects';

// Token sign-in needs CSRF, regenerates the session, and never returns credentials.
test('token connection requires CSRF, regenerates the session, and never returns credentials', async () => {
  // Save the real fetch.
  const originalFetch = globalThis.fetch;
  // A fake token.
  const token = 'github_pat_integration_secret_not_for_browser_storage';
  // Fake GitHub fetch.
  globalThis.fetch = async (_url, options) => {
    // Verify the token is sent as a Bearer header.
    assert.equal((options?.headers as Record<string, string>).Authorization, `Bearer ${token}`);
    // Return a fake user.
    return Response.json({ login: 'real-user', name: 'Real User', avatar_url: '', id: 200 });
  };
  // Create the app.
  const { app, store } = createApp();
  // Clean up afterwards.
  try {
    // Create a client with cookies and fetch a session.
    const agent = request.agent(app); const before = await agent.get('/api/session').expect(200);
    // Without CSRF the request is refused.
    await agent.post('/api/connect').send({ token }).expect(403);
    // A foreign Origin is refused.
    await agent.post('/api/connect').set('x-csrf-token', before.body.csrf).set('Origin', 'https://attacker.example').send({ token }).expect(403);
    // With CSRF it works.
    const connected = await agent.post('/api/connect').set('x-csrf-token', before.body.csrf).send({ token }).expect(200);
    // The user is returned and the CSRF token changes.
    assert.equal(connected.body.user.login, 'real-user'); assert.notEqual(connected.body.csrf, before.body.csrf);
    // The token is not in the response.
    assert.ok(!JSON.stringify(connected.body).includes(token));
    // Fetch the session again.
    const session = await agent.get('/api/session').expect(200);
    // Auth method is token, and the token is not leaked.
    assert.equal(session.body.authMethod, 'token'); assert.ok(!JSON.stringify(session.body).includes(token));
    // Log out.
    await agent.post('/api/logout').set('x-csrf-token', connected.body.csrf).send({}).expect(200);
    // The session has no user afterwards.
    assert.equal((await agent.get('/api/session')).body.user, null);
  // Close the store and restore fetch.
  } finally { store.close(); globalThis.fetch = originalFetch; }
});

// Invalid tokens fail; a valid token can publish through the real routes.
test('invalid tokens fail and a token-backed project publishes through the real API routes', async () => {
  // Save fetch.
  const originalFetch = globalThis.fetch;
  // Fixture data and counters.
  const context = fixtureContext(fixtureRepos[0]); const base = '/repos/alexmorgan/orbit-ui'; let writes = 0; let revision = 0;
  // Fake GitHub API.
  globalThis.fetch = async (url, options) => {
    // Path and method.
    const path = String(url).replace('https://api.github.com', ''); const method = options?.method || 'GET';
    // Invalid tokens get 401.
    if ((options?.headers as Record<string, string>).Authorization.includes('invalid')) return Response.json({ message: 'Bad credentials' }, { status: 401 });
    // User.
    if (path === '/user') return Response.json({ login: 'alexmorgan', name: 'Alex Morgan', avatar_url: '', id: 100 });
    // Repositories.
    if (path.startsWith('/user/repos')) return Response.json([context.repo]);
    // Repository.
    if (path === base) return Response.json(context.repo);
    // Default branch ref.
    if (path === `${base}/git/ref/heads/main`) return Response.json({ object: { sha: context.head } });
    // The new branch does not exist.
    if (path === `${base}/git/ref/heads/docs%2Fintegration`) return Response.json({ message: 'Not Found' }, { status: 404 });
    // File tree.
    if (path.includes('/git/trees/') && method === 'GET') return Response.json({ tree: context.paths.map(path => ({ path, type: 'blob' })) });
    // README.
    if (path.includes('/contents/README.md')) return Response.json({ encoding: 'base64', size: context.readme!.length, content: Buffer.from(context.readme!).toString('base64') });
    // package.json.
    if (path.includes('/contents/package.json')) return Response.json({ encoding: 'base64', size: 100, content: Buffer.from(JSON.stringify(context.manifest)).toString('base64') });
    // Other files are missing.
    if (path.includes('/contents/')) return Response.json({ message: 'Not Found' }, { status: 404 });
    // Commits.
    if (path.includes('/commits?')) return Response.json(context.commits.map(commit => ({ sha: commit.sha, commit: { message: commit.message, author: { date: commit.date, name: commit.author } } })));
    // Parent commit tree.
    if (path.includes('/git/commits/') && method === 'GET') return Response.json({ tree: { sha: 'original-tree' } });
    // Count writes.
    if (method === 'POST') writes++;
    // Create tree.
    if (path.endsWith('/git/trees')) return Response.json({ sha: 'next-tree' });
    // Create commit.
    if (path.endsWith('/git/commits')) return Response.json({ sha: `next-commit-${++revision}` });
    // Create branch ref.
    if (path.endsWith('/git/refs')) return Response.json({});
    // Anything else fails the test.
    throw new Error(`Unexpected integration request: ${method} ${path}`);
  };
  // Create the app.
  const { app, store } = createApp();
  // Clean up afterwards.
  try {
    // Client and session.
    const agent = request.agent(app); const session = await agent.get('/api/session');
    // Invalid token returns 401.
    await agent.post('/api/connect').set('x-csrf-token', session.body.csrf).send({ token: 'invalid-token-with-enough-characters' }).expect(401);
    // Valid token connects.
    const connected = await agent.post('/api/connect').set('x-csrf-token', session.body.csrf).send({ token: 'github_pat_valid_integration_routes_token' }).expect(200);
    // List repos.
    await agent.get('/api/repos').expect(200);
    // Generate a preview.
    const preview = await agent.post('/api/plans').set('x-csrf-token', connected.body.csrf).send({ owner: 'alexmorgan', repo: 'orbit-ui', modules: ['readme', 'docs'] }).expect(200);
    // The plan.
    const plan = preview.body;
    // Build the publish request.
    const input = { planId: plan.id, target: 'branch', branch: 'docs/integration', createPr: false, files: plan.files.map((file: { path: string; content: string }) => ({ path: file.path, content: file.content })), messages: plan.commits.map((commit: { message: string }) => commit.message) };
    // Send two publishes at once.
    const [first, concurrent] = await Promise.all([agent.post('/api/publish').set('x-csrf-token', connected.body.csrf).send(input), agent.post('/api/publish').set('x-csrf-token', connected.body.csrf).send(input)]);
    // One succeeds, one is a conflict.
    assert.deepEqual([first.status, concurrent.status].sort(), [200, 409]);
    // Three files and two commits.
    const successful = first.status === 200 ? first : concurrent; assert.equal(successful.body.files, 3); assert.equal(successful.body.commits, 2);
    // Remember the write count.
    const previousWrites = writes;
    // Retry the same request.
    const replay = await agent.post('/api/publish').set('x-csrf-token', connected.body.csrf).send(input).expect(200);
    // Same result and no new writes.
    assert.deepEqual(replay.body, successful.body); assert.equal(writes, previousWrites);
  // Close the store and restore fetch.
  } finally { store.close(); globalThis.fetch = originalFetch; }
});
