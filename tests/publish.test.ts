// Test runner.
import { test } from 'node:test';
// Assertions.
import assert from 'node:assert/strict';
// Random ids.
import { randomUUID } from 'node:crypto';
// HTTP testing library.
import request from 'supertest';
// Publish function under test.
import { publish } from '../server/publish';
// App factory.
import { createApp } from '../server/app';
// File generator.
import { generateFiles } from '../shared/generator';
// Fixtures.
import { fixtureContext, fixtureRepos } from './fixtures/projects';
// Plan type.
import type { Plan } from '../shared/types';
// GitHub client with no write delay.
import { createGithubClient } from '../server/github-client';

// Publishing creates real commits and creates the branch ref last.
test('publishing creates real commit objects and creates only the new branch ref last', async () => {
  // Save fetch.
  const originalFetch = globalThis.fetch;
  // Fixture context.
  const context = fixtureContext(fixtureRepos[0]);
  // Build a plan.
  const plan: Plan = { id: randomUUID(), repo: context.repo, head: context.head, createdAt: new Date().toISOString(), ...generateFiles(context, ['readme', 'docs']) };
  // Record every call.
  const calls: { url: string; method: string; body: any }[] = [];
  // Commit counter.
  let commitNumber = 0;
  // Fake GitHub API.
  globalThis.fetch = (async (url: string | URL | Request, options?: RequestInit) => {
    // Path without the host.
    const path = String(url).replace('https://api.github.com', '');
    // Request body.
    const body = options?.body ? JSON.parse(String(options.body)) : undefined;
    // HTTP method.
    const method = options?.method || 'GET';
    // Record the call.
    calls.push({ url: path, method, body });
    // Repository path.
    const base = '/repos/alexmorgan/orbit-ui';
    // Default branch ref.
    if (path === `${base}/git/ref/heads/main`) return Response.json({ object: { sha: plan.head } });
    // The new branch does not exist.
    if (path === `${base}/git/ref/heads/docs%2Fimprovements`) return Response.json({ message: 'Not Found' }, { status: 404 });
    // Parent commit's tree.
    if (path.startsWith(`${base}/git/commits/`) && method === 'GET') return Response.json({ tree: { sha: 'original-tree' } });
    // Blob creation.
    if (path.endsWith('/git/blobs')) return Response.json({ sha: `blob-${calls.length}` });
    // Tree creation.
    if (path.endsWith('/git/trees')) return Response.json({ sha: `tree-${calls.length}` });
    // Commit creation.
    if (path.endsWith('/git/commits')) return Response.json({ sha: `new-commit-${++commitNumber}` });
    // Ref creation.
    if (path.endsWith('/git/refs')) return Response.json({ ref: body.ref });
    // Unknown requests fail the test.
    throw new Error(`Unexpected request: ${method} ${path}`);
  }) as typeof fetch;
  // Run the publish.
  try {
    // Publish to a new branch.
    const result = await publish('test-token', plan, { planId: plan.id, target: 'branch', branch: 'docs/improvements', createPr: false, files: plan.files.map(f => ({ path: f.path, content: f.content })), messages: plan.commits.map(c => c.message) }, createGithubClient({ writeDelayMs: 0 }).request);
    // Two commits.
    assert.equal(result.commits, 2);
    // Find the commit requests.
    const commits = calls.filter(c => c.method === 'POST' && c.url.endsWith('/git/commits'));
    // The first commit's parent is HEAD.
    assert.deepEqual(commits[0].body.parents, [plan.head]);
    // The second commit builds on the first.
    assert.deepEqual(commits[1].body.parents, ['new-commit-1']);
    // No custom author is sent.
    assert.ok(commits.every(c => !('author' in c.body) && !('committer' in c.body)));
    // The ref is created last.
    assert.equal(calls.at(-1)?.body.ref, 'refs/heads/docs/improvements');
    // No branch is updated (no PATCH).
    assert.ok(!calls.some(c => c.method === 'PATCH'));
    // No blobs are created.
    assert.ok(!calls.some(c => c.url.endsWith('/git/blobs')));
    // The tree has the new file content.
    assert.equal(calls.find(c => c.url.endsWith('/git/trees'))?.body.tree[0].content, plan.files[0].content);
  // Restore fetch.
  } finally { globalThis.fetch = originalFetch; }
});

// Publishing with history set dates the commits and uses a custom author.
test('publishing backdates commits and fabricates a custom author when history is requested', async () => {
  // Save fetch.
  const originalFetch = globalThis.fetch;
  // Fixture context.
  const context = fixtureContext(fixtureRepos[0]);
  // Build a plan.
  const plan: Plan = { id: randomUUID(), repo: context.repo, head: context.head, createdAt: new Date().toISOString(), ...generateFiles(context, ['readme', 'docs']) };
  // Record calls.
  const calls: { url: string; method: string; body: any }[] = [];
  // Fake GitHub API.
  globalThis.fetch = (async (url: string | URL | Request, options?: RequestInit) => {
    // Path.
    const path = String(url).replace('https://api.github.com', '');
    // Body.
    const body = options?.body ? JSON.parse(String(options.body)) : undefined;
    // Method.
    const method = options?.method || 'GET';
    // Record the call.
    calls.push({ url: path, method, body });
    // Repository path.
    const base = '/repos/alexmorgan/orbit-ui';
    // Default branch ref.
    if (path === `${base}/git/ref/heads/main`) return Response.json({ object: { sha: plan.head } });
    // The new branch does not exist.
    if (path === `${base}/git/ref/heads/docs%2Fimprovements`) return Response.json({ message: 'Not Found' }, { status: 404 });
    // Parent commit's tree.
    if (path.startsWith(`${base}/git/commits/`) && method === 'GET') return Response.json({ tree: { sha: 'original-tree' } });
    // Tree creation.
    if (path.endsWith('/git/trees')) return Response.json({ sha: `tree-${calls.length}` });
    // Commit creation.
    if (path.endsWith('/git/commits')) return Response.json({ sha: `new-commit-${calls.length}` });
    // Ref creation.
    if (path.endsWith('/git/refs')) return Response.json({ ref: body.ref });
    // Unknown requests fail the test.
    throw new Error(`Unexpected request: ${method} ${path}`);
  }) as typeof fetch;
  // Run the publish.
  try {
    // Author and date range.
    const history = { authorName: 'Ada Lovelace', authorEmail: 'ada@example.com', from: '2024-01-01T10:00:00.000Z', to: '2024-06-01T10:00:00.000Z' };
    // Publish with the history settings.
    await publish('test-token', plan, { planId: plan.id, target: 'branch', branch: 'docs/improvements', createPr: false, files: plan.files.map(f => ({ path: f.path, content: f.content })), messages: plan.commits.map(c => c.message), history }, createGithubClient({ writeDelayMs: 0 }).request);
    // Find the commit requests.
    const commits = calls.filter(c => c.method === 'POST' && c.url.endsWith('/git/commits'));
    // Two commits.
    assert.equal(commits.length, 2);
    // The first commit uses the first date.
    assert.deepEqual(commits[0].body.author, { name: 'Ada Lovelace', email: 'ada@example.com', date: '2024-01-01T10:00:00.000Z' });
    // Committer equals author.
    assert.deepEqual(commits[0].body.committer, commits[0].body.author);
    // The last commit uses the last date.
    assert.deepEqual(commits[1].body.author.date, '2024-06-01T10:00:00.000Z');
    // All commits use the custom author.
    assert.ok(commits.every(c => c.body.author.name === 'Ada Lovelace' && c.body.committer.email === 'ada@example.com'));
  // Restore fetch.
  } finally { globalThis.fetch = originalFetch; }
});

// Unchanged files are skipped, and a failed draft PR keeps the published branch.
test('unchanged files are skipped and draft PR failures preserve the published branch', async () => {
  // Fixture context.
  const context = fixtureContext(fixtureRepos[0]);
  // Build a plan.
  const plan: Plan = { id: randomUUID(), repo: context.repo, head: context.head, createdAt: new Date().toISOString(), ...generateFiles(context, ['readme', 'docs']) };
  // Mark the first file as unchanged.
  plan.files[0].original = plan.files[0].content;
  // Record writes.
  const writes: string[] = [];
  // GitHub client with a fake fetch.
  const client = createGithubClient({ writeDelayMs: 0, fetch: async (url, options) => {
    // Path and method.
    const path = String(url); const method = options?.method || 'GET';
    // Record writes.
    if (method !== 'GET') writes.push(path);
    // Default branch ref.
    if (path.endsWith('/git/ref/heads/main')) return Response.json({ object: { sha: plan.head } });
    // The new branch does not exist.
    if (path.endsWith('/git/ref/heads/docs%2Fimprovements')) return Response.json({ message: 'Not Found' }, { status: 404 });
    // Parent commit's tree.
    if (path.includes('/git/commits/') && method === 'GET') return Response.json({ tree: { sha: 'base-tree' } });
    // Tree creation.
    if (path.endsWith('/git/trees')) {
      // Parse the body.
      const body = JSON.parse(String(options?.body));
      // Only the changed docs files are in the tree.
      assert.deepEqual(body.tree.map((entry: { path: string }) => entry.path), ['docs/SETUP.md', 'docs/ARCHITECTURE.md']);
      // Return a tree.
      return Response.json({ sha: 'new-tree' });
    }
    // Commit creation.
    if (path.endsWith('/git/commits')) return Response.json({ sha: 'new-commit' });
    // Ref creation.
    if (path.endsWith('/git/refs')) return Response.json({});
    // Pull request creation fails.
    if (path.endsWith('/pulls')) return Response.json({ message: 'Pull requests are disabled' }, { status: 403 });
    // Unknown requests fail the test.
    throw new Error(`Unexpected request: ${path}`);
  } });
  // Publish with a draft PR.
  const result = await publish('test-token', plan, { planId: plan.id, target: 'branch', branch: 'docs/improvements', createPr: true, files: plan.files.map(f => ({ path: f.path, content: f.content })), messages: plan.commits.map(c => c.message) }, client.request);
  // Two files and one commit.
  assert.equal(result.files, 2); assert.equal(result.commits, 1);
  // The branch URL exists and the PR error is reported.
  assert.match(result.url, /tree\/docs\/improvements$/); assert.equal(result.prError, 'Pull requests are disabled');
  // One commit write.
  assert.equal(writes.filter(path => path.endsWith('/git/commits')).length, 1);
});

// OAuth callback: PKCE exchange, session rotation, listing projects, and a preview.
test('live OAuth callback exchanges PKCE, regenerates session, lists projects, and generates a preview', async () => {
  // Save the OAuth client id.
  const previousClient = process.env.GITHUB_CLIENT_ID;
  // Save the OAuth client secret.
  const previousSecret = process.env.GITHUB_CLIENT_SECRET;
  // Save fetch.
  const originalFetch = globalThis.fetch;
  // Set test OAuth credentials.
  process.env.GITHUB_CLIENT_ID = 'test-client'; process.env.GITHUB_CLIENT_SECRET = 'test-secret';
  // Fixture context.
  const context = fixtureContext(fixtureRepos[0]);
  // Repository path.
  const base = '/repos/alexmorgan/orbit-ui';
  let currentHead = context.head;
  // PKCE verifier seen by the fake.
  let verifier = '';
  // Snapshot reuse should avoid reading the repo tree and history twice.
  let metadataReads = 0; let treeReads = 0; let historyReads = 0;
  // Fake GitHub and OAuth endpoints.
  globalThis.fetch = (async (url: string | URL | Request, options?: RequestInit) => {
    // The requested URL.
    const value = String(url);
    // Token exchange.
    if (value === 'https://github.com/login/oauth/access_token') {
      // Read the body and keep the verifier.
      const body = JSON.parse(String(options?.body)); verifier = body.code_verifier;
      // The right code was sent.
      assert.equal(body.code, 'valid-code');
      // Return a token.
      return Response.json({ access_token: 'server-only-test-token' });
    }
    // Path for the API.
    const path = value.replace('https://api.github.com', '');
    // User.
    if (path === '/user') return Response.json({ login: 'alexmorgan', name: 'Alex Morgan', avatar_url: '', id: 100 });
    // Repositories.
    if (path.startsWith('/user/repos')) return Response.json([context.repo]);
    // Repository.
    if (path === base) { metadataReads++; return Response.json(context.repo); }
    // Default branch ref.
    if (path === `${base}/git/ref/heads/main`) return Response.json({ object: { sha: currentHead } });
    // File tree.
    if (path.startsWith(`${base}/git/trees/`)) { treeReads++; return Response.json({ tree: context.paths.map(path => ({ path, type: 'blob' })) }); }
    // README.
    if (path.includes('/contents/README.md')) return Response.json({ encoding: 'base64', size: context.readme!.length, content: Buffer.from(context.readme!).toString('base64') });
    // package.json.
    if (path.includes('/contents/package.json')) return Response.json({ encoding: 'base64', size: 100, content: Buffer.from(JSON.stringify(context.manifest)).toString('base64') });
    // Other files are missing.
    if (path.includes('/contents/')) return Response.json({ message: 'Not Found' }, { status: 404 });
    // Commits.
    if (path.startsWith(`${base}/commits?`)) { historyReads++; return Response.json(context.commits.map(c => ({ sha: c.sha, commit: { message: c.message, author: { date: c.date, name: c.author } } }))); }
    // Unknown requests fail the test.
    throw new Error(`Unexpected request: ${path}`);
  }) as typeof fetch;
  // Create the app.
  const { app, store } = createApp();
  // Clean up afterwards.
  try {
    // Client with cookies.
    const agent = request.agent(app);
    // Get the initial session.
    const before = await agent.get('/api/session');
    // Start the OAuth flow (a redirect).
    const auth = await agent.get('/auth/github').expect(302);
    // Read the redirect URL.
    const authorization = new URL(auth.headers.location);
    // PKCE with S256.
    assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
    // Complete the callback.
    await agent.get(`/auth/github/callback?code=valid-code&state=${authorization.searchParams.get('state')}`).expect(302).expect('Location', '/?connected=1');
    // A verifier was sent.
    assert.ok(verifier.length > 30);
    // Get the session.
    const session = await agent.get('/api/session');
    // The user is signed in.
    assert.equal(session.body.user.login, 'alexmorgan');
    // The CSRF token changed.
    assert.notEqual(session.body.csrf, before.body.csrf);
    // The token is not exposed.
    assert.ok(!JSON.stringify(session.body).includes('server-only-test-token'));
    // List repositories.
    const repositories = await agent.get('/api/repos').expect(200);
    // One repository.
    assert.equal(repositories.body.repos.length, 1);
    // Inspect the project.
    const project = await agent.get('/api/projects/alexmorgan/orbit-ui').expect(200);
    // HEAD matches.
    assert.equal(project.body.head, context.head);
    assert.match(project.body.inspectionId, /^[0-9a-f-]{36}$/);
    // Generate a preview.
    const plan = await agent.post('/api/plans').set('x-csrf-token', session.body.csrf).send({ owner: 'alexmorgan', repo: 'orbit-ui', modules: ['readme', 'docs'], inspectionId: project.body.inspectionId }).expect(200);
    // Three files.
    assert.equal(plan.body.files.length, 3);
    // Two commits.
    assert.equal(plan.body.commits.length, 2);
    // The original README is included.
    assert.equal(plan.body.files[0].original, context.readme);
    // The recent snapshot avoided redundant metadata, tree, and history calls.
    assert.equal(metadataReads, 2); assert.equal(treeReads, 1); assert.equal(historyReads, 1);
    // A changed branch HEAD forces a fresh inspection before preview generation.
    currentHead = 'new-current-head';
    const refreshed = await agent.post('/api/plans').set('x-csrf-token', session.body.csrf).send({ owner: 'alexmorgan', repo: 'orbit-ui', modules: ['readme'], inspectionId: project.body.inspectionId }).expect(200);
    assert.equal(refreshed.body.head, currentHead);
    assert.equal(metadataReads, 4); assert.equal(treeReads, 2); assert.equal(historyReads, 2);
  } finally {
    // Close the store and restore fetch.
    store.close(); globalThis.fetch = originalFetch;
    // Restore the client id.
    if (previousClient === undefined) delete process.env.GITHUB_CLIENT_ID; else process.env.GITHUB_CLIENT_ID = previousClient;
    // Restore the client secret.
    if (previousSecret === undefined) delete process.env.GITHUB_CLIENT_SECRET; else process.env.GITHUB_CLIENT_SECRET = previousSecret;
  }
});

// Fork and documentation destinations.
test('fork destination keeps source history, and documentation destination creates a separate repository', async () => {
  // Save fetch.
  const originalFetch = globalThis.fetch;
  // Fixture context.
  const context = fixtureContext(fixtureRepos[0]);
  // Build a plan.
  const plan: Plan = { id: randomUUID(), repo: context.repo, head: context.head, createdAt: new Date().toISOString(), ...generateFiles(context, ['readme']) };
  // Current mode: fork or new repository.
  let mode: 'fork' | 'new' = 'fork';
  // Record calls.
  const calls: { path: string; method: string; body: any }[] = [];
  // Fake GitHub API.
  globalThis.fetch = (async (url: string | URL | Request, options?: RequestInit) => {
    // Path.
    const path = String(url).replace('https://api.github.com', '');
    // Method.
    const method = options?.method || 'GET';
    // Body.
    const body = options?.body ? JSON.parse(String(options.body)) : undefined;
    // Record the call.
    calls.push({ path, method, body });
    // User.
    if (path === '/user') return Response.json({ login: 'another-user' });
    // Fork or new repository creation.
    if (path.endsWith('/forks') || path === '/user/repos') return Response.json({ ...context.repo, full_name: `another-user/${mode === 'fork' ? 'orbit-ui' : 'orbit-ui-docs'}`, name: mode === 'fork' ? 'orbit-ui' : 'orbit-ui-docs', owner: { login: 'another-user' }, html_url: `https://github.com/another-user/${mode === 'fork' ? 'orbit-ui' : 'orbit-ui-docs'}` });
    // Default branch ref.
    if (path.endsWith('/git/ref/heads/main')) return Response.json({ object: { sha: mode === 'fork' ? plan.head : 'initialized-docs-head' } });
    // The new branch does not exist.
    if (path.endsWith('/git/ref/heads/docs%2Fimprovements')) return Response.json({ message: 'Not found' }, { status: 404 });
    // Parent commit's tree.
    if (path.includes('/git/commits/') && method === 'GET') return Response.json({ tree: { sha: 'base-tree' } });
    // Blob creation.
    if (path.endsWith('/git/blobs')) return Response.json({ sha: 'blob' });
    // Tree creation.
    if (path.endsWith('/git/trees')) return Response.json({ sha: 'tree' });
    // Commit creation.
    if (path.endsWith('/git/commits')) return Response.json({ sha: 'published-head' });
    // Ref creation.
    if (path.endsWith('/git/refs')) return Response.json({ ref: body.ref });
    // Pull request creation.
    if (path.endsWith('/pulls')) return Response.json({ html_url: 'https://github.com/another-user/orbit-ui/pull/1' });
    // Unknown requests fail the test.
    throw new Error(`Unexpected request: ${path}`);
  }) as typeof fetch;
  // Run the checks.
  try {
    // Publish request for a fork.
    const input = { planId: plan.id, target: 'fork' as const, branch: 'docs/improvements', createPr: true, files: plan.files.map(f => ({ path: f.path, content: f.content })), messages: plan.commits.map(c => c.message) };
    // A client with no write delay.
    const fastGithub = createGithubClient({ writeDelayMs: 0 }).request;
    // Publish to a fork.
    const fork = await publish('test-token', plan, input, fastGithub);
    // The URL points to the fork.
    assert.ok(fork.url.startsWith('https://github.com/another-user/orbit-ui/'));
    // A pull request was created.
    assert.ok(fork.prUrl);
    // Find the commit.
    const forkCommit = calls.find(c => c.path.endsWith('/git/commits') && c.method === 'POST');
    // The parent is the source HEAD.
    assert.deepEqual(forkCommit?.body.parents, [plan.head]);
    // Every git write targets the fork.
    assert.ok(calls.filter(c => c.method === 'POST' && c.path.includes('/git/')).every(c => c.path.startsWith('/repos/another-user/')));
    // Reset and switch to the new-repository mode.
    calls.length = 0; mode = 'new';
    // Publish to a new repository.
    const docs = await publish('test-token', plan, { ...input, target: 'new', name: 'orbit-ui-docs', private: true, createPr: false }, fastGithub);
    // The URL points to the docs repo.
    assert.ok(docs.repoUrl.endsWith('/orbit-ui-docs'));
    // Find the repository creation call.
    const created = calls.find(c => c.path === '/user/repos');
    // It is initialized.
    assert.equal(created?.body.auto_init, true);
    // It is private.
    assert.equal(created?.body.private, true);
    // Find the commit.
    const docsCommit = calls.find(c => c.path.endsWith('/git/commits') && c.method === 'POST');
    // Its parent is the initial commit of the new repo.
    assert.deepEqual(docsCommit?.body.parents, ['initialized-docs-head']);
    // One commit.
    assert.equal(docs.commits, 1);
  // Restore fetch.
  } finally { globalThis.fetch = originalFetch; }
});
