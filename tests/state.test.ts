// Test runner.
import { test } from 'node:test';
// Assertions.
import assert from 'node:assert/strict';
// Random ids.
import { randomUUID } from 'node:crypto';
// Session types.
import type session from 'express-session';
// Session store under test.
import { ExpiringStore } from '../server/session';
// Plan store under test.
import { PlanStore } from '../server/plans';
// Generator for sample plans.
import { generateFiles } from '../shared/generator';
// Fixtures.
import { fixtureContext, fixtureRepos } from './fixtures/projects';
// Plan types.
import type { Plan, PublishResult } from '../shared/types';

// Reads extend idle time but not the absolute expiry.
test('session reads extend idle time without extending absolute expiry', () => {
  // Fake clock and a store with 10 ms idle and 25 ms absolute limits.
  let clock = 0; const store = new ExpiringStore(() => clock, 10, 25);
  // Sample session value.
  const value = { cookie: { maxAge: 25 }, token: 'token' } as session.SessionData;
  // Close the store afterwards.
  try {
    // Create, then touch at time 8.
    store.set('sid', value); clock = 8; store.touch('sid', value);
    // Touch at 16 and 24.
    clock = 16; store.touch('sid', value); clock = 24; store.touch('sid', value);
    // Still exists at 24.
    store.get('sid', (_error, result) => assert.ok(result));
    // Gone at 25 (absolute limit).
    clock = 25; store.get('sid', (_error, result) => assert.equal(result, null));
  } finally { store.close(); }
});
// Idle expiry and per-session memory limits are enforced.
test('session idle expiry and individual memory budgets are enforced', () => {
  // Fake clock and a store with 10 ms idle time.
  let clock = 0; const store = new ExpiringStore(() => clock, 10, 100);
  // Sample session value.
  const value = { cookie: {}, token: 'token' } as session.SessionData;
  // Close the store afterwards.
  try {
    // Expired after 10 ms.
    store.set('sid', value); clock = 10; store.get('sid', (_error, result) => assert.equal(result, null));
    // A 20 KB session is rejected.
    store.set('big', { ...value, token: 'x'.repeat(20_000) }, error => assert.ok(error));
  } finally { store.close(); }
});
// Helper that makes a sample plan.
function makePlan(): Plan {
  // Use the first fixture.
  const context = fixtureContext(fixtureRepos[0]);
  // Build the plan.
  return { id: randomUUID(), repo: context.repo, head: context.head, createdAt: new Date().toISOString(), ...generateFiles(context, ['readme']) };
}
// Plan locks, ownership, and retry idempotency.
test('plan locks, ownership, and completed retry idempotency are independent of sessions', () => {
  // Store a plan for Alice.
  const store = new PlanStore(); const plan = makePlan(); store.put('alice', plan);
  // Bob cannot store the same plan id.
  assert.throws(() => store.put('bob', plan), /already exists/);
  // Bob cannot begin Alice's plan.
  assert.throws(() => store.begin('bob', plan.id, 'input'), /not found/);
  // Alice begins publishing.
  store.begin('alice', plan.id, 'input');
  // A second begin is refused.
  assert.throws(() => store.begin('alice', plan.id, 'input'), /already being published/);
  // A sample result.
  const result: PublishResult = { url: 'https://github.com/a/b', repoUrl: 'https://github.com/a/b', branch: 'docs', commits: 1, files: 1 };
  // Finish with the result.
  store.finish(plan.id, result);
  // A retry with the same input returns the result.
  assert.deepEqual(store.begin('alice', plan.id, 'input').result, result);
  // Different input is refused.
  assert.throws(() => store.begin('alice', plan.id, 'changed-input'), /different options/);
  // After clearing the owner the plan is gone.
  store.clearOwner('alice'); assert.throws(() => store.begin('alice', plan.id, 'input'), /not found/);
});
// Plan expiry and the global memory budget.
test('plan expiry and global memory budget are enforced', () => {
  // A fake clock and a plan.
  let clock = 0; const store = new PlanStore(() => clock); const plan = makePlan(); store.put('alice', plan);
  // At 30 minutes the plan has expired.
  clock = 30 * 60_000; assert.throws(() => store.begin('alice', plan.id, 'input'), /expired/);
  // A tiny memory budget rejects the plan.
  assert.throws(() => new PlanStore(Date.now, 10).put('alice', makePlan()), /storage is full/);
});
