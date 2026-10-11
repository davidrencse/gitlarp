import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProjectSnapshotStore } from '../server/project-snapshots';
import { fixtureContext, fixtureRepos } from './fixtures/projects';

test('project snapshots are session- and repository-bound, expire, and stay within limits', () => {
  let now = 0;
  const store = new ProjectSnapshotStore(() => now, 100_000, 2, 10);
  const context = fixtureContext(fixtureRepos[0]);
  const first = store.put('session-a', context)!;
  assert.ok(store.get('session-a', first, 'ALEXMORGAN/orbit-ui'));
  assert.equal(store.get('session-b', first, context.repo.full_name), undefined);
  assert.equal(store.get('session-a', first, 'alexmorgan/other'), undefined);
  const second = store.put('session-a', fixtureContext(fixtureRepos[1]))!;
  store.put('session-b', fixtureContext(fixtureRepos[2]));
  assert.equal(store.get('session-a', first, context.repo.full_name), undefined, 'oldest snapshot is evicted at capacity');
  assert.ok(store.get('session-a', second, fixtureRepos[1].full_name));
  store.clearOwner('session-a');
  assert.equal(store.get('session-a', second, fixtureRepos[1].full_name), undefined);
  const expiring = store.put('session-a', context)!;
  now = 20;
  assert.equal(store.get('session-a', expiring, context.repo.full_name), undefined);
  assert.equal(new ProjectSnapshotStore(() => now, 1).put('session-a', context), undefined, 'oversized snapshots are not retained');
});
