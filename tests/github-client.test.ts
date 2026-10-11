// Test runner.
import { test } from 'node:test';
// Assertions.
import assert from 'node:assert/strict';
// Client under test.
import { createGithubClient, HttpError } from '../server/github-client';

// Writes are serialized per token and wait one second.
test('GitHub writes are serialized per token and wait one second', async () => {
  // Virtual clock and concurrency counters.
  let clock = 0; let active = 0; let peak = 0; const starts: number[] = [];
  // Create a client with a fake clock, sleep, and fetch.
  const client = createGithubClient({ now: () => clock, sleep: async ms => { clock += ms; }, fetch: (async () => {
    // Track concurrency and the start time.
    active++; peak = Math.max(peak, active); starts.push(clock);
    // Simulate network work and return JSON.
    await Promise.resolve(); active--; return Response.json({ ok: true });
  }) as typeof fetch });
  // Send three writes at once.
  await Promise.all([client.request('token', '/one', 'POST', {}), client.request('token', '/two', 'POST', {}), client.request('token', '/three', 'POST', {})]);
  // Only one at a time, starting 1 second apart.
  assert.equal(peak, 1); assert.deepEqual(starts, [0, 1000, 2000]);
});
// Read-only requests overlap in a bounded lane.
test('GitHub allows up to four concurrent reads per token', async () => {
  let active = 0; let peak = 0;
  const client = createGithubClient({ fetch: (async () => {
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 4));
    active--; return Response.json({ ok: true });
  }) as typeof fetch });
  await Promise.all(Array.from({ length: 10 }, (_, index) => client.request('token', `/read-${index}`)));
  assert.equal(peak, 4); assert.equal(active, 0);
});
// Mutations wait for reads already in flight.
test('GitHub writes wait for active reads before publishing changes', async () => {
  let releaseRead!: () => void; let signalRead!: () => void; let writes = 0;
  const readStarted = new Promise<void>(resolve => { signalRead = resolve; });
  const client = createGithubClient({ writeDelayMs: 0, fetch: (async (_url, init) => {
    if (init?.method === 'GET') { signalRead(); await new Promise<void>(resolve => { releaseRead = resolve; }); }
    else writes++;
    return Response.json({ ok: true });
  }) as typeof fetch });
  const read = client.request('token', '/contents'); await readStarted;
  const write = client.request('token', '/git/refs', 'POST', {});
  await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(writes, 0);
  releaseRead(); await Promise.all([read, write]); assert.equal(writes, 1);
});
// A permission 403 stays 403; rate limits wait without new requests.
test('permission denial remains 403; rate limits honor cooldown without hitting GitHub again', async () => {
  // Fake fetch always returning 403.
  const forbidden = createGithubClient({ fetch: (async () => Response.json({ message: 'Resource not accessible by integration' }, { status: 403 })) as typeof fetch });
  // The error status is 403.
  await assert.rejects(forbidden.request('a', '/repo'), error => error instanceof HttpError && error.status === 403);
  // Counters for the rate-limit case.
  let requests = 0; let clock = 0;
  // Fake fetch returning a secondary rate limit with Retry-After 7.
  const limited = createGithubClient({ now: () => clock, fetch: (async () => { requests++; return Response.json({ message: 'Secondary rate limit' }, { status: 403, headers: { 'retry-after': '7' } }); }) as typeof fetch });
  // First call: 429 with retryAfter 7.
  await assert.rejects(limited.request('a', '/repo'), error => error instanceof HttpError && error.status === 429 && error.retryAfter === 7);
  // Second call fails without a new request.
  await assert.rejects(limited.request('a', '/repo'), error => error instanceof HttpError && error.retryAfter === 7);
  // Only one request reached the fake server.
  assert.equal(requests, 1);
  // Move the clock past the cooldown.
  clock = 7001;
  // A new request is made.
  await assert.rejects(limited.request('a', '/repo')); assert.equal(requests, 2);
});
// The ETag cache is per account and its data cannot be mutated by callers.
test('conditional GET cache is account-isolated and callers cannot mutate cached data', async () => {
  // Counters for the calls and sent ETags.
  let calls = 0; const seen: string[] = [];
  // Fake fetch.
  const client = createGithubClient({ fetch: (async (_url, options) => {
    // Count the call and record the If-None-Match header.
    calls++; const headers = options?.headers as Record<string, string>; seen.push(headers['If-None-Match'] || '');
    // Return 304 when an ETag was sent.
    if (headers['If-None-Match']) return new Response(null, { status: 304 });
    // Otherwise return data with an ETag.
    return Response.json({ name: headers.Authorization }, { headers: { etag: '"etag"' } });
  }) as typeof fetch });
  // Fetch, then mutate the returned object.
  const first = await client.request<{ name: string }>('alice', '/repo'); first.name = 'edited';
  // A cached copy is unaffected by the mutation.
  assert.equal((await client.request<{ name: string }>('alice', '/repo')).name, 'Bearer alice');
  // Another account gets a separate request.
  assert.equal((await client.request<{ name: string }>('bob', '/repo')).name, 'Bearer bob');
  // Three calls with the expected ETag headers.
  assert.equal(calls, 3); assert.deepEqual(seen, ['', '"etag"', '']);
});
// A write that fails on the network is never retried.
test('a write with a network failure is never automatically retried', async () => {
  // Call counter.
  let calls = 0;
  // Fetch always fails.
  const client = createGithubClient({ fetch: (async () => { calls++; throw new Error('network'); }) as typeof fetch });
  // Reports that the write may have succeeded.
  await assert.rejects(client.request('a', '/repo', 'POST', {}), /may have succeeded/);
  // Only one attempt.
  assert.equal(calls, 1);
});
