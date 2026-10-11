// Test runner.
import { test } from 'node:test';
// Strict assertions.
import assert from 'node:assert/strict';
// HTTP testing library.
import request from 'supertest';
// Random ids.
import { randomUUID } from 'node:crypto';
// Evidence helpers under test.
import { collectEvidence, evidencePayload, questionEvidence, redactSecrets, safeSourcePath } from '../server/evidence';
// AI functions under test.
import { askAI, generateAI } from '../server/groq';
// AI report store.
import { IntelligenceStore } from '../server/intelligence';
// App factory.
import { createApp } from '../server/app';
// File generator.
import { generateFiles } from '../shared/generator';
// Sample AI data.
import { analysis, evidence, report } from './fixtures/intelligence';

// Helper: build a JSON response.
const json = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
// Helper: build a fake Groq chat completion with token usage.
const completion = (payload: unknown, finish = 'stop') => json({ choices: [{ finish_reason: finish, message: { content: JSON.stringify(payload) } }], usage: { prompt_tokens: 1200, completion_tokens: 600, prompt_cache_hit_tokens: 800 } });

// Source selection excludes credential files, redacts secrets, and obeys the budget.
test('source selection excludes credential files, redacts recognized secrets and obeys the sampling budget', async () => {
  // A fake API key.
  const credential = 'sk-' + 'x'.repeat(32);
  // These paths must be rejected.
  for (const path of ['.env', '.env.production', 'secrets/client.ts', 'credentials.json', 'id_rsa', 'cert.pem', 'vendor/main.ts', 'dist/main.js', '../app.ts']) assert.equal(safeSourcePath(path), false, path);
  // These paths must be accepted.
  for (const path of ['.env.example', 'src/auth.ts', 'package.json', 'docs/ARCHITECTURE.md']) assert.equal(safeSourcePath(path), true, path);
  // Sample source with several kinds of secrets.
  const source = `API_KEY=${credential}\nconst password = "plain-password";\n-----BEGIN PRIVATE KEY-----\nprivate-material\n-----END PRIVATE KEY-----`;
  // Redact it.
  const redacted = redactSecrets(source);
  // No secrets remain.
  assert.doesNotMatch(redacted, /plain-password|private-material/); assert.ok(!redacted.includes(credential));
  // Save the real fetch and budget; collect requested paths.
  const oldFetch = global.fetch; const oldBudget = process.env.GROQ_CONTEXT_CHARS; const paths: string[] = [];
  // Restore everything afterwards.
  try {
    // Set a small budget.
    process.env.GROQ_CONTEXT_CHARS = '16000';
    // Fake GitHub contents API.
    global.fetch = async input => { const url = new URL(String(input)); paths.push(url.pathname); assert.equal(url.searchParams.get('ref'), evidence.context.head);
      // Return file content.
      const content = url.pathname.endsWith('.env.example') ? `API_KEY=private-example\nPORT=3001` : `// ${source}\n${'sample code\n'.repeat(1000)}`;
      // Reply in the GitHub contents format.
      return json({ encoding: 'base64', size: content.length, content: Buffer.from(content).toString('base64') }); };
    // A context with safe and unsafe paths.
    const context = { ...evidence.context, paths: ['.env', '.env.example', 'package.json', 'src/app.ts', 'src/auth.ts', 'dist/main.js'], readme: null };
    // Collect the evidence.
    const sampled = await collectEvidence(randomUUID(), context);
    // Within the character and file limits.
    assert.ok(sampled.sourceCharacters <= 16000); assert.ok(sampled.files.length <= 12);
    // Partial files are noted.
    assert.ok(sampled.omitted.some(item => item.includes('excerpt only')));
    // The env example is included.
    assert.ok(sampled.files.some(file => file.path === '.env.example'));
    // No secret values remain.
    assert.doesNotMatch(JSON.stringify(sampled.files), /private-example|plain-password|private-material/);
    // Forbidden paths were never requested.
    assert.ok(paths.every(path => !path.endsWith('/.env') && !path.includes('/dist/')));
  // Restore fetch and the environment variable.
  } finally { global.fetch = oldFetch; if (oldBudget === undefined) delete process.env.GROQ_CONTEXT_CHARS; else process.env.GROQ_CONTEXT_CHARS = oldBudget; }
});

// The analysis cache is scoped to account, snapshot, and focus; expiry cancels reuse.
test('analysis cache is scoped to account, snapshot and focus; expiry and disconnect cancel reuse', () => {
  // Fake clock and a store.
  let now = 1000; const store = new IntelligenceStore(() => now);
  // Save an analysis for Alice.
  const saved = store.put('alice', evidence, analysis, undefined, 'llama-3.1-8b-instant', 'architecture');
  // Alice finds it (instructions are trimmed).
  assert.equal(store.find('alice', evidence.context.repo.id, evidence.context.head, ' architecture ')?.report.id, saved.id);
  // A different commit finds nothing.
  assert.equal(store.find('alice', evidence.context.repo.id, 'changed-head', 'architecture'), undefined);
  // Different instructions find nothing.
  assert.equal(store.find('alice', evidence.context.repo.id, evidence.context.head, 'setup'), undefined);
  // Another account finds nothing.
  assert.equal(store.find('bob', evidence.context.repo.id, evidence.context.head, 'architecture'), undefined);
  // Bob cannot read it.
  assert.throws(() => store.get('bob', saved.id), /expired/);
  // Start a task; a second one is refused.
  const job = store.begin('alice'); assert.throws(() => store.begin('alice'), /already working/);
  // Clearing the owner aborts the task and removes the analysis.
  store.clearOwner('alice'); assert.equal(job.signal.aborted, true); assert.throws(() => store.get('alice', saved.id), /expired/); store.finish('alice');
  // Save another and let it expire.
  const later = store.put('alice', evidence, analysis); now += 20 * 60000;
  // Expired after 20 minutes.
  assert.throws(() => store.get('alice', later.id), /expired/);
});

// AI stages use bounded output, reuse analysis, and preserve the changelog and config files.
test('Groq analysis and document stages use bounded output, reuse analysis and preserve executable files and real changelog', async () => {
  // Save fetch and the API key; collect request bodies.
  const oldFetch = global.fetch; const oldKey = process.env.GROQ_API_KEY; const bodies: any[] = [];
  // Generate a baseline.
  const generated = generateFiles(evidence.context, ['readme', 'changelog', 'editorconfig', 'ci']);
  // Restore afterwards.
  try {
    // Fake API key.
    process.env.GROQ_API_KEY = 'test-key';
    // Fake Groq: record the body.
    global.fetch = async (_input, init) => { const body = JSON.parse(String(init?.body)); bodies.push(body);
      // First call returns an analysis; second returns the README and messages.
      return completion(bodies.length === 1 ? { analysis } : { files: [{ path: 'README.md', content: '# Orbit\n\nSource-grounded button usage and setup details.' }], messages: generated.commits.map(commit => commit.message) }); };
    // Analyze only.
    const inspected = await generateAI(evidence, [], [], 'Technical depth and clear presentation');
    // Then write documents, reusing the analysis.
    const docs = await generateAI(evidence, generated.files, generated.commits, 'Technical depth and clear presentation', undefined, inspected.analysis);
    // Both calls use the default model.
    assert.equal(bodies[0].model, 'openai/gpt-oss-120b'); assert.equal(bodies[1].model, 'openai/gpt-oss-120b');
    // Output token limits are 4500 and 3800.
    assert.equal(bodies[0].max_completion_tokens, 4500); assert.equal(bodies[1].max_completion_tokens, 3800);
    // JSON mode and the usage numbers.
    assert.equal(bodies[1].response_format.type, 'json_object'); assert.deepEqual(docs.usage, { inputTokens: 1200, outputTokens: 600, cachedTokens: 800 });
    // The second prompt says to omit the analysis.
    assert.match(bodies[1].messages[1].content, /omit analysis/);
    // Documentation guidance is specific and forbids unsupported claims.
    assert.match(bodies[1].messages[1].content, /DOCUMENTATION QUALITY/);
    assert.match(bodies[1].messages[1].content, /Never leave TODOs/);
    // Commit subjects must be concise, conventional, and tied to their group.
    assert.match(bodies[1].messages[1].content, /COMMIT SUBJECT RULES/);
    assert.match(bodies[1].messages[1].content, /at most 72 characters/);
    // The second prompt does not include the generated file content.
    assert.ok(!bodies[1].messages[1].content.includes(generated.files[0].content));
    // Both prompts share the same evidence prefix (to enable caching).
    assert.equal(bodies[0].messages[1].content.split('\nTask:')[0], bodies[1].messages[1].content.split('\nTask:')[0]);
    // Non-AI files are unchanged.
    for (const file of generated.files.filter(file => file.path !== 'README.md')) assert.equal(docs.files.find(next => next.path === file.path)!.content, file.content);
    // Commit groups and analysis are preserved.
    assert.deepEqual(docs.commits.map(commit => commit.files), generated.commits.map(commit => commit.files)); assert.deepEqual(docs.analysis, analysis);
  // Restore fetch and the key.
  } finally { global.fetch = oldFetch; if (oldKey === undefined) delete process.env.GROQ_API_KEY; else process.env.GROQ_API_KEY = oldKey; }
});

// Q&A uses at most four small excerpts and bounded history.
test('Q&A retrieves at most four small excerpts and bounds history without sending a large tree', async () => {
  // Save fetch and the API key.
  const oldFetch = global.fetch; const oldKey = process.env.GROQ_API_KEY;
  // Large fake evidence: 2000 paths and 12 files.
  const large = { ...evidence, context: { ...evidence.context, paths: Array.from({ length: 2000 }, (_, i) => `src/unrelated-inventory-${i}.ts`) }, files: Array.from({ length: 12 }, (_, i) => ({ path: `src/file${i}.ts`, content: 'unrelated '.repeat(800) + (i === 11 ? 'authentication validates signed sessions' : ''), truncated: false })) };
  // Excerpt selection picks the relevant file and stays small.
  const subset = questionEvidence(large, 'How does authentication validate sessions?'); assert.equal(subset.files[0].path, 'src/file11.ts'); assert.ok(subset.sourceCharacters <= 7200);
  // Restore afterwards.
  try {
    // Fake API key.
    process.env.GROQ_API_KEY = 'test-key';
    // Fake Groq: read the prompt.
    global.fetch = async (_input, init) => { const body = JSON.parse(String(init?.body)); const prompt = body.messages[1].content;
      // Default model and 1800 output tokens.
      assert.equal(body.model, 'openai/gpt-oss-120b'); assert.equal(body.max_completion_tokens, 1800);
      // The prompt is small and has no path inventory.
      assert.ok(prompt.length < 16000); assert.ok(!prompt.includes('unrelated-inventory'));
      // Old history is dropped.
      assert.ok(!prompt.includes('history-marker-0')); assert.ok(!prompt.includes('history-marker-1'));
      // The relevant excerpt is included.
      assert.ok(prompt.includes('authentication validates signed sessions'));
      // Return a valid answer.
      return completion({ answer: 'The excerpt mentions signed sessions; validation details are unavailable.', sources: ['src/file11.ts'], followUps: [] }); };
    // Ask with six long history entries.
    const answer = await askAI(large, report, 'How does authentication validate sessions?', undefined, Array.from({ length: 6 }, (_, i) => ({ role: 'user' as const, content: `history-marker-${i} ` + 'a'.repeat(10000) })));
    // Sources and usage are correct.
    assert.deepEqual(answer.sources, ['src/file11.ts']); assert.equal(answer.usage?.cachedTokens, 800);
  // Restore fetch and the key.
  } finally { global.fetch = oldFetch; if (oldKey === undefined) delete process.env.GROQ_API_KEY; else process.env.GROQ_API_KEY = oldKey; }
});

// The analysis prompt omits duplicated manifest fields and sampled paths.
test('analysis prompt omits duplicate manifest fields and sampled paths while keeping useful coverage', () => {
  // A context with 250 extra paths and 20 commits.
  const context = { ...evidence.context, paths: [...evidence.files.map(file => file.path), ...Array.from({ length: 250 }, (_, i) => `src/extra${i}.ts`)], commits: Array.from({ length: 20 }, (_, i) => ({ ...evidence.context.commits[0], sha: `sha${i}`, message: `Observed commit ${i}` })) };
  // Build the payload.
  const payload = JSON.parse(evidencePayload({ ...evidence, context }));
  // No manifest, 250 other paths counted, and 80 listed.
  assert.equal(payload.manifest, undefined); assert.equal(payload.otherPathCount, 250); assert.equal(payload.otherPaths.length, 80);
  // Listed paths are not already sampled.
  assert.ok(payload.otherPaths.every((path: string) => !evidence.files.some(file => file.path === path)));
  // Six recent commits, without SHAs.
  assert.equal(payload.recentCommits.length, 6); assert.equal(payload.recentCommits[0].sha, undefined);
  // package.json is among the files.
  assert.ok(payload.files.some((file: { path: string }) => file.path === 'package.json'));
  // When package.json is truncated:
  const truncated = JSON.parse(evidencePayload({ ...evidence, context, files: evidence.files.map(file => file.path === 'package.json' ? { ...file, truncated: true } : file) }));
  // The manifest summary is included.
  assert.ok(truncated.manifest.scripts); assert.ok(Array.isArray(truncated.manifest.dependencies));
});

// Invalid AI output fails safely.
test('invalid AI paths, unsupported citations, truncated responses and provider credentials errors fail safely', async () => {
  // Save fetch and the key.
  const oldFetch = global.fetch; const oldKey = process.env.GROQ_API_KEY;
  // Restore afterwards.
  try {
    // Fake API key.
    process.env.GROQ_API_KEY = 'test-key';
    // The AI returns a file path outside the request.
    global.fetch = async () => completion({ analysis, files: [{ path: '../secret.md', content: 'bad' }], messages: [] });
    // Rejected.
    await assert.rejects(generateAI(evidence, [], [], ''), /different file or commit set/);
    // Count the calls.
    let calls = 0;
    // Fake Groq with a citation mistake on the first call.
    global.fetch = async (_input, options) => {
      // Count the call.
      calls++;
      // Parse the body.
      const body = JSON.parse(String(options?.body));
      // The second call must be a repair request.
      if (calls === 2) assert.match(body.messages[1].content, /CITATION REPAIR/);
      // First call cites an unsampled file; second is correct.
      return completion({ analysis: calls === 1 ? { ...analysis, stack: [{ ...analysis.stack[0], evidence: ['unsampled.ts'] }] } : analysis, files: [], messages: [] });
    };
    // Generate with the repair.
    const repaired = await generateAI(evidence, [], [], '');
    // Two calls, and a valid citation.
    assert.equal(calls, 2); assert.deepEqual(repaired.analysis.stack[0].evidence, analysis.stack[0].evidence);
    // Always cite an unsampled file.
    global.fetch = async () => completion({ analysis: { ...analysis, stack: [{ ...analysis.stack[0], evidence: ['unsampled.ts'] }] }, files: [], messages: [] });
    // Rejected as outside the excerpts.
    await assert.rejects(generateAI(evidence, [], [], ''), /outside the inspected excerpts/);
    // A response cut off by length.
    global.fetch = async () => completion({ analysis, files: [], messages: [] }, 'length');
    // Rejected as incomplete.
    await assert.rejects(generateAI(evidence, [], [], ''), /incomplete or invalid/);
    // A provider error with secret details.
    global.fetch = async () => json({ error: { message: 'provider-secret-details' } }, 401);
    // Returns 502 without leaking the details.
    await assert.rejects(generateAI(evidence, [], [], ''), (error: any) => error.status === 502 && !error.message.includes('provider-secret-details'));
    // Preserve Groq's retry hint for the UI without issuing an automatic retry.
    let rateLimitCalls = 0;
    global.fetch = async () => { rateLimitCalls++; return new Response(JSON.stringify({ error: { message: 'private provider detail' } }), { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '17' } }); };
    await assert.rejects(generateAI(evidence, [], [], ''), (error: any) => error.status === 502 && error.retryAfter === 17 && /17 seconds/.test(error.message) && !error.message.includes('private provider detail'));
    assert.equal(rateLimitCalls, 1);
  // Restore fetch and the key.
  } finally { global.fetch = oldFetch; if (oldKey === undefined) delete process.env.GROQ_API_KEY; else process.env.GROQ_API_KEY = oldKey; }
});

// Authenticated flow: cached analysis skips a model call, and documents reuse it.
test('authenticated analysis cache skips a second model call and document generation reuses the stored analysis', async () => {
  // Save fetch and the key; record calls.
  const oldFetch = global.fetch; const oldKey = process.env.GROQ_API_KEY; const calls: any[] = []; const ctx = evidence.context;
  // Create the app.
  const { app, store } = createApp();
  // Restore afterwards.
  try {
    // Fake API key.
    process.env.GROQ_API_KEY = 'test-key';
    // Fake fetch for Groq and GitHub.
    global.fetch = async (input, init) => {
      // Parse the URL.
      const url = new URL(String(input));
      // Handle Groq requests.
      if (url.hostname === 'api.groq.com' && url.pathname === '/openai/v1/chat/completions') {
        // Record the request body.
        const body = JSON.parse(String(init?.body)); calls.push(body);
        // First: analysis; second: documents.
        return completion(calls.length === 1 ? { analysis } : { files: [{ path: 'README.md', content: '# Orbit\n\nA detailed source-aware overview and native Button example.' }], messages: ['docs: explain the button component and setup'] });
      }
      // No GitHub writes should happen.
      assert.ok(!init?.method || init.method === 'GET', 'No GitHub writes during analysis or preview');
      // User.
      if (url.pathname === '/user') return json({ login: ctx.repo.owner.login, id: 1, name: 'Alex', avatar_url: '' });
      // Branch ref.
      if (url.pathname.endsWith('/git/ref/heads/main')) return json({ object: { sha: ctx.head } });
      // File tree.
      if (url.pathname.includes('/git/trees/')) return json({ tree: evidence.files.map(file => ({ path: file.path, type: 'blob' })).concat([{ path: 'README.md', type: 'blob' }]), truncated: false });
      // Commits.
      if (url.pathname.endsWith('/commits')) return json(ctx.commits.map(commit => ({ sha: commit.sha, commit: { message: commit.message, author: { date: commit.date, name: commit.author } } })));
      // File contents.
      if (url.pathname.includes('/contents/')) {
        // Decode the path and pick the content.
        const path = decodeURIComponent(url.pathname.split('/contents/')[1]); const content = path === 'README.md' ? ctx.readme : evidence.files.find(file => file.path === path)?.content;
        // Return the content or 404.
        return content == null ? json({}, 404) : json({ encoding: 'base64', size: content.length, content: Buffer.from(content).toString('base64') });
      }
      // Default: the repository.
      return json(ctx.repo);
    };
    // Create a client and fetch the session; no key leaks.
    const agent = request.agent(app); const session = await agent.get('/api/session'); assert.ok(!JSON.stringify(session.body).includes('test-key'));
    // Sign in with a fake token.
    const connected = await agent.post('/api/connect').set('x-csrf-token', session.body.csrf).send({ token: 'github_test_' + randomUUID() }).expect(200);
    // CSRF token and the request body.
    const csrf = connected.body.csrf; const body = { owner: ctx.repo.owner.login, repo: ctx.repo.name, instructions: 'Technical depth and presentation' };
    // First analysis.
    const first = await agent.post('/api/ai/analyze').set('x-csrf-token', csrf).send(body).expect(200);
    // Second analysis.
    const second = await agent.post('/api/ai/analyze').set('x-csrf-token', csrf).send(body).expect(200);
    // The second is reused with no new model call.
    assert.equal(second.body.reused, true); assert.equal(second.body.id, first.body.id); assert.equal(calls.length, 1);
    // Generate a plan using the analysis.
    const plan = await agent.post('/api/plans').set('x-csrf-token', csrf).send({ ...body, modules: ['readme'], ai: true, analysisId: first.body.id }).expect(200);
    // One additional model call that omits the analysis.
    assert.equal(calls.length, 2); assert.match(calls[1].messages[1].content, /omit analysis/); assert.deepEqual(plan.body.ai.analysis, first.body.analysis);
    // A plan with only deterministic modules.
    const configOnly = await agent.post('/api/plans').set('x-csrf-token', csrf).send({ ...body, modules: ['changelog', 'editorconfig'], ai: true }).expect(200);
    // No model call and no AI report.
    assert.equal(calls.length, 2, 'deterministic-only modules make no model call'); assert.equal(configOnly.body.ai, undefined);
    // A second user signs in.
    const other = request.agent(app); const otherSession = await other.get('/api/session'); const otherConnected = await other.post('/api/connect').set('x-csrf-token', otherSession.body.csrf).send({ token: 'github_test_' + randomUUID() });
    // The other user cannot ask about the first user's analysis.
    await other.post('/api/ai/ask').set('x-csrf-token', otherConnected.body.csrf).send({ analysisId: first.body.id, question: 'What does it do?' }).expect(404);
    // Log out.
    await agent.post('/api/logout').set('x-csrf-token', csrf).send({}).expect(200);
    // Protected routes fail after logout.
    await agent.get('/api/repos').expect(401);
  // Restore the store, fetch, and key.
  } finally { store.close(); global.fetch = oldFetch; if (oldKey === undefined) delete process.env.GROQ_API_KEY; else process.env.GROQ_API_KEY = oldKey; }
});
