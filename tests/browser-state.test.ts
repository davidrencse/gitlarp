// Test runner.
import { test } from 'node:test';
// Assertions.
import assert from 'node:assert/strict';
// Storage helpers under test.
import { readActivities, readPreference } from '../src/storage';
// API helpers under test.
import { api, getSession } from '../src/api';

// Corrupt saved preferences and unsafe links fall back safely.
test('corrupt saved preferences and unsafe activity links fall back safely', () => {
  // Save the original localStorage property.
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  // Fake stored value.
  let saved = '';
  // Replace localStorage with a fake.
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => saved } });
  // Restore it afterwards.
  try {
    // Corrupt values give an empty list.
    for (saved of ['{', 'null', '{}', '[null]']) assert.deepEqual(readActivities('history'), []);
    // A valid entry.
    const entry = { id: 'one', project: 'repo', files: 2, commits: 1, date: new Date().toISOString(), demo: false, url: 'https://github.com/owner/repo' };
    // A valid list is returned.
    saved = JSON.stringify([entry]); assert.deepEqual(readActivities('history'), [entry]);
    // Unsafe URLs:
    for (const url of ['javascript:alert(1)', 'https://github.com.attacker.example/repo', 'https://name:secret@github.com/repo']) {
      // Entries with those URLs are rejected.
      saved = JSON.stringify([{ ...entry, url }]); assert.deepEqual(readActivities('history'), []);
    }
    // A false preference is read.
    saved = 'false'; assert.equal(readPreference(), false);
    // An invalid preference defaults to true.
    saved = '"false"'; assert.equal(readPreference(), true);
  // Restore or delete localStorage.
  } finally {
    // Restore the original.
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    // Or delete the fake.
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

// Simultaneous session loads share one request.
test('simultaneous session initialization shares the same cookie and CSRF request', async () => {
  // Save fetch.
  const originalFetch = globalThis.fetch;
  // Call counter.
  let calls = 0;
  // Fake session response.
  globalThis.fetch = async () => { calls++; return Response.json({ user: null, configured: false, csrf: 'one-csrf-pair' }); };
  // Try.
  try {
    // Two concurrent calls.
    const [one, two] = await Promise.all([getSession(), getSession()]);
    // One request, the same result.
    assert.equal(calls, 1); assert.equal(one, two);
    // A later call makes a new request.
    await getSession(); assert.equal(calls, 2);
  // Restore fetch.
  } finally { globalThis.fetch = originalFetch; }
});

// A 200 response with invalid JSON is rejected.
test('successful HTTP responses with invalid JSON are rejected', async () => {
  // Save fetch.
  const originalFetch = globalThis.fetch;
  // Fake HTML response.
  globalThis.fetch = async () => new Response('proxy error page', { status: 200 });
  // Rejected as an invalid response.
  try { await assert.rejects(api('/api/projects'), /invalid response/); }
  // Restore fetch.
  finally { globalThis.fetch = originalFetch; }
});
