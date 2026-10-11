// Test runner.
import { test } from 'node:test';
// Assertions.
import assert from 'node:assert/strict';
// Functions under test.
import { readFile, inspectProject } from '../server/github';
// Fixtures.
import { fixtureContext, fixtureRepos } from './fixtures/projects';

// Large or unsupported files are refused, not treated as missing.
test('large or unsupported originals are refused instead of treated as absent', async () => {
  // Save the real fetch.
  const originalFetch = globalThis.fetch;
  // Fake payload: not base64, 300,000 bytes.
  let payload: object = { encoding: 'none', content: '', size: 300_000 };
  // Replace fetch.
  globalThis.fetch = async () => Response.json(payload);
  // Restore fetch afterwards.
  try {
    // Unsupported encoding is refused.
    await assert.rejects(readFile('file-test', '/repos/a/b', 'README.md', 'head'), /will not be overwritten/);
    // Too-large content is refused.
    payload = { encoding: 'base64', size: 0, content: Buffer.alloc(250_001).toString('base64') };
    // Check again.
    await assert.rejects(readFile('file-test', '/repos/a/b', 'README.md', 'head'), /will not be overwritten/);
    // A 404 response.
    globalThis.fetch = async () => Response.json({ message: 'Not Found' }, { status: 404 });
    // A missing file returns null.
    assert.equal(await readFile('file-test', '/repos/a/b', 'README.md', 'head'), null);
  // Restore fetch.
  } finally { globalThis.fetch = originalFetch; }
});

// Inspection reads the real case of an existing README.
test('inspection reads the actual case of an existing Markdown README', async () => {
  // Save the real fetch.
  const originalFetch = globalThis.fetch;
  // Fixture context.
  const context = fixtureContext(fixtureRepos[0]);
  // Requested paths.
  const calls: string[] = [];
  // Fake GitHub API.
  globalThis.fetch = async url => {
    // Record the requested path.
    const path = String(url); calls.push(path);
    // Repository.
    if (path.endsWith('/repos/alexmorgan/orbit-ui')) return Response.json(context.repo);
    // Branch ref.
    if (path.endsWith('/git/ref/heads/main')) return Response.json({ object: { sha: context.head } });
    // File tree with readme.md.
    if (path.includes('/git/trees/')) return Response.json({ tree: [{ type: 'blob', path: 'readme.md' }] });
    // Contents of readme.md.
    if (path.includes('/contents/readme.md')) return Response.json({ encoding: 'base64', size: 5, content: Buffer.from('# Readme').toString('base64') });
    // package.json is missing.
    if (path.includes('/contents/package.json')) return Response.json({ message: 'Not Found' }, { status: 404 });
    // No commits.
    if (path.includes('/commits?')) return Response.json([]);
    // Anything else fails the test.
    throw new Error(`Unexpected request: ${path}`);
  };
  // Run the inspection.
  try {
    // Inspect the project.
    const inspected = await inspectProject('casing-test', 'alexmorgan', 'orbit-ui');
    // Uses the real casing and content.
    assert.equal(inspected.readmePath, 'readme.md'); assert.equal(inspected.readme, '# Readme');
    // README.md was never requested.
    assert.ok(!calls.some(path => path.includes('/contents/README.md')));
  // Restore fetch.
  } finally { globalThis.fetch = originalFetch; }
});
